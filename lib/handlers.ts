import { createHash } from "node:crypto";
import { type Address, type Hex } from "viem";
import { estimateCall, readHead, readTakerSettler, simulateCall, type Call } from "./chain";
import { readEnv, type Env } from "./env";
import { clientIp, json, rateLimit, readJson, rejectCrossOrigin } from "./http";
import { priceImpactBps, referenceSellAmount } from "./impact";
import { log } from "./log";
import { CURATED_TOKENS, isNativeToken } from "./tokens";
import { ALLOWANCE_HOLDER, TRUST_RULES_VERSION } from "./trust-rules";
import {
  approvalFromIssues,
  balanceIssue,
  isFailure,
  parseProviderPayload,
  parseSwapRequest,
  validateSignable,
  type FirmView,
} from "./validate";
import { fetchProvider } from "./zeroex";

export const INDICATIVE_TAKER = "0x0000000000000000000000000000000000000001" as Address;

export type Deps = {
  env: Env;
  fetchImpl: typeof fetch;
  now: () => number;
  readHead: typeof readHead;
  readSettler: typeof readTakerSettler;
  simulate: typeof simulateCall;
  estimateGas: typeof estimateCall;
};

export function defaultDeps(env: Env = readEnv()): Deps {
  return {
    env,
    fetchImpl: fetch,
    now: () => Date.now(),
    readHead,
    readSettler: readTakerSettler,
    simulate: simulateCall,
    estimateGas: estimateCall,
  };
}

function requestId(): string {
  return crypto.randomUUID();
}

function withId(id: string, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", id);
  return new Response(response.body, { status: response.status, headers });
}

export function createHandlers(deps: Deps = defaultDeps()) {
  async function guarded(request: Request, bucket: string, limit: number): Promise<Response | null> {
    const origin = rejectCrossOrigin(request);
    if (origin) return origin;
    if (!rateLimit(`${bucket}:${clientIp(request)}`, limit, 60_000, deps.now())) {
      return json(429, { error: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again." });
    }
    return null;
  }

  async function loadProvider(kind: "price" | "quote", body: unknown, requireTaker: boolean, id: string) {
    const request = parseSwapRequest(body, requireTaker);
    if (isFailure(request)) return request;
    if (!deps.env.apiKeyPresent) {
      return { ok: false as const, code: "PROVIDER_NOT_CONFIGURED", message: "The quote provider is not configured on this server." };
    }
    const taker = request.taker ?? INDICATIVE_TAKER;
    const result = await fetchProvider({
      kind,
      request,
      taker,
      apiKey: deps.env.apiKey,
      timeoutMs: deps.env.providerTimeoutMs,
      fetchImpl: deps.fetchImpl,
    });
    log(result.ok ? "info" : "error", "provider", {
      requestId: id,
      kind,
      status: result.status,
      ms: result.ms,
      code: result.ok ? "ok" : result.code,
      chainId: request.chainId,
      sell: request.sell.symbol,
      buy: request.buy.symbol,
      taker,
    });
    if (!result.ok) return { ok: false as const, code: result.code, message: result.message };
    const parsed = parseProviderPayload(result.body, request);
    if (isFailure(parsed)) return parsed;
    const approval = approvalFromIssues(parsed.issues, request);
    if (approval && isFailure(approval)) return approval;
    return { ok: true as const, request, parsed, approval: approval ?? null, ms: result.ms, indicative: request.taker === null };
  }

  function viewBody(view: FirmView, extra: Record<string, unknown>) {
    return {
      trustRulesVersion: TRUST_RULES_VERSION,
      chainId: 8453,
      allowanceHolder: ALLOWANCE_HOLDER,
      ...view,
      ...extra,
    };
  }

  return {
    async health(): Promise<Response> {
      try {
        const head = await deps.readHead(deps.env.baseRpcUrl, deps.fetchImpl);
        const ok = head.chainId === 8453;
        return json(ok ? 200 : 503, {
          ok,
          chainId: head.chainId,
          blockNumber: head.blockNumber.toString(),
          rpcMs: head.ms,
          tradingEnabled: deps.env.tradingEnabled,
          providerConfigured: deps.env.apiKeyPresent,
          appEnv: deps.env.appEnv,
          trustRulesVersion: TRUST_RULES_VERSION,
        });
      } catch {
        return json(503, {
          ok: false,
          tradingEnabled: deps.env.tradingEnabled,
          providerConfigured: deps.env.apiKeyPresent,
          appEnv: deps.env.appEnv,
          trustRulesVersion: TRUST_RULES_VERSION,
          error: "RPC_UNAVAILABLE",
          message: "Base RPC did not respond.",
        });
      }
    },

    async config(): Promise<Response> {
      return json(200, {
        chainId: 8453,
        tradingEnabled: deps.env.tradingEnabled,
        providerConfigured: deps.env.apiKeyPresent,
        trustRulesVersion: TRUST_RULES_VERSION,
        allowanceHolder: ALLOWANCE_HOLDER,
        slippage: { minBps: 10, maxBps: 100, defaultBps: 50 },
        quoteTtlMs: deps.env.quoteTtlMs,
        tokens: CURATED_TOKENS.map((token) => ({
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          address: token.address,
          native: token.native,
        })),
      });
    },

    async price(request: Request): Promise<Response> {
      const id = requestId();
      const blocked = await guarded(request, "price", 30);
      if (blocked) return withId(id, blocked);
      const body = await readJson(request);
      if (body instanceof Response) return withId(id, body);
      const loaded = await loadProvider("price", body, false, id);
      if (!loaded.ok) return withId(id, json(statusFor(loaded.code), { error: loaded.code, message: loaded.message }));
      let impact: number | null = null;
      const reference = referenceSellAmount(loaded.request.sell);
      if (loaded.request.sellAmount > reference) {
        const referenceRequest = { ...loaded.request, sellAmount: reference };
        const referenceResult = await fetchProvider({
          kind: "price",
          request: referenceRequest,
          taker: loaded.request.taker ?? INDICATIVE_TAKER,
          apiKey: deps.env.apiKey,
          timeoutMs: deps.env.providerTimeoutMs,
          fetchImpl: deps.fetchImpl,
        });
        if (referenceResult.ok) {
          const referenceParsed = parseProviderPayload(referenceResult.body, referenceRequest);
          if (!isFailure(referenceParsed)) {
            impact = priceImpactBps(
              loaded.request.sellAmount,
              BigInt(loaded.parsed.view.buyAmount),
              reference,
              BigInt(referenceParsed.view.buyAmount),
            );
          }
        }
      }
      return withId(id, json(200, viewBody(loaded.parsed.view, {
        error: null,
        kind: "indicative",
        priceImpactBps: impact,
        expiresAt: deps.now() + deps.env.quoteTtlMs,
        indicativeTaker: loaded.indicative,
        providerMs: loaded.ms,
        sellToken: loaded.request.sell,
        buyToken: loaded.request.buy,
      })));
    },

    async quote(request: Request): Promise<Response> {
      const id = requestId();
      const blocked = await guarded(request, "quote", 10);
      if (blocked) return withId(id, blocked);
      if (!deps.env.tradingEnabled) {
        return withId(id, json(403, {
          error: "TRADING_DISABLED",
          message: "Live trading is off until the release gates pass. Indicative prices can still be read.",
        }));
      }
      const body = await readJson(request);
      if (body instanceof Response) return withId(id, body);
      const loaded = await loadProvider("quote", body, true, id);
      if (!loaded.ok) return withId(id, json(statusFor(loaded.code), { error: loaded.code, message: loaded.message }));
      const balance = balanceIssue(loaded.parsed.issues);
      if (balance) {
        return withId(id, json(409, { error: balance.code, message: balance.message, ...viewBody(loaded.parsed.view, { kind: "firm", transaction: null }) }));
      }
      return withId(id, json(200, viewBody(loaded.parsed.view, {
        error: null,
        kind: "firm",
        approval: loaded.approval,
        transaction: null,
        expiresAt: deps.now() + deps.env.quoteTtlMs,
        providerMs: loaded.ms,
        sellToken: loaded.request.sell,
        buyToken: loaded.request.buy,
      })));
    },

    async confirm(request: Request): Promise<Response> {
      const id = requestId();
      const blocked = await guarded(request, "confirm", 10);
      if (blocked) return withId(id, blocked);
      if (!deps.env.tradingEnabled) {
        return withId(id, json(403, {
          error: "TRADING_DISABLED",
          message: "Live trading is off. No transaction was created.",
        }));
      }
      const body = await readJson(request);
      if (body instanceof Response) return withId(id, body);
      const reviewedRaw =
        body && typeof body === "object" && "reviewedMinBuyAmount" in body
          ? (body as { reviewedMinBuyAmount?: unknown }).reviewedMinBuyAmount
          : undefined;
      if (typeof reviewedRaw !== "string" || !/^[0-9]+$/.test(reviewedRaw)) {
        return withId(id, json(400, { error: "BAD_REQUEST", message: "A reviewed minimum is required before signing." }));
      }
      const loaded = await loadProvider("quote", body, true, id);
      if (!loaded.ok) return withId(id, json(statusFor(loaded.code), { error: loaded.code, message: loaded.message }));
      const stamped = deps.now();
      let settler: Address;
      let headBlock: bigint | undefined;
      try {
        const [settlerAddress, head] = await Promise.all([
          deps.readSettler(deps.env.baseRpcUrl, deps.fetchImpl),
          deps.readHead(deps.env.baseRpcUrl, deps.fetchImpl),
        ]);
        if (head.chainId !== 8453) {
          return withId(id, json(503, { error: "WRONG_CHAIN", message: "The configured RPC is not Base mainnet." }));
        }
        settler = settlerAddress;
        headBlock = head.blockNumber;
      } catch {
        return withId(id, json(503, { error: "SETTLER_UNAVAILABLE", message: "The Settler registry could not be read. No transaction was created." }));
      }
      const signable = validateSignable({
        request: loaded.request,
        transaction: loaded.parsed.transaction,
        issues: loaded.parsed.issues,
        settler,
        receivedAtMs: stamped,
        nowMs: stamped,
        ttlMs: deps.env.quoteTtlMs,
        headBlock,
        blockNumber: loaded.parsed.view.blockNumber,
        reviewedMinBuyAmount: BigInt(reviewedRaw),
        minBuyAmount: BigInt(loaded.parsed.view.minBuyAmount),
      });
      if (isFailure(signable)) {
        const status = signable.code === "APPROVAL_REQUIRED" || signable.code === "PRICE_MOVED" ? 409 : statusFor(signable.code);
        return withId(id, json(status, {
          error: signable.code,
          message: signable.message,
          approval: loaded.approval,
          transaction: null,
          ...viewBody(loaded.parsed.view, { kind: "firm" }),
        }));
      }
      if (!loaded.request.taker) {
        return withId(id, json(400, { error: "BAD_TAKER", message: "Connect a wallet before signing." }));
      }
      const call: Call = {
        from: loaded.request.taker,
        to: signable.to,
        data: signable.data,
        value: BigInt(signable.value),
      };
      const simulation = await deps.simulate(deps.env.baseRpcUrl, call, deps.fetchImpl);
      if (!simulation.ok) {
        return withId(id, json(409, { error: "SIMULATION_FAILED", message: simulation.message, transaction: null }));
      }
      const gas = await deps.estimateGas(deps.env.baseRpcUrl, call, deps.fetchImpl);
      if (gas === null) {
        return withId(id, json(409, { error: "GAS_ESTIMATE_FAILED", message: "Gas estimation failed. The swap was not presented for signing.", transaction: null }));
      }
      log("info", "signable", {
        requestId: id,
        chainId: 8453,
        taker: loaded.request.taker,
        sell: loaded.request.sell.symbol,
        buy: loaded.request.buy.symbol,
        sellAmount: loaded.request.sellAmount.toString(),
        minBuyAmount: loaded.parsed.view.minBuyAmount,
        to: signable.to,
        settler: signable.settler,
        value: signable.value,
        native: isNativeToken(loaded.request.sell.address),
        calldataSha256: createHash("sha256").update(signable.data).digest("hex"),
        estimatedGas: gas.toString(),
        zid: loaded.parsed.view.zid,
      });
      return withId(id, json(200, viewBody(loaded.parsed.view, {
        error: null,
        kind: "signable",
        approval: null,
        expiresAt: deps.now() + deps.env.quoteTtlMs,
        estimatedGas: gas.toString(),
        transaction: { to: signable.to, data: signable.data, value: signable.value },
        sellToken: loaded.request.sell,
        buyToken: loaded.request.buy,
      })));
    },
  };
}

function statusFor(code: string): number {
  if (code === "PROVIDER_NOT_CONFIGURED" || code === "PROVIDER_UNAVAILABLE" || code === "SETTLER_UNAVAILABLE") return 503;
  if (code === "PROVIDER_TIMEOUT") return 504;
  if (code === "PROVIDER_THROTTLED" || code === "RATE_LIMITED") return 429;
  if (code === "LIQUIDITY_UNAVAILABLE" || code === "INSUFFICIENT_BALANCE" || code === "STALE_QUOTE" || code === "PRICE_MOVED") return 409;
  if (code.startsWith("PROVIDER_")) return 502;
  return 400;
}

export const handlers = createHandlers(defaultDeps());

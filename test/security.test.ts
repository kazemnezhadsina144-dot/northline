import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { readEnv } from "../lib/env";
import { createHandlers, type Deps } from "../lib/handlers";
import { rateLimit, resetRateLimits } from "../lib/http";
import { priceImpactBps } from "../lib/impact";
import { log } from "../lib/log";
import { CURATED_TOKENS } from "../lib/tokens";
import { ALLOWANCE_HOLDER, EXEC_ABI, PERMIT2 } from "../lib/trust-rules";
import { isFailure, parseSwapRequest, validateSignable } from "../lib/validate";

const settler = getAddress("0x1111111111111111111111111111111111111111");
const taker = getAddress("0x2222222222222222222222222222222222222222");
const usdc = CURATED_TOKENS.find((token) => token.symbol === "USDC");
const weth = CURATED_TOKENS.find((token) => token.symbol === "WETH");
const eth = CURATED_TOKENS.find((token) => token.symbol === "ETH");
if (!usdc || !weth || !eth) throw new Error("Curated tokens missing");

const sellAmount = 1_000_000n;
const buyAmount = 1_000_000_000_000_000n;
const minBuy = (buyAmount * 9950n) / 10_000n;
const API_KEY = "northline-test-key-9f3a7c";

function execData(args?: { operator?: Address; token?: Address; amount?: bigint; target?: Address; data?: Hex }): Hex {
  return encodeFunctionData({
    abi: EXEC_ABI,
    functionName: "exec",
    args: [args?.operator ?? settler, args?.token ?? usdc!.address, args?.amount ?? sellAmount, args?.target ?? settler, args?.data ?? "0xdeadbeef"],
  });
}

function providerBody(patch: Record<string, unknown> = {}) {
  return {
    allowanceTarget: ALLOWANCE_HOLDER,
    blockNumber: "1000",
    buyAmount: buyAmount.toString(),
    buyToken: weth!.address,
    sellAmount: sellAmount.toString(),
    sellToken: usdc!.address,
    minBuyAmount: minBuy.toString(),
    liquidityAvailable: true,
    fees: { integratorFee: null, zeroExFee: null, gasFee: null },
    issues: { allowance: null, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
    route: { fills: [{ source: "Uniswap_V3", from: usdc!.address, to: weth!.address, proportionBps: "10000" }] },
    totalNetworkFee: "1000000000000",
    gas: "180000",
    gasPrice: "1000",
    zid: "zid-test",
    transaction: { to: ALLOWANCE_HOLDER, data: execData(), value: "0", gas: "180000", gasPrice: "1000" },
    ...patch,
  };
}

function tradeBody(patch: Record<string, unknown> = {}) {
  return {
    chainId: 8453,
    sellToken: usdc!.address,
    buyToken: weth!.address,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps: 50,
    ...patch,
  };
}

function requestFor(body: ReturnType<typeof tradeBody>) {
  const parsed = parseSwapRequest(body, true);
  if (isFailure(parsed)) throw new Error(parsed.message);
  return parsed;
}

function deps(fetchImpl: typeof fetch, patch: Partial<Deps> = {}): Deps {
  return {
    env: readEnv({
      ZEROX_API_KEY: API_KEY,
      TRADING_ENABLED: "true",
      APP_ENV: "test",
      QUOTE_TTL_MS: "15000",
    }),
    fetchImpl,
    now: () => 1_700_000_000_000,
    readHead: async () => ({ chainId: 8453, blockNumber: 1000n, ms: 5 }),
    readSettler: async () => settler,
    simulate: async () => ({ ok: true }),
    estimateGas: async () => 210_000n,
    ...patch,
  };
}

function providerFetch(body: unknown, status = 200): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    assert.equal(url.includes("swapFee"), false);
    assert.equal(url.includes(API_KEY), false);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("0x-api-key"), API_KEY);
    assert.equal(headers.get("0x-version"), "v2");
    assert.match(url, /api\.0x\.org\/swap\/allowance-holder\/(price|quote)/);
    if (status === 429) return new Response(JSON.stringify({ name: "Throttled" }), { status: 429 });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

test("production trading stays off unless both switches are set", () => {
  assert.equal(readEnv({ TRADING_ENABLED: "true", ZEROX_API_KEY: API_KEY, APP_ENV: "production" }).tradingEnabled, false);
  assert.equal(readEnv({ TRADING_ENABLED: "true", ZEROX_API_KEY: API_KEY, APP_ENV: "production", PRODUCTION_TRADING: "true" }).tradingEnabled, true);
  assert.equal(readEnv({ TRADING_ENABLED: "true", APP_ENV: "test" }).tradingEnabled, false);
});

function codeOf(body: unknown, requireTaker = true): string {
  const parsed = parseSwapRequest(body, requireTaker);
  return isFailure(parsed) ? parsed.code : "ok";
}

test("request validation rejects the wrong chain, unknown tokens, and bad amounts", () => {
  assert.equal(codeOf(tradeBody({ chainId: 1 })), "WRONG_CHAIN");
  assert.equal(codeOf(tradeBody({ sellToken: PERMIT2 })), "TOKEN_NOT_CURATED");
  assert.equal(codeOf(tradeBody({ buyToken: usdc!.address })), "SAME_TOKEN");
  assert.equal(codeOf(tradeBody({ sellAmount: "0" })), "BAD_AMOUNT");
  assert.equal(codeOf(tradeBody({ taker: undefined })), "BAD_TAKER");
});

test("signable quotes must target AllowanceHolder and the current Settler", () => {
  const request = requestFor(tradeBody());
  const ok = validateSignable({
    request,
    transaction: providerBody().transaction as Record<string, unknown>,
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 1_000,
    nowMs: 2_000,
    ttlMs: 15_000,
    headBlock: 1000n,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(ok), false);
  if (!isFailure(ok)) assert.equal(ok.to, ALLOWANCE_HOLDER);

  const spender = validateSignable({
    request,
    transaction: { ...providerBody().transaction as object, to: settler },
    issues: { allowance: { spender: settler, actual: "0" }, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 1_000,
    nowMs: 2_000,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(spender) && spender.code, "WRONG_SPENDER");

  const permit2 = validateSignable({
    request,
    transaction: providerBody().transaction as Record<string, unknown>,
    issues: { allowance: { spender: PERMIT2, actual: "0" }, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 1_000,
    nowMs: 2_000,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(permit2) && permit2.code, "PERMIT2_FLOW");
});

test("stale quotes, bad value, and calldata mismatches are rejected", () => {
  const request = requestFor(tradeBody());
  const stale = validateSignable({
    request,
    transaction: providerBody().transaction as Record<string, unknown>,
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 0,
    nowMs: 20_000,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(stale) && stale.code, "STALE_QUOTE");

  const value = validateSignable({
    request,
    transaction: { ...(providerBody().transaction as object), value: "1" },
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 0,
    nowMs: 1,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(value) && value.code, "BAD_VALUE");

  const calldata = validateSignable({
    request,
    transaction: { to: ALLOWANCE_HOLDER, data: execData({ amount: sellAmount + 1n }), value: "0" },
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 0,
    nowMs: 1,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(calldata) && calldata.code, "BAD_CALLDATA");

  const malformed = validateSignable({
    request,
    transaction: { to: ALLOWANCE_HOLDER, data: "0x12345678", value: "0" },
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 0,
    nowMs: 1,
    ttlMs: 15_000,
    blockNumber: "1000",
    minBuyAmount: minBuy,
  });
  assert.equal(isFailure(malformed) && malformed.code, "BAD_CALLDATA");
});

test("native sells require matching value and do not approve a spender", () => {
  const nativeAmount = 10n ** 16n;
  const body = tradeBody({ sellToken: eth!.address, sellAmount: nativeAmount.toString() });
  const request = requestFor(body);
  const data = execData({ token: getAddress("0x0000000000000000000000000000000000000000"), amount: 0n });
  const ok = validateSignable({
    request,
    transaction: { to: ALLOWANCE_HOLDER, data, value: nativeAmount.toString() },
    issues: { allowance: null, balance: null, simulationIncomplete: false },
    settler,
    receivedAtMs: 0,
    nowMs: 1,
    ttlMs: 15_000,
    blockNumber: "10",
    minBuyAmount: 1n,
  });
  assert.equal(isFailure(ok), false);
});

test("price impact is measured against a smaller size and omitted when it cannot be measured", () => {
  assert.equal(priceImpactBps(100n, 90n, 10n, 10n), 1000);
  assert.equal(priceImpactBps(10n, 10n, 10n, 10n), null);
});

test("logs redact secrets and keep the calldata hash", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  log("info", "signable", { apiKey: API_KEY, calldataSha256: "abc", data: "0xsecret" });
  console.log = original;
  assert.match(lines[0] ?? "", /redacted/);
  assert.equal((lines[0] ?? "").includes(API_KEY), false);
  assert.match(lines[0] ?? "", /abc/);
});

test("indicative price strips transaction bytes", async () => {
  resetRateLimits();
  const handlers = createHandlers(deps(providerFetch(providerBody())));
  const response = await handlers.price(new Request("http://localhost/api/price", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes("deadbeef"), false);
  assert.equal(text.includes("transaction"), false);
  const body = JSON.parse(text) as { kind: string; buyAmount: string };
  assert.equal(body.kind, "indicative");
  assert.equal(body.buyAmount, buyAmount.toString());
});

test("firm review never returns a signable transaction and limits the approval", async () => {
  resetRateLimits();
  const quoted = providerBody({
    issues: { allowance: { spender: ALLOWANCE_HOLDER, actual: "0" }, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
  });
  const handlers = createHandlers(deps(providerFetch(quoted)));
  const response = await handlers.quote(new Request("http://localhost/api/quote", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  const body = await response.json() as { transaction: unknown; approval: { amount: string; spender: string } };
  assert.equal(response.status, 200);
  assert.equal(body.transaction, null);
  assert.equal(body.approval.amount, sellAmount.toString());
  assert.equal(body.approval.spender, ALLOWANCE_HOLDER);
  assert.notEqual(body.approval.amount, (2n ** 256n - 1n).toString());
});

test("confirm revalidates and returns a guarded transaction", async () => {
  resetRateLimits();
  const handlers = createHandlers(deps(providerFetch(providerBody())));
  const response = await handlers.confirm(new Request("http://localhost/api/quote/confirm", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...tradeBody(), reviewedMinBuyAmount: minBuy.toString() }),
  }));
  const body = await response.json() as { error: string | null; transaction: { to: string; data: string; value: string }; estimatedGas: string };
  assert.equal(response.status, 200);
  assert.equal(body.error, null);
  assert.equal(body.transaction.to, ALLOWANCE_HOLDER);
  assert.equal(body.transaction.value, "0");
  assert.match(body.transaction.data, /^0x2213bc0b/);
  assert.equal(body.estimatedGas, "210000");
});

test("trading disabled does not call the provider", async () => {
  resetRateLimits();
  let called = false;
  const handlers = createHandlers(deps(async () => {
    called = true;
    return new Response("no");
  }, {
    env: readEnv({ ZEROX_API_KEY: API_KEY, TRADING_ENABLED: "false", APP_ENV: "test" }),
  }));
  const response = await handlers.quote(new Request("http://localhost/api/quote", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  const body = await response.json() as { error: string };
  assert.equal(response.status, 403);
  assert.equal(body.error, "TRADING_DISABLED");
  assert.equal(called, false);
});

test("negative provider and request cases", async () => {
  resetRateLimits();
  const throttled = createHandlers(deps(providerFetch(providerBody(), 429)));
  const throttledResponse = await throttled.price(new Request("http://localhost/api/price", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  assert.equal(throttledResponse.status, 429);

  resetRateLimits();
  const malformed = createHandlers(deps(async () => new Response("not-json", { status: 200 })));
  const malformedResponse = await malformed.price(new Request("http://localhost/api/price", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  assert.equal(malformedResponse.status, 502);

  resetRateLimits();
  const timeout = createHandlers(deps(async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  }));
  const timeoutResponse = await timeout.price(new Request("http://localhost/api/price", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  assert.equal(timeoutResponse.status, 504);

  resetRateLimits();
  const handlers = createHandlers(deps(providerFetch(providerBody())));
  const cross = await handlers.price(new Request("http://localhost/api/price", {
    method: "POST",
    headers: { host: "localhost", origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  assert.equal(cross.status, 403);

  const balanceBody = providerBody({
    issues: { allowance: null, balance: { token: usdc!.address, actual: "0", expected: sellAmount.toString() }, simulationIncomplete: false, invalidSourcesPassed: [] },
  });
  resetRateLimits();
  const balance = createHandlers(deps(providerFetch(balanceBody)));
  const balanceResponse = await balance.quote(new Request("http://localhost/api/quote", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  const balanceJson = await balanceResponse.json() as { error: string; transaction: unknown };
  assert.equal(balanceResponse.status, 409);
  assert.equal(balanceJson.error, "INSUFFICIENT_BALANCE");
  assert.equal(balanceJson.transaction, null);

  resetRateLimits();
  const moved = createHandlers(deps(providerFetch(providerBody())));
  const movedResponse = await moved.confirm(new Request("http://localhost/api/quote/confirm", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...tradeBody(), reviewedMinBuyAmount: (minBuy + 1n).toString() }),
  }));
  const movedJson = await movedResponse.json() as { error: string; transaction: unknown };
  assert.equal(movedJson.error, "PRICE_MOVED");
  assert.equal(movedJson.transaction, null);

  resetRateLimits();
  const reverted = createHandlers(deps(providerFetch(providerBody()), { simulate: async () => ({ ok: false, message: "reverted" }) }));
  const revertedResponse = await reverted.confirm(new Request("http://localhost/api/quote/confirm", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ ...tradeBody(), reviewedMinBuyAmount: minBuy.toString() }),
  }));
  const revertedJson = await revertedResponse.json() as { error: string; transaction: null };
  assert.equal(revertedResponse.status, 409);
  assert.equal(revertedJson.error, "SIMULATION_FAILED");
  assert.equal(revertedJson.transaction, null);

  resetRateLimits();
  const fee = providerBody({ fees: { integratorFee: { amount: "1", token: usdc!.address, type: "volume" }, zeroExFee: null } });
  const feeHandlers = createHandlers(deps(providerFetch(fee)));
  const feeResponse = await feeHandlers.quote(new Request("http://localhost/api/quote", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(tradeBody()),
  }));
  const feeJson = await feeResponse.json() as { error: string };
  assert.equal(feeJson.error, "UNEXPECTED_FEE");
});

test("rate limit blocks the 31st price request", () => {
  resetRateLimits();
  for (let i = 0; i < 30; i += 1) assert.equal(rateLimit("price:test", 30, 60_000, 5_000), true);
  assert.equal(rateLimit("price:test", 30, 60_000, 5_000), false);
});

test("browser source does not reference the server API key", () => {
  const roots = ["app", "components"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (path.includes(`${join("app", "api")}`)) continue;
        walk(path);
      } else if (/\.(ts|tsx|css)$/.test(entry)) files.push(path);
    }
  };
  for (const root of roots) walk(root);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("ZEROX_API_KEY"), false);
  assert.equal(source.includes("NEXT_PUBLIC_ZEROEX"), false);
  assert.equal(source.includes("0x-api-key"), false);
  assert.equal(source.includes("lib/env"), false);
});

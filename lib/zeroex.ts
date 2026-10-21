import type { SwapRequest } from "./validate";

const PRICE_URL = "https://api.0x.org/swap/allowance-holder/price";
const QUOTE_URL = "https://api.0x.org/swap/allowance-holder/quote";

export type ProviderResult =
  | { ok: true; status: number; body: unknown; ms: number }
  | { ok: false; code: string; message: string; status: number; ms: number };

const ALLOWED_PARAMS = ["chainId", "sellToken", "buyToken", "sellAmount", "taker", "slippageBps"] as const;

export function providerUrl(kind: "price" | "quote", request: SwapRequest, taker: string): string {
  const params = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: request.sell.address,
    buyToken: request.buy.address,
    sellAmount: request.sellAmount.toString(),
    taker,
    slippageBps: String(request.slippageBps),
  });
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.includes(key as (typeof ALLOWED_PARAMS)[number])) {
      throw new Error("Unexpected provider parameter");
    }
  }
  return `${kind === "price" ? PRICE_URL : QUOTE_URL}?${params.toString()}`;
}

export async function fetchProvider(args: {
  kind: "price" | "quote";
  request: SwapRequest;
  taker: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<ProviderResult> {
  let url: string;
  try {
    url = providerUrl(args.kind, args.request, args.taker);
  } catch {
    return { ok: false, code: "BAD_UPSTREAM_URL", message: "Refusing to send a malformed provider request.", status: 500, ms: 0 };
  }
  if (url.includes("swapFee") || url.includes(args.apiKey)) {
    return { ok: false, code: "BAD_UPSTREAM_URL", message: "Refusing to send a malformed provider request.", status: 500, ms: 0 };
  }
  const started = Date.now();
  try {
    const response = await args.fetchImpl(url, {
      method: "GET",
      headers: {
        "0x-api-key": args.apiKey,
        "0x-version": "v2",
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    const ms = Date.now() - started;
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, code: "PROVIDER_MALFORMED", message: "The provider returned a malformed response.", status: response.status, ms };
    }
    if (response.status === 429) {
      return { ok: false, code: "PROVIDER_THROTTLED", message: "The quote provider is throttling requests. Try again shortly.", status: 429, ms };
    }
    if (!response.ok) {
      const name = body && typeof body === "object" && body && "name" in body ? String((body as { name: unknown }).name) : "";
      const safeName = name.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 80);
      return {
        ok: false,
        code: response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED",
        message: safeName ? `The provider rejected the request (${safeName}).` : "The provider rejected the request.",
        status: response.status,
        ms,
      };
    }
    return { ok: true, status: response.status, body, ms };
  } catch (error) {
    const ms = Date.now() - started;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, code: "PROVIDER_TIMEOUT", message: "The quote provider did not respond in time.", status: 504, ms };
    }
    return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "The quote provider is unavailable.", status: 502, ms };
  }
}

import { readEnv } from "../lib/env";
import { createHandlers } from "../lib/handlers";
import { CURATED_TOKENS } from "../lib/tokens";

type Pair = { sell: string; buy: string; amount: bigint };

const pairs: Pair[] = [
  { sell: "ETH", buy: "USDC", amount: 10n ** 16n },
  { sell: "USDC", buy: "WETH", amount: 10n * 10n ** 6n },
  { sell: "WETH", buy: "USDC", amount: 10n ** 16n },
  { sell: "cbBTC", buy: "USDC", amount: 10n ** 5n },
  { sell: "DAI", buy: "USDC", amount: 10n * 10n ** 18n },
];

const env = readEnv();
const started = new Date().toISOString();

void (async () => {
const handlers = createHandlers();
const rows = [];

for (const pair of pairs) {
  const sell = CURATED_TOKENS.find((token) => token.symbol === pair.sell);
  const buy = CURATED_TOKENS.find((token) => token.symbol === pair.buy);
  if (!env.apiKeyPresent || !sell || !buy) {
    rows.push({
      pair: `${pair.sell}->${pair.buy}`,
      amount: pair.amount.toString(),
      available: false,
      reason: env.apiKeyPresent ? "TOKEN_MISSING" : "NO_API_KEY",
      latencyMs: null,
    });
    continue;
  }
  const began = Date.now();
  const response = await handlers.price(new Request("http://127.0.0.1/api/price", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({
      chainId: 8453,
      sellToken: sell.address,
      buyToken: buy.address,
      sellAmount: pair.amount.toString(),
      slippageBps: 50,
    }),
  }));
  const body = await response.json() as Record<string, unknown>;
  rows.push({
    pair: `${pair.sell}->${pair.buy}`,
    amount: pair.amount.toString(),
    available: response.ok,
    status: response.status,
    latencyMs: Date.now() - began,
    providerMs: body.providerMs ?? null,
    blockNumber: body.blockNumber ?? null,
    buyAmount: body.buyAmount ?? null,
    minBuyAmount: body.minBuyAmount ?? null,
    totalNetworkFee: body.totalNetworkFee ?? null,
    priceImpactBps: body.priceImpactBps ?? null,
    error: body.error ?? null,
  });
}

console.log(JSON.stringify({
  started,
  chainId: 8453,
  provider: "0x Swap API v2 AllowanceHolder",
  executed: false,
  quoteToExecution: "not measured; no authorized live swap",
  reversionRate: "not measured; no authorized live swap",
  fallback: "none; a failed provider response is rejected",
  comparativeClaim: false,
  comparison: "No second routing provider was measured. No pricing advantage is claimed.",
  rows,
}, null, 2));
process.exit(env.apiKeyPresent && rows.every((row) => row.available) ? 0 : 2);
})();

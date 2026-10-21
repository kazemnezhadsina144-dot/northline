import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURATED_TOKENS } from "../lib/tokens";
import { readEnv } from "../lib/env";
import { createHandlers } from "../lib/handlers";

function loadEnvFile(name: string): void {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const weth = CURATED_TOKENS.find((token) => token.symbol === "WETH");
const usdc = CURATED_TOKENS.find((token) => token.symbol === "USDC");
const env = readEnv();

if (!env.apiKeyPresent || !weth || !usdc) {
  console.log(JSON.stringify({
    result: "BLOCKED_NO_API_KEY",
    liveQuote: false,
    message: "ZEROX_API_KEY is not configured. No live provider request was sent.",
  }));
  process.exit(2);
}

void (async () => {
  const handlers = createHandlers();
  const response = await handlers.price(new Request("http://127.0.0.1/api/price", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({
      chainId: 8453,
      sellToken: weth.address,
      buyToken: usdc.address,
      sellAmount: (10n ** 16n).toString(),
      slippageBps: 50,
    }),
  }));
  const body = await response.json() as Record<string, unknown>;
  console.log(JSON.stringify({
    result: response.ok ? "LIVE_INDICATIVE_PRICE" : "LIVE_PRICE_FAILED",
    status: response.status,
    kind: body.kind ?? null,
    error: body.error ?? null,
    message: body.message ?? null,
    buyAmount: body.buyAmount ?? null,
    minBuyAmount: body.minBuyAmount ?? null,
    blockNumber: body.blockNumber ?? null,
    totalNetworkFee: body.totalNetworkFee ?? null,
    providerMs: body.providerMs ?? null,
    executed: false,
  }));
  process.exit(response.ok ? 0 : 1);
})();

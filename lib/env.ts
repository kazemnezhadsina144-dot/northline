export type AppEnv = "development" | "test" | "production";

export type Env = {
  apiKey: string;
  apiKeyPresent: boolean;
  tradingEnabled: boolean;
  appEnv: AppEnv;
  baseRpcUrl: string;
  quoteTtlMs: number;
  providerTimeoutMs: number;
};

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const appEnv: AppEnv =
    source.APP_ENV === "production" || source.APP_ENV === "test" ? source.APP_ENV : "development";
  const apiKey = source.ZEROX_API_KEY?.trim() ?? "";
  const requested = source.TRADING_ENABLED === "true";
  const productionArmed = source.PRODUCTION_TRADING === "true";
  const tradingEnabled = requested && apiKey.length > 0 && (appEnv !== "production" || productionArmed);
  return {
    apiKey,
    apiKeyPresent: apiKey.length > 0,
    tradingEnabled,
    appEnv,
    baseRpcUrl: source.BASE_RPC_URL?.trim() || "https://mainnet.base.org",
    quoteTtlMs: bounded(source.QUOTE_TTL_MS, 15_000, 5_000, 30_000),
    providerTimeoutMs: bounded(source.ZEROX_TIMEOUT_MS, 8_000, 1_000, 20_000),
  };
}

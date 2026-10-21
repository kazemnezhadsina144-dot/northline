import type { CuratedToken } from "./tokens";

export function referenceSellAmount(token: CuratedToken): bigint {
  if (token.decimals <= 6) return 10n * 10n ** BigInt(token.decimals);
  if (token.decimals <= 8) return 10n ** BigInt(token.decimals - 4);
  return 10n ** 15n;
}

/** Estimated difference versus a smaller trade on the same provider. Null when it cannot be measured. */
export function priceImpactBps(
  sellAmount: bigint,
  buyAmount: bigint,
  referenceSell: bigint,
  referenceBuy: bigint,
): number | null {
  if (sellAmount <= referenceSell) return null;
  if (buyAmount <= 0n || referenceBuy <= 0n || referenceSell <= 0n) return null;
  const denominator = sellAmount * referenceBuy;
  if (denominator === 0n) return null;
  const numerator = denominator - buyAmount * referenceSell;
  const bps = Number((numerator * 10_000n) / denominator);
  if (!Number.isFinite(bps) || Math.abs(bps) > 5_000) return null;
  return bps;
}

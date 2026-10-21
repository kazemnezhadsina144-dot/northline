export type LocalHistoryItem = {
  hash: `0x${string}`;
  account: string;
  chainId: number;
  sellSymbol: string;
  buySymbol: string;
  sellAmount: string;
  minBuyAmount: string;
  time: number;
};

const KEY = "northline.history.v1";

export function readHistory(): LocalHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).slice(0, 25);
  } catch {
    return [];
  }
}

export function rememberTrade(item: LocalHistoryItem): LocalHistoryItem[] {
  const next = [item, ...readHistory().filter((entry) => entry.hash !== item.hash)].slice(0, 25);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

function isItem(value: unknown): value is LocalHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalHistoryItem>;
  return typeof item.hash === "string" && item.hash.startsWith("0x") && typeof item.time === "number";
}

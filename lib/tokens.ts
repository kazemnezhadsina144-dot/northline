import { type Address } from "viem";
import { asAddress, BASE_CHAIN_ID, NATIVE_TOKEN } from "./trust-rules";

export type CuratedToken = {
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  address: Address;
  native: boolean;
};

function token(
  symbol: string,
  name: string,
  decimals: number,
  address: string,
  native = false,
): CuratedToken {
  const parsed = asAddress(address);
  if (!parsed) throw new Error(`Bad curated address for ${symbol}`);
  return { chainId: BASE_CHAIN_ID, symbol, name, decimals, address: parsed, native };
}

/** Curated Base mainnet assets. Addresses checked against on-chain symbol and decimals. */
export const CURATED_TOKENS: CuratedToken[] = [
  token("ETH", "Ether", 18, NATIVE_TOKEN, true),
  token("WETH", "Wrapped Ether", 18, "0x4200000000000000000000000000000000000006"),
  token("USDC", "USD Coin", 6, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  token("USDT", "Tether USD", 6, "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"),
  token("DAI", "Dai", 18, "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"),
  token("cbBTC", "Coinbase Wrapped BTC", 8, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"),
];

const byAddress = new Map(CURATED_TOKENS.map((item) => [item.address.toLowerCase(), item]));

export function tokenByAddress(address: string): CuratedToken | null {
  const parsed = asAddress(address);
  if (!parsed) return null;
  return byAddress.get(parsed.toLowerCase()) ?? null;
}

export function isNativeToken(address: string): boolean {
  return tokenByAddress(address)?.native === true;
}

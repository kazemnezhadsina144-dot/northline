import { type Address, getAddress } from "viem";

/** Versioned rules for what this release will ask a wallet to sign. */
export const TRUST_RULES_VERSION = "1.0.0";

export const BASE_CHAIN_ID = 8453;

/** Cancun AllowanceHolder. Safe to pin. Never approve any other spender. */
export const ALLOWANCE_HOLDER = getAddress(
  "0x0000000000001fF3684f28c67538d4D072C22734",
);

/** Permit2 is a different flow and is rejected by this release. */
export const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");

/** ERC-721 registry that publishes the current taker Settler as ownerOf(2). */
export const SETTLER_REGISTRY = getAddress(
  "0x00000000000004533Fe15556B1E086BB1A72cEae",
);

/** Taker-submitted Settler feature id documented by 0x Settler. */
export const TAKER_SETTLER_TOKEN_ID = 2n;

export const NATIVE_TOKEN = getAddress(
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
);

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 100;
export const DEFAULT_QUOTE_TTL_MS = 15_000;
export const MAX_BLOCK_LAG = 30n;
export const MAX_RAW_AMOUNT = 10n ** 30n;

export const EXEC_ABI = [
  {
    type: "function",
    name: "exec",
    stateMutability: "payable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
  },
] as const;

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

export function asAddress(value: string): Address | null {
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

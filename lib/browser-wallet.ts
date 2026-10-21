import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { base } from "./base-chain";

type Injected = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function injectedProvider(): Injected | null {
  if (typeof window === "undefined") return null;
  const provider = (window as Window & { ethereum?: Injected }).ethereum;
  return provider ?? null;
}

export function walletClient() {
  const provider = injectedProvider();
  if (!provider) throw new Error("NO_WALLET");
  return createWalletClient({ chain: base, transport: custom(provider) });
}

export async function connectWallet(): Promise<Address> {
  const provider = injectedProvider();
  if (!provider) throw new Error("NO_WALLET");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("NO_ACCOUNT");
  return account;
}

export async function switchToBase(): Promise<void> {
  const provider = injectedProvider();
  if (!provider) throw new Error("NO_WALLET");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: number }).code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x2105",
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrls: ["https://basescan.org"],
      }],
    });
  }
}

export function isHexChain(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

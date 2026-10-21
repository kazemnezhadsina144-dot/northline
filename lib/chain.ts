import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, type Address, type Hex } from "viem";
import { base } from "./base-chain";
import { REGISTRY_ABI, SETTLER_REGISTRY, TAKER_SETTLER_TOKEN_ID } from "./trust-rules";

export type Call = { from: Address; to: Address; data: Hex; value: bigint };

export async function readHead(rpcUrl: string, fetchImpl?: typeof fetch): Promise<{ chainId: number; blockNumber: bigint; ms: number }> {
  const started = Date.now();
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 8_000, fetchFn: fetchImpl }),
  });
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  return { chainId, blockNumber, ms: Date.now() - started };
}

export async function readTakerSettler(rpcUrl: string, fetchImpl?: typeof fetch): Promise<Address> {
  const data = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "ownerOf",
    args: [TAKER_SETTLER_TOKEN_ID],
  });
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 8_000, fetchFn: fetchImpl }),
  });
  const raw = await client.call({ to: SETTLER_REGISTRY, data });
  if (!raw.data) throw new Error("SETTLER_UNAVAILABLE");
  return decodeFunctionResult({ abi: REGISTRY_ABI, functionName: "ownerOf", data: raw.data });
}

export async function simulateCall(rpcUrl: string, tx: Call, fetchImpl?: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl, { timeout: 8_000, fetchFn: fetchImpl }),
    });
    await client.call({ account: tx.from, to: tx.to, data: tx.data, value: tx.value });
    return { ok: true };
  } catch {
    return { ok: false, message: "Simulation reverted. The swap was not presented for signing." };
  }
}

export async function estimateCall(rpcUrl: string, tx: Call, fetchImpl?: typeof fetch): Promise<bigint | null> {
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl, { timeout: 8_000, fetchFn: fetchImpl }),
    });
    return await client.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value: tx.value });
  } catch {
    return null;
  }
}

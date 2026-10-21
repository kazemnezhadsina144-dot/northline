import { createPublicClient, http } from "viem";
import { base } from "./base-chain";

export const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org", { timeout: 8_000 }),
});

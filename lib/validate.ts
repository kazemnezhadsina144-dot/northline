import { decodeFunctionData, type Address, type Hex } from "viem";
import { isNativeToken, tokenByAddress, type CuratedToken } from "./tokens";
import {
  ALLOWANCE_HOLDER,
  asAddress,
  BASE_CHAIN_ID,
  DEFAULT_SLIPPAGE_BPS,
  EXEC_ABI,
  MAX_RAW_AMOUNT,
  MAX_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
  PERMIT2,
  sameAddress,
} from "./trust-rules";

export type Failure = { ok: false; code: string; message: string };

export type SwapRequest = {
  chainId: number;
  sell: CuratedToken;
  buy: CuratedToken;
  sellAmount: bigint;
  taker: Address | null;
  slippageBps: number;
};

export type FeeView = { amount: string; token: string } | null;

export type ApprovalView = {
  token: Address;
  spender: Address;
  amount: string;
  current: string;
};

export type FirmView = {
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  blockNumber: string;
  totalNetworkFee: string | null;
  gas: string | null;
  gasPrice: string | null;
  sources: string[];
  zeroExFee: FeeView;
  allowanceTarget: Address | null;
  zid: string;
};

export type Signable = {
  to: Address;
  data: Hex;
  value: string;
  settler: Address;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerString(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  return value;
}

function fee(value: unknown): FeeView | Failure {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return { ok: false, code: "MALFORMED_RESPONSE", message: "A fee field is malformed." };
  const amount = integerString(value.amount);
  const token = typeof value.token === "string" ? asAddress(value.token) : null;
  if (!amount || !token) return { ok: false, code: "MALFORMED_RESPONSE", message: "A fee field is malformed." };
  return { amount, token };
}

export function parseSwapRequest(body: unknown, requireTaker: boolean): SwapRequest | Failure {
  if (!isRecord(body)) return { ok: false, code: "BAD_REQUEST", message: "The swap request is malformed." };
  if (body.chainId !== BASE_CHAIN_ID) {
    return { ok: false, code: "WRONG_CHAIN", message: "Northline trades on Base mainnet only." };
  }
  const sell = typeof body.sellToken === "string" ? tokenByAddress(body.sellToken) : null;
  const buy = typeof body.buyToken === "string" ? tokenByAddress(body.buyToken) : null;
  if (!sell || !buy) {
    return { ok: false, code: "TOKEN_NOT_CURATED", message: "Choose a token from the Northline list." };
  }
  if (sell.address === buy.address) {
    return { ok: false, code: "SAME_TOKEN", message: "Choose two different tokens." };
  }
  const rawAmount = integerString(body.sellAmount);
  if (!rawAmount) return { ok: false, code: "BAD_AMOUNT", message: "Enter a sell amount." };
  const sellAmount = BigInt(rawAmount);
  if (sellAmount <= 0n || sellAmount > MAX_RAW_AMOUNT) {
    return { ok: false, code: "BAD_AMOUNT", message: "That sell amount is outside the accepted range." };
  }
  let taker: Address | null = null;
  if (typeof body.taker === "string" && body.taker.length > 0) {
    taker = asAddress(body.taker);
    if (!taker) return { ok: false, code: "BAD_TAKER", message: "The wallet address is not valid." };
  } else if (requireTaker) {
    return { ok: false, code: "BAD_TAKER", message: "Connect a wallet before requesting a firm quote." };
  }
  const slippage =
    body.slippageBps === undefined ? DEFAULT_SLIPPAGE_BPS : body.slippageBps;
  if (typeof slippage !== "number" || !Number.isInteger(slippage) || slippage < MIN_SLIPPAGE_BPS || slippage > MAX_SLIPPAGE_BPS) {
    return {
      ok: false,
      code: "BAD_SLIPPAGE",
      message: `Slippage must be between ${MIN_SLIPPAGE_BPS / 100}% and ${MAX_SLIPPAGE_BPS / 100}%.`,
    };
  }
  return { chainId: BASE_CHAIN_ID, sell, buy, sellAmount, taker, slippageBps: slippage };
}

export function isFailure(value: object): value is Failure {
  return "ok" in value && (value as { ok: unknown }).ok === false;
}

function sourcesOf(route: unknown): string[] | Failure {
  if (!isRecord(route) || !Array.isArray(route.fills)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The route is missing." };
  }
  const sources: string[] = [];
  for (const fill of route.fills) {
    if (!isRecord(fill) || typeof fill.source !== "string" || fill.source.length === 0) {
      return { ok: false, code: "MALFORMED_RESPONSE", message: "A route fill is malformed." };
    }
    sources.push(fill.source);
  }
  return sources;
}

export function parseProviderPayload(
  payload: unknown,
  request: SwapRequest,
): { view: FirmView; issues: RecordValue; transaction: RecordValue | null } | Failure {
  if (!isRecord(payload)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The provider response is not an object." };
  }
  if (payload.liquidityAvailable !== true) {
    return { ok: false, code: "LIQUIDITY_UNAVAILABLE", message: "No route is available for this pair and size." };
  }
  const sellAmount = integerString(payload.sellAmount);
  const buyAmount = integerString(payload.buyAmount);
  const minBuyAmount = integerString(payload.minBuyAmount);
  const blockNumber = integerString(payload.blockNumber);
  if (!sellAmount || !buyAmount || !minBuyAmount || !blockNumber) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "Quote amounts or freshness fields are missing." };
  }
  if (BigInt(sellAmount) !== request.sellAmount) {
    return { ok: false, code: "AMOUNT_MISMATCH", message: "The provider changed the sell amount." };
  }
  if (!sameAddress(String(payload.sellToken), request.sell.address) || !sameAddress(String(payload.buyToken), request.buy.address)) {
    return { ok: false, code: "TOKEN_MISMATCH", message: "The provider changed the token pair." };
  }
  const min = BigInt(minBuyAmount);
  const buy = BigInt(buyAmount);
  if (min <= 0n || min > buy) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The minimum received is not consistent with the quote." };
  }
  const floor = (buy * BigInt(10_000 - request.slippageBps)) / 10_000n;
  if (min + 1n < floor) {
    return { ok: false, code: "SLIPPAGE_WIDER_THAN_REQUESTED", message: "The quote allows more slippage than requested." };
  }
  const sources = sourcesOf(payload.route);
  if (isFailure(sources)) return sources;
  if (!isRecord(payload.fees)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The provider omitted fee information." };
  }
  const parsedFee = fee(payload.fees.zeroExFee);
  if (parsedFee && isFailure(parsedFee)) return parsedFee;
  if (payload.fees.integratorFee != null) {
    return { ok: false, code: "UNEXPECTED_FEE", message: "The provider added an integrator fee this app did not request." };
  }
  const zeroExFee: FeeView = parsedFee && !isFailure(parsedFee) ? parsedFee : null;
  let allowanceTarget: Address | null = null;
  if (payload.allowanceTarget != null) {
    if (typeof payload.allowanceTarget !== "string") {
      return { ok: false, code: "MALFORMED_RESPONSE", message: "The allowance target is malformed." };
    }
    allowanceTarget = asAddress(payload.allowanceTarget);
    if (!allowanceTarget) return { ok: false, code: "MALFORMED_RESPONSE", message: "The allowance target is not an address." };
  }
  const spenderCheck = assertSpender(allowanceTarget, request);
  if (spenderCheck) return spenderCheck;
  if (!isRecord(payload.issues)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The provider omitted issue checks." };
  }
  if (typeof payload.zid !== "string" || payload.zid.length === 0) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The provider omitted a quote id." };
  }
  const network = integerString(payload.totalNetworkFee);
  const gas = integerString(payload.gas) ?? (isRecord(payload.transaction) ? integerString(payload.transaction.gas) : null);
  const gasPrice = integerString(payload.gasPrice) ?? (isRecord(payload.transaction) ? integerString(payload.transaction.gasPrice) : null);
  return {
    view: {
      sellAmount,
      buyAmount,
      minBuyAmount,
      blockNumber,
      totalNetworkFee: network,
      gas,
      gasPrice,
      sources,
      zeroExFee,
      allowanceTarget,
      zid: payload.zid,
    },
    issues: payload.issues,
    transaction: isRecord(payload.transaction) ? payload.transaction : null,
  };
}

function assertSpender(spender: Address | null, request: SwapRequest): Failure | null {
  if (spender && sameAddress(spender, PERMIT2)) {
    return { ok: false, code: "PERMIT2_FLOW", message: "Permit2 approvals are not used by this release." };
  }
  if (spender && !sameAddress(spender, ALLOWANCE_HOLDER)) {
    return {
      ok: false,
      code: "WRONG_SPENDER",
      message: "The only allowed approval spender is AllowanceHolder. The Settler contract is never approved.",
    };
  }
  if (!spender && !request.sell.native) {
    return { ok: false, code: "WRONG_SPENDER", message: "An ERC-20 quote did not name AllowanceHolder." };
  }
  if (spender && request.sell.native) {
    return { ok: false, code: "WRONG_SPENDER", message: "A native Ether sell must not request an approval." };
  }
  return null;
}

export function approvalFromIssues(issues: RecordValue, request: SwapRequest): ApprovalView | null | Failure {
  if (issues.allowance == null) return null;
  if (!isRecord(issues.allowance)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The allowance issue is malformed." };
  }
  const spender = typeof issues.allowance.spender === "string" ? asAddress(issues.allowance.spender) : null;
  const current = integerString(issues.allowance.actual);
  if (!spender || current === null) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The allowance issue is malformed." };
  }
  const rejected = assertSpender(spender, request);
  if (rejected) return rejected;
  if (BigInt(current) >= request.sellAmount) return null;
  return {
    token: request.sell.address,
    spender: ALLOWANCE_HOLDER,
    amount: request.sellAmount.toString(),
    current,
  };
}

export function balanceIssue(issues: RecordValue): Failure | null {
  if (issues.balance == null) return null;
  if (!isRecord(issues.balance)) {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The balance issue is malformed." };
  }
  return {
    ok: false,
    code: "INSUFFICIENT_BALANCE",
    message: "The connected wallet does not have enough of the sell token.",
  };
}

export function validateSignable(args: {
  request: SwapRequest;
  transaction: RecordValue | null;
  issues: RecordValue;
  settler: Address;
  receivedAtMs: number;
  nowMs: number;
  ttlMs: number;
  headBlock?: bigint;
  blockNumber: string;
  reviewedMinBuyAmount?: bigint;
  minBuyAmount: bigint;
}): Signable | Failure {
  const age = args.nowMs - args.receivedAtMs;
  if (age < -2_000 || age > args.ttlMs) {
    return { ok: false, code: "STALE_QUOTE", message: "The quote expired. Request a new one before signing." };
  }
  if (args.headBlock !== undefined) {
    const quoted = BigInt(args.blockNumber);
    if (args.headBlock < quoted || args.headBlock - quoted > 30n) {
      return { ok: false, code: "STALE_QUOTE", message: "The quote block is no longer fresh." };
    }
  }
  if (args.issues.simulationIncomplete === true) {
    return { ok: false, code: "SIMULATION_INCOMPLETE", message: "The provider could not simulate this swap." };
  }
  const balance = balanceIssue(args.issues);
  if (balance) return balance;
  const approval = approvalFromIssues(args.issues, args.request);
  if (approval && isFailure(approval)) return approval;
  if (approval) {
    return { ok: false, code: "APPROVAL_REQUIRED", message: "Approve AllowanceHolder for this sell amount before signing the swap." };
  }
  if (args.reviewedMinBuyAmount !== undefined && args.minBuyAmount < args.reviewedMinBuyAmount) {
    return { ok: false, code: "PRICE_MOVED", message: "The fresh quote pays less than the quote you reviewed." };
  }
  const tx = args.transaction;
  if (!tx || typeof tx.to !== "string" || typeof tx.data !== "string") {
    return { ok: false, code: "MALFORMED_RESPONSE", message: "The firm quote did not include a transaction." };
  }
  const to = asAddress(tx.to);
  if (!to || !sameAddress(to, ALLOWANCE_HOLDER)) {
    return { ok: false, code: "BAD_DESTINATION", message: "The transaction destination is not AllowanceHolder." };
  }
  if (sameAddress(to, PERMIT2)) {
    return { ok: false, code: "PERMIT2_FLOW", message: "Permit2 transactions are rejected." };
  }
  const valueRaw = tx.value == null || tx.value === "0x0" ? "0" : integerString(tx.value);
  if (valueRaw === null) return { ok: false, code: "BAD_VALUE", message: "The transaction value is malformed." };
  const value = BigInt(valueRaw);
  if (args.request.sell.native) {
    if (value !== args.request.sellAmount) {
      return { ok: false, code: "BAD_VALUE", message: "The Ether value does not match the sell amount." };
    }
  } else if (value !== 0n) {
    return { ok: false, code: "BAD_VALUE", message: "An ERC-20 swap must not send Ether value." };
  }
  if (!/^0x[0-9a-fA-F]*$/.test(tx.data) || tx.data.length < 10) {
    return { ok: false, code: "BAD_CALLDATA", message: "The transaction calldata is malformed." };
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof EXEC_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: EXEC_ABI, data: tx.data as Hex });
  } catch {
    return { ok: false, code: "BAD_CALLDATA", message: "The calldata is not an AllowanceHolder exec call." };
  }
  if (decoded.functionName !== "exec") {
    return { ok: false, code: "BAD_CALLDATA", message: "The calldata is not an AllowanceHolder exec call." };
  }
  const [operator, token, amount, target] = decoded.args;
  if (!sameAddress(operator, args.settler) || !sameAddress(target, args.settler)) {
    return {
      ok: false,
      code: "BAD_DESTINATION",
      message: "The inner call target is not the current taker Settler from the on-chain registry.",
    };
  }
  if (sameAddress(target, ALLOWANCE_HOLDER) || sameAddress(target, PERMIT2) || tokenByAddress(target)) {
    return { ok: false, code: "BAD_DESTINATION", message: "The inner call target is not an allowed Settler." };
  }
  if (args.request.sell.native) {
    const tokenOk = token === "0x0000000000000000000000000000000000000000" || isNativeToken(token);
    const amountOk = amount === 0n || amount === args.request.sellAmount;
    if (!tokenOk || !amountOk) {
      return { ok: false, code: "BAD_CALLDATA", message: "The native swap calldata does not match the sell amount." };
    }
  } else if (!sameAddress(token, args.request.sell.address) || amount !== args.request.sellAmount) {
    return { ok: false, code: "BAD_CALLDATA", message: "The calldata token or amount does not match the reviewed trade." };
  }
  return { to, data: tx.data as Hex, value: value.toString(), settler: args.settler };
}

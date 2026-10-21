"use client";

import { useEffect, useMemo, useState } from "react";
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { base } from "../lib/base-chain";
import { connectWallet, injectedProvider, isHexChain, switchToBase, walletClient } from "../lib/browser-wallet";
import { rememberTrade } from "../lib/history";
import { publicClient } from "../lib/public-client";
import { ERC20_ABI, REGISTRY_ABI, SETTLER_REGISTRY, TAKER_SETTLER_TOKEN_ID } from "../lib/trust-rules";
import { isFailure, validateSignable, type SwapRequest } from "../lib/validate";

type TokenInfo = { symbol: string; name: string; decimals: number; address: Address; native: boolean };
type Config = {
  tradingEnabled: boolean;
  providerConfigured: boolean;
  quoteTtlMs: number;
  tokens: TokenInfo[];
};
type PriceBody = {
  error: string | null;
  message?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  totalNetworkFee?: string | null;
  gas?: string | null;
  priceImpactBps?: number | null;
  blockNumber?: string;
  expiresAt?: number;
  sources?: string[];
  zeroExFee?: { amount: string; token: string } | null;
  kind?: string;
};
type Phase =
  | "idle"
  | "pricing"
  | "priced"
  | "reviewing"
  | "approval_required"
  | "awaiting_approval"
  | "approval_pending"
  | "confirming"
  | "awaiting_swap"
  | "swap_pending"
  | "success"
  | "reverted"
  | "rejected"
  | "timed_out"
  | "error";

const EMPTY = "0";

export function SwapApp() {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const [walletPending, setWalletPending] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);
  const [sellSymbol, setSellSymbol] = useState("USDC");
  const [buySymbol, setBuySymbol] = useState("WETH");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [picker, setPicker] = useState<"sell" | "buy" | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [price, setPrice] = useState<PriceBody | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("Enter an amount to request an indicative price.");
  const [hash, setHash] = useState<Hex | null>(null);
  const [approval, setApproval] = useState<{ token: Address; spender: Address; amount: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isConnected = Boolean(address);

  useEffect(() => {
    const provider = injectedProvider();
    setHasWallet(Boolean(provider));
    if (!provider) return;
    const syncAccounts = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts[0] : null;
      setAddress(typeof next === "string" ? next as Address : null);
    };
    const syncChain = (value: unknown) => setChainId(isHexChain(value));
    void provider.request({ method: "eth_accounts" }).then(syncAccounts).catch(() => setAddress(null));
    void provider.request({ method: "eth_chainId" }).then(syncChain).catch(() => setChainId(null));
    provider.on?.("accountsChanged", syncAccounts);
    provider.on?.("chainChanged", syncChain);
    return () => {
      provider.removeListener?.("accountsChanged", syncAccounts);
      provider.removeListener?.("chainChanged", syncChain);
    };
  }, []);

  const sell = config?.tokens.find((token) => token.symbol === sellSymbol) ?? null;
  const buy = config?.tokens.find((token) => token.symbol === buySymbol) ?? null;
  const onBase = chainId === base.id;
  const sellAmount = useMemo(() => parseAmount(amount, sell?.decimals ?? 18), [amount, sell]);

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((body: Config) => setConfig(body))
      .catch(() => setNotice("The app configuration could not be loaded."));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!publicClient || !address || !sell || !onBase) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = sell.native
          ? await publicClient.getBalance({ address })
          : await publicClient.readContract({
              address: sell.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            });
        if (!cancelled) setBalance(formatUnits(raw, sell.decimals));
      } catch {
        if (!cancelled) setBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, onBase, publicClient, sell]);

  useEffect(() => {
    if (!sell || !buy || !sellAmount || sell.address === buy.address) {
      setPrice(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "success" || current === "swap_pending" ? current : "pricing"));
      void fetch("/api/price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: base.id,
          sellToken: sell.address,
          buyToken: buy.address,
          sellAmount: sellAmount.toString(),
          taker: address,
          slippageBps,
        }),
        signal: controller.signal,
      })
        .then(async (response) => ({ ok: response.ok, body: (await response.json()) as PriceBody }))
        .then(({ ok, body }) => {
          if (!ok || body.error) {
            setPrice(null);
            setPhase("error");
            setNotice(body.message ?? "An indicative price is not available.");
            return;
          }
          setPrice(body);
          setPhase("priced");
          setNotice("Indicative price. It cannot be signed. Review a firm quote before you trade.");
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setPhase("error");
          setNotice("The price request failed.");
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, buy, sell, sellAmount, slippageBps]);

  function selectToken(symbol: string) {
    if (picker === "sell") {
      if (symbol === buySymbol && sell) setBuySymbol(sell.symbol);
      setSellSymbol(symbol);
    } else if (picker === "buy") {
      if (symbol === sellSymbol && buy) setSellSymbol(buy.symbol);
      setBuySymbol(symbol);
    }
    setPicker(null);
    setApproval(null);
    setHash(null);
  }

  async function review() {
    if (!sell || !buy || !sellAmount || !address) return;
    setPhase("reviewing");
    setNotice("Requesting a firm quote.");
    const response = await fetch("/api/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(sell, buy, sellAmount, address, slippageBps)),
    });
    const body = (await response.json()) as PriceBody & { approval?: { token: Address; spender: Address; amount: string } | null };
    if (!response.ok || body.error) {
      if (body.error === "TRADING_DISABLED") {
        setPhase("priced");
        setNotice(body.message ?? "Live trading is off.");
        return;
      }
      setPhase("error");
      setNotice(body.message ?? "The firm quote was rejected.");
      if (body.buyAmount) setPrice(body);
      return;
    }
    setPrice(body);
    if (body.approval) {
      setApproval(body.approval);
      setPhase("approval_required");
      setNotice("Approve AllowanceHolder for this sell amount. The approval is limited to this trade.");
      return;
    }
    setApproval(null);
    setPhase("priced");
    setNotice("Firm quote ready. Signing requests a new quote immediately before the wallet opens.");
  }

  async function approve() {
    if (!approval || !sell || !address || !publicClient || !sellAmount) return;
    if (chainId !== base.id || sell.native || approval.spender.toLowerCase() !== "0x0000000000001ff3684f28c67538d4d072c22734") {
      setPhase("error");
      setNotice("The approval did not match AllowanceHolder on Base.");
      return;
    }
    if (approval.token.toLowerCase() !== sell.address.toLowerCase() || approval.amount !== sellAmount.toString()) {
      setPhase("error");
      setNotice("The approval amount does not match this trade.");
      return;
    }
    try {
      setPhase("awaiting_approval");
      const wallet = walletClient();
      const current = await publicClient.readContract({
        address: sell.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, approval.spender],
      });
      if (sell.symbol === "USDT" && current > 0n && current < sellAmount) {
        const resetHash = await wallet.writeContract({
          account: address,
          address: sell.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [approval.spender, 0n],
          chain: base,
        });
        await publicClient.waitForTransactionReceipt({ hash: resetHash, timeout: 90_000 });
      }
      const approvalHash = await wallet.writeContract({
        account: address,
        address: sell.address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [approval.spender, BigInt(approval.amount)],
        chain: base,
      });
      setHash(approvalHash);
      setPhase("approval_pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash, timeout: 90_000 });
      if (receipt.status !== "success") {
        setPhase("reverted");
        setNotice("The approval transaction reverted.");
        return;
      }
      setNotice("Approval confirmed. Requesting a fresh firm quote.");
      await review();
    } catch (error) {
      applyWalletError(error, setPhase, setNotice);
    }
  }

  async function signSwap() {
    if (!sell || !buy || !sellAmount || !address || !publicClient || !price?.minBuyAmount) return;
    if (chainId !== base.id) {
      setNotice("Switch the wallet to Base before signing.");
      return;
    }
    setPhase("confirming");
    setNotice("Checking a fresh firm quote before the wallet opens.");
    const response = await fetch("/api/quote/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload(sell, buy, sellAmount, address, slippageBps),
        reviewedMinBuyAmount: price.minBuyAmount,
      }),
    });
    const body = (await response.json()) as PriceBody & {
      transaction?: { to: Address; data: Hex; value: string } | null;
      approval?: { token: Address; spender: Address; amount: string } | null;
    };
    if (!response.ok || body.error || !body.transaction || !body.expiresAt) {
      if (body.approval) setApproval(body.approval);
      setPhase(body.approval ? "approval_required" : "error");
      setNotice(body.message ?? "The fresh quote was rejected. Nothing was sent to the wallet.");
      return;
    }
    if (Date.now() > body.expiresAt) {
      setPhase("error");
      setNotice("The quote expired before signing.");
      return;
    }
    try {
      const registryData = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "ownerOf", args: [TAKER_SETTLER_TOKEN_ID] });
      const registry = await publicClient.call({ to: SETTLER_REGISTRY, data: registryData });
      if (!registry.data) throw new Error("Settler registry returned no data");
      const settler = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: "ownerOf", data: registry.data });
      const request: SwapRequest = {
        chainId: base.id,
        sell: { ...sell, chainId: base.id },
        buy: { ...buy, chainId: base.id },
        sellAmount,
        taker: address,
        slippageBps,
      };
      const verdict = validateSignable({
        request,
        transaction: body.transaction,
        issues: { allowance: null, balance: null, simulationIncomplete: false },
        settler,
        receivedAtMs: body.expiresAt - (config?.quoteTtlMs ?? 15_000),
        nowMs: Date.now(),
        ttlMs: config?.quoteTtlMs ?? 15_000,
        blockNumber: body.blockNumber ?? "0",
        minBuyAmount: BigInt(body.minBuyAmount ?? price.minBuyAmount),
        reviewedMinBuyAmount: BigInt(price.minBuyAmount),
      });
      if (isFailure(verdict)) {
        setPhase("error");
        setNotice(verdict.message);
        return;
      }
      setPhase("awaiting_swap");
      const txHash = await walletClient().sendTransaction({
        account: address,
        to: verdict.to,
        data: verdict.data,
        value: BigInt(verdict.value),
        chain: base,
      });
      setHash(txHash);
      rememberTrade({
        hash: txHash,
        account: address,
        chainId: base.id,
        sellSymbol: sell.symbol,
        buySymbol: buy.symbol,
        sellAmount: sellAmount.toString(),
        minBuyAmount: body.minBuyAmount ?? price.minBuyAmount,
        time: Date.now(),
      });
      setPhase("swap_pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
      if (receipt.status === "success") {
        setPhase("success");
        setNotice("Swap confirmed on Base.");
      } else {
        setPhase("reverted");
        setNotice("The swap transaction reverted.");
      }
    } catch (error) {
      applyWalletError(error, setPhase, setNotice);
    }
  }

  const freshSeconds = price?.expiresAt ? Math.max(0, Math.ceil((price.expiresAt - now) / 1000)) : null;
  const busy = ["pricing", "reviewing", "awaiting_approval", "approval_pending", "confirming", "awaiting_swap", "swap_pending"].includes(phase);

  return (
    <section className="card">
      <div className="row">
        <div>
          <strong>Swap</strong>
          <div className="muted">Base only · non-custodial</div>
        </div>
        <span className={isConnected && onBase ? "pill ok" : "pill bad"}>
          {!isConnected ? "Wallet disconnected" : onBase ? "Base" : chainId ? `Wrong network ${chainId}` : "Network unknown"}
        </span>
      </div>
      {config && !config.tradingEnabled ? (
        <div className="banner">Live trading is off. Indicative prices still load when the provider is configured. No swap can be signed.</div>
      ) : null}
      {config && !config.providerConfigured ? (
        <div className="banner bad">The quote provider is not configured on this server.</div>
      ) : null}

      <div className="field">
        <label htmlFor="sell-amount">You sell</label>
        <div className="row">
          <input
            id="sell-amount"
            className="amount"
            inputMode="decimal"
            aria-label="Sell amount"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value.replace(/[^0-9.]/g, ""));
              setApproval(null);
              setHash(null);
            }}
          />
          <button className="token" type="button" onClick={() => setPicker("sell")}>{sellSymbol}</button>
        </div>
        <div className="muted">{balance ? `Balance ${trimAmount(balance)}` : "Balance unavailable until the wallet is on Base."}</div>
      </div>
      <button
        className="flip"
        type="button"
        aria-label="Switch sell and buy tokens"
        onClick={() => {
          setSellSymbol(buySymbol);
          setBuySymbol(sellSymbol);
          setApproval(null);
        }}
      >
        ↕
      </button>
      <div className="field">
        <label>You buy</label>
        <div className="row">
          <div className="amount">{price?.buyAmount && buy ? trimAmount(formatUnits(BigInt(price.buyAmount), buy.decimals)) : "—"}</div>
          <button className="token" type="button" onClick={() => setPicker("buy")}>{buySymbol}</button>
        </div>
      </div>

      <label className="slip">
        Slippage
        <select
          aria-label="Slippage"
          value={slippageBps}
          onChange={(event) => setSlippageBps(Number(event.target.value))}
        >
          {[10, 25, 50, 75, 100].map((bps) => (
            <option key={bps} value={bps}>{(bps / 100).toFixed(2)}%</option>
          ))}
        </select>
      </label>

      <div className="grid">
        <div><span>Minimum received</span>{price?.minBuyAmount && buy ? trimAmount(formatUnits(BigInt(price.minBuyAmount), buy.decimals)) : "—"} {buySymbol}</div>
        <div><span>Price impact</span>{formatImpact(price?.priceImpactBps)}</div>
        <div><span>Estimated network fee</span>{price?.totalNetworkFee ? `${trimAmount(formatUnits(BigInt(price.totalNetworkFee), 18))} ETH` : "Unavailable"}</div>
        <div><span>Estimated gas</span>{price?.gas ?? "Unavailable"}</div>
        <div><span>Quote freshness</span>{price?.blockNumber ? `Block ${price.blockNumber}${freshSeconds !== null ? ` · ${freshSeconds}s` : ""}` : "—"}</div>
        <div><span>Route</span>{price?.sources?.slice(0, 3).join(", ") || "—"}</div>
      </div>
      <p className={phase === "error" || phase === "reverted" || phase === "rejected" || phase === "timed_out" ? "banner bad" : phase === "success" ? "banner ok" : "banner"}>
        {notice}
      </p>
      {hash ? (
        <p><a href={`https://basescan.org/tx/${hash}`} rel="noreferrer" target="_blank">View transaction on BaseScan</a></p>
      ) : null}

      <div className="actions">
        {!hasWallet ? (
          <button className="primary" type="button" disabled>
            No injected wallet found
          </button>
        ) : !isConnected ? (
          <button className="primary" type="button" disabled={walletPending} onClick={() => {
            setWalletPending(true);
            void connectWallet().then(setAddress).catch((error) => applyWalletError(error, setPhase, setNotice)).finally(() => setWalletPending(false));
          }}>
            Connect wallet
          </button>
        ) : !onBase ? (
          <button className="primary" type="button" disabled={walletPending} onClick={() => {
            setWalletPending(true);
            void switchToBase().catch((error) => applyWalletError(error, setPhase, setNotice)).finally(() => setWalletPending(false));
          }}>
            Switch to Base
          </button>
        ) : phase === "approval_required" ? (
          <button className="primary" type="button" disabled={busy} onClick={() => void approve()}>
            Approve {sellSymbol}
          </button>
        ) : (
          <>
            <button className="secondary" type="button" disabled={busy || !sellAmount || !config?.tradingEnabled} onClick={() => void review()}>
              Review firm quote
            </button>
            <button className="primary" type="button" disabled={busy || !price?.minBuyAmount || !config?.tradingEnabled} onClick={() => void signSwap()}>
              {phase === "awaiting_swap" ? "Waiting for wallet" : phase === "swap_pending" ? "Waiting for Base" : "Sign swap"}
            </button>
          </>
        )}
      </div>

      {picker ? (
        <dialog className="sheet" open aria-label="Choose token">
          {config?.tokens.map((token) => (
            <button key={token.address} type="button" onClick={() => selectToken(token.symbol)}>
              <strong>{token.symbol}</strong>
              <div className="muted">{token.name}</div>
            </button>
          ))}
          <button type="button" onClick={() => setPicker(null)}>Close</button>
        </dialog>
      ) : null}
    </section>
  );
}

function payload(sell: TokenInfo, buy: TokenInfo, sellAmount: bigint, taker: Address, slippageBps: number) {
  return {
    chainId: base.id,
    sellToken: sell.address,
    buyToken: buy.address,
    sellAmount: sellAmount.toString(),
    taker,
    slippageBps,
  };
}

function parseAmount(value: string, decimals: number): bigint | null {
  if (!value || value === ".") return null;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function trimAmount(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "") || EMPTY;
}

function formatImpact(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "Unavailable";
  return `${(bps / 100).toFixed(2)}% vs a smaller size`;
}

function applyWalletError(error: unknown, setPhase: (phase: Phase) => void, setNotice: (notice: string) => void) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name.includes("UserRejected") || message.includes("user rejected") || message.includes("4001")) {
    setPhase("rejected");
    setNotice("The wallet rejected the request. No transaction was submitted.");
    return;
  }
  if (name.includes("Timeout") || message.includes("timed out")) {
    setPhase("timed_out");
    setNotice("The transaction was not confirmed within 90 seconds. Check BaseScan before trying again.");
    return;
  }
  setPhase("error");
  setNotice("The wallet request failed before a confirmed result.");
}

"use client";

import { useEffect, useState } from "react";
import { base } from "../lib/base-chain";
import { readHistory, type LocalHistoryItem } from "../lib/history";
import { publicClient } from "../lib/public-client";

type Status = "pending" | "success" | "reverted" | "unknown";

export function HistoryView() {
  const [items, setItems] = useState<LocalHistoryItem[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    setItems(readHistory());
  }, []);

  useEffect(() => {
    if (!publicClient || items.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, Status> = {};
      for (const item of items) {
        if (item.chainId !== base.id) {
          next[item.hash] = "unknown";
          continue;
        }
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: item.hash });
          next[item.hash] = receipt.status === "success" ? "success" : "reverted";
        } catch {
          next[item.hash] = "pending";
        }
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (items.length === 0) {
    return <p className="banner">No swaps have been submitted from this browser yet.</p>;
  }

  return (
    <ul className="list">
      {items.map((item) => (
        <li key={item.hash}>
          <div className="row">
            <strong>{item.sellSymbol} to {item.buySymbol}</strong>
            <span className="pill">{status[item.hash] ?? "checking"}</span>
          </div>
          <p className="muted">
            {new Date(item.time).toLocaleString()} · minimum {item.minBuyAmount}
          </p>
          <a href={`https://basescan.org/tx/${item.hash}`} rel="noreferrer" target="_blank">
            View on BaseScan
          </a>
        </li>
      ))}
    </ul>
  );
}

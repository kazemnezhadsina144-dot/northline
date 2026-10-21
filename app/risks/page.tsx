export default function RisksPage() {
  return (
    <article className="page prose">
      <h1>Risks and limits</h1>
      <p>Northline is a non-custodial interface. It does not take custody of wallets, it has no signing key, and it does not submit transactions on its own.</p>
      <h2>Routing</h2>
      <p>Firm routes come from the 0x Swap API. A provider outage, a bad response, or a changed route can delay or block a trade. Northline rejects responses that fail its transaction rules instead of substituting another source.</p>
      <h2>Approvals</h2>
      <p>ERC-20 sells ask you to approve AllowanceHolder for the sell amount of that trade. The Settler contract is never an approval spender. An approval lets that contract move the approved amount. Review the token, spender, and amount in your wallet before confirming.</p>
      <h2>Tokens</h2>
      <p>The token list is a short curated set of Base assets. Curation is not a promise that a token cannot be paused, upgraded, or lose value. Arbitrary tokens are not offered as safe.</p>
      <h2>Price, MEV, and failure</h2>
      <p>Quotes move. The minimum you accept is set by your slippage and rechecked immediately before signing. Validators and searchers can reorder transactions. A swap can still revert after you sign. Network fees are paid even when a swap reverts.</p>
      <h2>RPC and history</h2>
      <p>Balances, simulation, and history status depend on a Base RPC. If it fails, Northline stops instead of inventing a result. Local history can be incomplete or stale until the receipt is read from the chain.</p>
      <h2>Stopping trades</h2>
      <p>Live signing is off unless the server is explicitly configured to enable it. To stop trading, set TRADING_ENABLED to false and redeploy. Production also requires PRODUCTION_TRADING. There is no admin key and no custody contract to pause.</p>
    </article>
  );
}

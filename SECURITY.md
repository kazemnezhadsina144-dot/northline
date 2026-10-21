# Security

Northline asks the user's wallet to sign. It does not collect private keys, custody funds, or send transactions from a backend signer. There is no admin wallet, fee token, custom AMM, or upgradeable custody contract.

## Secrets

`ZEROX_API_KEY` is read only in server code. Client pages do not import `lib/env.ts`. `scripts/check-bundle-secrets.mjs` fails the build output if the key or the `0x-api-key` header appears in `.next/static`.

## Disable trading

1. Set `TRADING_ENABLED=false`.
2. In production, also leave `PRODUCTION_TRADING` unset or false.
3. Redeploy. `/api/quote` and `/api/quote/confirm` return `TRADING_DISABLED` and do not ask 0x for a firm quote.
4. Rotate `ZEROX_API_KEY` at the 0x dashboard if the key may have leaked.
5. There is no on-chain pause. Users who already approved AllowanceHolder still have that allowance until they revoke it in their wallet.

## Incident response

- Treat a bad destination, unexpected spender, or calldata mismatch as a Sev-1. Keep trading off.
- Preserve redacted JSON logs. Logs drop API keys, cookies, and raw calldata. They keep a calldata hash, chain, wallet, tokens, amounts, and the Settler address.
- If the 0x response shape changes so valid quotes fail closed, leave trading off until trust rules are updated and tests cover the new shape.
- If the Settler registry reverts, confirm returns `SETTLER_UNAVAILABLE` and creates no transaction.

## Residual risk

- A compromised quote provider can still build a Settler call that pulls the approved sell amount. Northline binds the outer call to AllowanceHolder, the registry Settler, the sell token, and the sell amount, then simulates. It does not decode every Settler action.
- Token approvals can be misused if the user approves a different spender in the wallet than the one shown here.
- Curated tokens can still pause, blacklist, or change behavior.
- Quotes can move. Slippage and a fresh quote reduce that gap. They do not remove MEV or revert risk.
- Public RPC failure stops quotes and history status. Northline does not replace a failed RPC with an unverified source.
- In-memory rate limits reset when the process restarts and are not shared across instances.
- This release has not had an independent security audit or legal review.

## Release gates

| Gate | State |
| --- | --- |
| Production build and tests | Recorded in the execution receipt after the commands run |
| Critical or high dependency findings | Recorded from `npm audit` |
| Transaction rules reviewed | Implemented in `lib/validate.ts`, covered by `test/security.test.ts` |
| Live provider quote | Blocked until `ZEROX_API_KEY` is present |
| Production configuration | Not deployed with trading enabled |
| Monitoring and disable path | Disable path is the environment flags above. No external pager is wired. |
| License and legal review | Apache-2.0 attribution is included. Legal review is not done. |

Live trading stays off while any required gate is open.

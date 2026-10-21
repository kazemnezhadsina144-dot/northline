# Upstream baseline

| Field | Value |
| --- | --- |
| Upstream URL | https://github.com/0xProject/0x-examples/tree/1d9c57c0a55b00e9927cbe25eb34107cb077a377/swap-v2-allowance-holder-next-app |
| Baseline SHA | `1d9c57c0a55b00e9927cbe25eb34107cb077a377` |
| Baseline time | 2025-12-11T04:59:47Z |
| License | Apache-2.0, stated in the upstream README. The repository has no LICENSE file. |
| Upstream copyright | Copyright 2025 ZeroEx Labs |
| Writable origin | This repository. The upstream remote is read-only. |

## Audit of the inherited example

The example was not retained. These are the reasons:

- The API key is read from `NEXT_PUBLIC_ZEROEX_API_KEY`, which ships it to the browser.
- The quote route forwards the raw query string to 0x.
- Base token records are tagged with chain id 1.
- FLOKI is offered next to WETH, USDC, and DAI.
- Approvals use the maximum uint256 allowance.
- A 1% affiliate fee is sent to an example recipient.
- The AllowanceHolder README describes a Permit2 signature flow.
- There is no check of chain, spender, destination, value, calldata, or quote age.
- There is no rate limit, content security policy, or trading kill switch.
- The authors state the example is unaudited and not production-ready.
- `eslint-config-next` 14 is declared beside Next.js 15.5.7.

## Local changes

- Base mainnet only. Chain id 8453.
- Server-only `ZEROX_API_KEY`. No integrator fee.
- Curated ETH, WETH, USDC, USDT, DAI, and cbBTC. Addresses were read from Base for symbol and decimals.
- Exact-amount AllowanceHolder approvals. Permit2 and Settler approvals are rejected.
- Firm quotes are stripped of calldata until `/api/quote/confirm` re-fetches, simulates, and checks the current taker Settler from registry `ownerOf(2)`.
- Live signing is off unless `TRADING_ENABLED=true`. Production also requires `PRODUCTION_TRADING=true`.
- RainbowKit and WalletConnect were not carried over. The wallet path uses injected and Coinbase connectors.
- Dependencies are pinned by `package-lock.json` after a fresh install. Upstream `qs`, `ethers`, and the browser API key were removed.

## Trust rules 1.0.0

- Transaction `to` must be AllowanceHolder `0x0000000000001fF3684f28c67538d4D072C22734`.
- Approval spender must be that same AllowanceHolder, or absent for native Ether.
- Decoded `exec` token and amount must match the sell, except native Ether, which must send matching value.
- `operator` and `target` must both equal the current taker Settler published by `0x00000000000004533Fe15556B1E086BB1A72cEae` `ownerOf(2)`.
- Settler addresses are not hardcoded. A registry read failure rejects the swap.

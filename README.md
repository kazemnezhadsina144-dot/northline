# Northline

Non-custodial Base DEX aggregator. One network (Base mainnet, chain id 8453) and one execution provider (0x Swap API v2, AllowanceHolder).

You connect a wallet and sign every approval and swap yourself. Northline does not custody funds.

Derived from the 0x Next.js AllowanceHolder example at commit `1d9c57c0a55b00e9927cbe25eb34107cb077a377`. See `NOTICE`, `LICENSE`, and `UPSTREAM.md`.

## Run

Copy `.env.example` to `.env.local`. Set `ZEROX_API_KEY` on the server. Leave `TRADING_ENABLED=false` until the release gates in `SECURITY.md` pass.

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run start
```

The app listens on port 3410. Health: `/api/health`. Read-only price probe: `npm run probe:quote`. Pair benchmark: `npm run benchmark`.

Firm quotes and signing stay disabled until `TRADING_ENABLED=true`. Production also requires `PRODUCTION_TRADING=true` and `APP_ENV=production`.

# Submission Package

## Reviewer Quick Start

Hosted demo:

- Dashboard: `https://fiber-ir-604bdd.fly.dev/`
- Invoice sender demo: `https://fiber-ir-604bdd.fly.dev/?section=demo`
- Health: `https://fiber-ir-604bdd.fly.dev/healthz`
- Incidents API: `https://fiber-ir-604bdd.fly.dev/v1/incidents`

```bash
npm ci
npm run verify
npm run build
FIR_DASHBOARD_DIST=dashboard/dist FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

Open `http://127.0.0.1:8787/?demo=1` for fixture-backed dashboard data, or seed the API with:

```bash
FIR_API_URL=http://127.0.0.1:8787 npm run demo:fixture
```

## What to Evaluate

- Versioned Fiber incident event contract in `shared/src/index.ts`.
- Deterministic classification and remediation catalog in `classifier/src`.
- Fiber JSON-RPC client and read-only FNN smoke path in `collector/src`.
- Live invoice sender route in `api/src/routes/demo.ts`, which calls Fiber
  `send_payment` and records the actual node result.
- Local two-peer Fiber transfer proof in `LIVE_PEER_TRANSFER.md`.
- Ingestion, incident lifecycle, summary stats, and JSON-file persistence in `api/src`.
- React triage dashboard in `dashboard/src`.

## Verification Status

Before submission, run `npm run verify`. It typechecks the monorepo, runs Vitest, and builds the dashboard production bundle.

# Fiber Incident Recorder

Fiber Incident Recorder is a TypeScript diagnostics layer for Fiber payment
operations. It turns failed or retried payment attempts into structured
incidents with provenance, deterministic classification, remediation guidance,
and retry/resolution state.

The project does not replace upstream Fiber. Fiber remains the Rust
payment-network implementation; this repo records and explains payment outcomes
from wallet/merchant wrappers, fixture replay, and live Fiber JSON-RPC payment
results.

## What It Shows

- A versioned event contract for Fiber payment outcomes.
- Deterministic classification into incident classes such as `NO_ROUTE`,
  `PEER_OFFLINE`, `INSUFFICIENT_OUTBOUND_LIQUIDITY`, and `INVOICE_EXPIRED`.
- A Fastify API for ingesting events, listing incidents, patching status, and
  reading summary stats.
- A React dashboard for triage, remediation, provenance, and retry outcome.
- A live invoice sender that calls Fiber `send_payment`, observes the terminal
  result, and records it with provenance.

## Quick Demo

```bash
npm install
npm run demo:local
```

Then open `http://127.0.0.1:5173`.

`demo:local` starts the API and dashboard, waits for the API to become healthy,
seeds a no-route failure followed by a linked retry success, and keeps both
servers running until `Ctrl+C`.

Manual path:

```bash
npm run dev:api
npm run dev:dashboard
npm run demo:fixture
```

If the API is not running, the dashboard falls back to local fixture data. You
can force that mode with `http://127.0.0.1:5173/?demo=1`.

## Submission Run

For a production-style single service that serves both the API and dashboard:

```bash
npm ci
npm run verify
npm run build
FIR_DASHBOARD_DIST=dashboard/dist FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

Then open `http://127.0.0.1:8787/?demo=1`, or seed the API-backed flow:

```bash
FIR_API_URL=http://127.0.0.1:8787 npm run demo:fixture
```

Deployment details are in `DEPLOYMENT.md`; the reviewer checklist is in
`SUBMISSION.md`.

Hosted demo: `https://fiber-ir-604bdd.fly.dev/`
Tester invoice sender: `https://fiber-ir-604bdd.fly.dev/?section=demo`

## Live Fiber Smoke

If a Fiber Network Node JSON-RPC endpoint is running locally:

```bash
FIBER_RPC_URL=http://127.0.0.1:8227 npm run fnn:probe
```

The probe calls safe read-only methods: `node_info`, `list_peers`,
`list_channels`, and optional `list_payments`.

The current smoke has been verified against `nervos/fiber:0.9.0-rc7` with a
temporary unfunded testnet key. It confirmed:

- `node_info` returned Fiber `0.9.0-rc7`
- `list_peers` returned two bootnode peers
- `list_channels` returned an empty channel list
- `list_payments` returned an empty payment list

The hosted tester flow at `/?section=demo` accepts a Fiber invoice, sends it from
the configured hosted sender node through Fiber `send_payment`, polls the payment
state, and stores the live success or failure event in FiberIR. The raw FNN RPC
stays private; only the FiberIR API is public.

## Architecture

- `shared/`: event, incident, provenance, and remediation types.
- `classifier/`: deterministic incident classification and remediation catalog.
- `collector/`: Fiber JSON-RPC client, node snapshot hooks, and fixture replay.
- `api/`: Fastify REST API with in-memory and optional JSON-file stores.
- `sdk/ts/`: TypeScript client and `wrapPayment` helper.
- `dashboard/`: React/Vite triage dashboard.
- `examples/`: fixture replay, local demo orchestration, and FNN smoke scripts.

## API Surface

- `GET /healthz`
- `POST /v1/events`
- `GET /v1/incidents`
- `GET /v1/incidents/:id`
- `PATCH /v1/incidents/:id`
- `GET /v1/stats/summary`

Example event kinds:

- `payment_attempt_failed`
- `payment_retry_scheduled`
- `payment_succeeded`
- `payment_abandoned`

Every incident keeps provenance labels so judges can see which fields came from
live Fiber RPC, fixture replay, or inferred classifier logic.

## Verification

```bash
npm run typecheck
npm test
npm --workspace @fiber-ir/dashboard run build
```

Current expected suite:

- TypeScript project references compile.
- Vitest covers classifier behavior, API ingestion/status persistence, and
  Fiber JSON-RPC wrapper edge cases.
- Dashboard production build succeeds.

`npm run verify` runs the full pre-submission gate.

## Production Integration

The recorder is designed to sit beside production wallet, merchant, or node
operations:

1. Submit a payment through the collector or wrap an existing payment call with
   the SDK.
2. Preserve the returned Fiber `payment_hash`.
3. Poll `get_payment` until Fiber reports `Success` or `Failed`.
4. Emit a versioned `payment_succeeded` or `payment_attempt_failed` event.
5. Let the API classify, store, expose, and resolve the incident lifecycle.

The default local demo uses fixture payment attempts because it must be safe to
run without funded testnet channels. The hosted demo path is real: the API calls
Fiber JSON-RPC on the configured sender node, submits the provided invoice, and
records the actual success or failure returned by the node.

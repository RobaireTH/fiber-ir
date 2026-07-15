# Fiber Incident Recorder

Fiber Incident Recorder is a diagnostics and incident workflow layer for Fiber
Network payments. It records real Fiber payment outcomes, classifies failures,
preserves evidence provenance, and gives operators a dashboard for triage,
remediation, and retry/resolution tracking.

Fiber remains the upstream payment network implementation. This project sits
beside wallets, merchants, services, and node operators as reusable observability
infrastructure for payment attempts.

## Live Demo

- Dashboard: `https://fiber-ir-604bdd.fly.dev/`
- Invoice sender: `https://fiber-ir-604bdd.fly.dev/?section=demo`
- Health check: `https://fiber-ir-604bdd.fly.dev/healthz`
- Incidents API: `https://fiber-ir-604bdd.fly.dev/v1/incidents`

The hosted demo accepts a Fiber invoice, sends it from a hosted Fiber node
through Fiber JSON-RPC, polls the payment result, and records the live success
or failure in FiberIR. The raw Fiber RPC is private; only the FiberIR API and
dashboard are public.

Current live evidence:

- Hosted FiberIR health returns `200` with JSON-file persistence enabled.
- Hosted sender node runs `nervos/fiber:0.9.0-rc7`.
- Hosted sender node advertises public Fiber P2P at
  `/dns4/fiber-ir-fnn-a-604bdd.fly.dev/tcp/8228/p2p/Qmf7j9K5GUDsXjrMh86yfAmhhJFTxnNUUpnBRu9rnwN7Tc`.
- A public funded testnet channel is `ChannelReady` with outbound capacity.
- A live invoice attempt was recorded as `NO_ROUTE` when Fiber returned
  `PathFind error: no path found`.

## Why This Matters for Fiber

Fiber payment failures are operationally important but can be hard to explain
from raw node responses alone. FiberIR turns those responses into a reusable
incident model:

- Wallets can show clearer payment failure diagnostics.
- Merchants can track failed invoices and retry outcomes.
- Service operators can classify route, liquidity, invoice, and peer failures.
- Node operators can preserve live Fiber evidence for support/debugging.
- Future Fiber stack integrations can reuse the event contract and classifier.

## Features

- Versioned event contract for Fiber payment outcomes.
- Live invoice sender route backed by Fiber JSON-RPC `send_payment`.
- Deterministic failure classification, including `NO_ROUTE`,
  `PEER_OFFLINE`, `CHANNEL_NOT_READY`, `INSUFFICIENT_OUTBOUND_LIQUIDITY`,
  `ASSET_MISMATCH`, `PAYMENT_TIMEOUT`, and `INVOICE_EXPIRED`.
- Field-level provenance labels: `live`, `inferred`, `fixture`, or `mock`.
- Fastify API for ingesting events, listing incidents, updating status, and
  reading summary stats.
- React dashboard for incident triage, trend views, provenance, remediation,
  and the hosted invoice demo.
- JSON-file persistence for low-cost deployment.
- TypeScript SDK and wrapper helper for wallet/merchant integrations.
- Fiber RPC collector utilities and read-only FNN smoke scripts.
- Fly.io packaging for both the FiberIR web app and a hosted Fiber sender node.
- MIT licensed.

## Architecture

```text
Tester / wallet / merchant
        |
        v
React dashboard or TypeScript SDK
        |
        v
Fastify FiberIR API
        |
        +--> /v1/demo/pay-invoice --> private Fiber RPC --> hosted FNN sender
        |
        +--> /v1/events -----------> event normalizer
                                      |
                                      v
                              deterministic classifier
                                      |
                                      v
                              JSON incident store
                                      |
                                      v
                              dashboard / incidents API
```

Repository layout:

- `shared/`: event, incident, provenance, and remediation types.
- `classifier/`: deterministic incident classification and remediation catalog.
- `collector/`: Fiber JSON-RPC client, node snapshot hooks, and fixture replay.
- `api/`: Fastify REST API, demo routes, persistence adapters.
- `sdk/ts/`: TypeScript client and `wrapPayment` helper.
- `dashboard/`: React/Vite dashboard.
- `examples/`: fixture replay, local demo orchestration, and FNN smoke scripts.
- `fiber-node/`: Docker packaging for the hosted Fiber sender node.

## Quick Start

Requirements:

- Node.js 22+
- npm

Install dependencies:

```bash
npm install
```

Run the local demo:

```bash
npm run demo:local
```

Then open:

```text
http://127.0.0.1:5173
```

`demo:local` starts the API and dashboard, waits for health, seeds a fixture
failure followed by a linked retry success, and keeps both servers running until
`Ctrl+C`.

Manual local path:

```bash
npm run dev:api
npm run dev:dashboard
npm run demo:fixture
```

If the API is not running, the dashboard falls back to local fixture data. You
can force fixture mode with:

```text
http://127.0.0.1:5173/?demo=1
```

## Hosted Invoice Demo Flow

1. Open `https://fiber-ir-604bdd.fly.dev/?section=demo`.
2. Paste a Fiber invoice.
3. Click `Send and record`.
4. FiberIR calls `node_info` on the hosted sender node.
5. FiberIR calls Fiber `send_payment` with the invoice.
6. FiberIR polls/observes the terminal payment result.
7. FiberIR stores either `payment_succeeded` or `payment_attempt_failed`.
8. The dashboard links to the recorded incident when a failure is created.

A failed payment is still useful evidence. For example, if Fiber returns
`Failed to build route, PathFind error: no path found`, FiberIR records a live
`NO_ROUTE` incident with the raw node error redacted into the incident payload.

## API Surface

- `GET /healthz`
- `POST /v1/demo/pay-invoice`
- `POST /v1/demo/peer-transfer?replay=1`
- `POST /v1/events`
- `GET /v1/incidents`
- `GET /v1/incidents/:id`
- `PATCH /v1/incidents/:id`
- `GET /v1/stats/summary`

Example invoice demo request:

```bash
curl -sS https://fiber-ir-604bdd.fly.dev/v1/demo/pay-invoice \
  -H 'content-type: application/json' \
  -d '{"invoice":"fibt1..."}'
```

Example event kinds:

- `payment_attempt_failed`
- `payment_retry_scheduled`
- `payment_succeeded`
- `node_health_snapshot`

Every incident preserves provenance so reviewers can distinguish live Fiber RPC
evidence from inferred classification or fixture replay data.

## Verification

Run the full pre-submission gate:

```bash
npm run verify
```

This runs:

```bash
npm run typecheck
npm test
npm --workspace @fiber-ir/dashboard run build
```

Current coverage includes:

- Classifier behavior and remediation mapping.
- Fiber JSON-RPC request/response handling.
- API validation, ingestion, deduplication, status updates, persistence, CORS,
  dashboard static serving, verified replay, and live invoice sender
  success/failure handling with mocked Fiber RPC.
- Dashboard production build.

## Deployment

The hosted deployment uses Fly.io with two apps:

- `fiber-ir-604bdd`: FiberIR API and dashboard.
- `fiber-ir-fnn-a-604bdd`: hosted Fiber sender node.

The FiberIR app is configured by `fly.toml`. It serves the built dashboard,
stores incidents on a mounted volume, and talks to the sender node over Fly
private networking:

```toml
FIR_DEMO_SENDER_RPC_URL = "http://fiber-ir-fnn-a-604bdd.internal:18227"
FIR_DEMO_SENDER_P2P_ADDR = "/dns4/fiber-ir-fnn-a-604bdd.fly.dev/tcp/8228/p2p/..."
FIR_STORE_FILE = "/data/incidents.json"
```

Deploy the FiberIR web app:

```bash
fly deploy -c fly.toml --remote-only
```

The sender node is configured by `fly.fnn-a.toml` and `fiber-node/`. It runs
`nervos/fiber:0.9.0-rc7`, exposes Fiber P2P publicly on TCP `8228`, and keeps
JSON-RPC private on `127.0.0.1:8227` inside the machine plus Fly internal
forwarding on `18227`.

Set throwaway testnet secrets before deploying the sender node:

```bash
fly secrets set -c fly.fnn-a.toml \
  FIBER_SECRET_KEY_PASSWORD=... \
  CKB_SECRET_KEY=...
```

Deploy the sender node:

```bash
fly deploy -c fly.fnn-a.toml --remote-only
```

For judging, use a billing-enabled Fly organization so machines remain online.
Fly trial machines can stop after a short runtime.

## Production Integration

Production wallets, merchants, services, or node operators do not need to use
the hosted demo route. They can submit their own events directly:

1. Submit or observe a Fiber payment through existing application code.
2. Preserve the returned Fiber `payment_hash` or invoice id.
3. Poll Fiber `get_payment` until it reports `Success` or `Failed`.
4. Emit `payment_succeeded` or `payment_attempt_failed` to `POST /v1/events`.
5. Let FiberIR classify, store, expose, and resolve the incident lifecycle.

The TypeScript SDK can wrap existing payment calls and submit the same event
contract. The classifier and incident model are intentionally reusable across
wallets, merchant backends, hosted services, and node-operator tooling.

## Known Constraints

- FiberIR does not replace Fiber routing or liquidity management.
- A provided invoice only succeeds when the hosted sender has a graph path and
  sufficient route liquidity to the recipient.
- Private recipient channels may require route hints; otherwise Fiber can return
  `NO_ROUTE`.
- The demo runs on CKB testnet with throwaway keys.
- Raw Fiber RPC is not exposed publicly in the hosted deployment.

## License

MIT. See `LICENSE`.

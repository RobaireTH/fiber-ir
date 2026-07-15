# Deployment

Fiber Incident Recorder can deploy as one Node web service that serves both the API and the built dashboard.

Current hosted demo:

- `https://fiber-ir-604bdd.fly.dev/`
- `https://fiber-ir-604bdd.fly.dev/?section=demo`
- `https://fiber-ir-604bdd.fly.dev/healthz`

## Single-Service Deployment

Use this path for submissions and demos.

```bash
npm ci
npm run build
FIR_DASHBOARD_DIST=dashboard/dist FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

The service listens on `PORT` or `8787` and exposes:

- `GET /healthz`
- `POST /v1/events`
- `GET /v1/incidents`
- `GET /v1/incidents/:id`
- `PATCH /v1/incidents/:id`
- `GET /v1/stats/summary`
- `/` for the dashboard when `FIR_DASHBOARD_DIST` is set

Docker:

```bash
docker build -t fiber-ir .
docker run --rm -p 8787:8787 -e FIR_STORE_FILE=/data/incidents.json -v fiber-ir-data:/data fiber-ir
```

Fly.io app:

```bash
fly deploy
```

The included `fly.toml` runs one 512MB shared-CPU machine in `iad`, mounts a 1GB volume at `/data`, and stores incidents at `/data/incidents.json`.

## Hosted Fiber Sender Node

The public invoice sender uses one separate Fly app running `nervos/fiber:0.9.0-rc7`:

- app: `fiber-ir-fnn-a-604bdd`
- config: `fly.fnn-a.toml`
- persistent data: `fiber_ir_fnn_a` mounted at `/fiber`
- private Fiber RPC: `http://fiber-ir-fnn-a-604bdd.internal:18227`
- public Fiber P2P: `fiber-ir-fnn-a-604bdd.fly.dev:8228`

Deploy the sender node after setting throwaway testnet secrets:

```bash
fly secrets set -c fly.fnn-a.toml FIBER_SECRET_KEY_PASSWORD=... CKB_SECRET_KEY=...
fly deploy -c fly.fnn-a.toml --remote-only
```

The raw FNN RPC is intentionally not public. The dashboard calls the FiberIR API,
and the API calls the sender node over Fly private networking. The API uses
`FIR_DEMO_SENDER_RPC_URL` to find that node.

Fly trial orgs stop machines after a few minutes and eventually block starts
until billing is enabled. Enable billing before judging so the API and sender
node can stay online.

## Split API and Dashboard

Use this path when deploying the dashboard to a static host and the API elsewhere.

API:

```bash
npm ci
npm run typecheck
npm --workspace @fiber-ir/api run build
FIR_CORS_ORIGIN=https://your-dashboard.example FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

Dashboard:

```bash
npm ci
VITE_FIR_API_BASE_URL=https://your-api.example npm --workspace @fiber-ir/dashboard run build
```

Deploy `dashboard/dist` to the static host.

## Environment

Copy `.env.example` and set values for the target platform. `FIR_STORE_FILE` is recommended outside local demos because the default store is in-memory and resets on process restart.

Live invoice sender variables:

- `FIR_DEMO_SENDER_RPC_URL`: private Fiber RPC URL used by `/v1/demo/pay-invoice`.
- `FIR_DEMO_SENDER_P2P_ADDR`: display-only P2P address for the hosted sender node.
- `FIR_DEMO_PAYMENT_TIMEOUT_SECONDS`: Fiber `send_payment` timeout, default `60`.
- `FIR_DEMO_PAYMENT_TIMEOUT_MS`: FiberIR polling timeout, default `30000`.

## Pre-Submission Gate

```bash
npm ci
npm run verify
npm run build
FIR_DASHBOARD_DIST=dashboard/dist FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

Then check `http://127.0.0.1:8787/healthz` and open `http://127.0.0.1:8787/?demo=1`.

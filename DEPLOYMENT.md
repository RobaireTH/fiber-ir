# Deployment

Fiber Incident Recorder can deploy as one Node web service that serves both the API and the built dashboard.

Current hosted demo:

- `https://fiber-ir-604bdd.fly.dev/`
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

Fly.io:

```bash
fly deploy
```

The included `fly.toml` runs one 512MB shared-CPU machine in `iad`, mounts a 1GB volume at `/data`, and stores incidents at `/data/incidents.json`.

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

## Pre-Submission Gate

```bash
npm ci
npm run verify
npm run build
FIR_DASHBOARD_DIST=dashboard/dist FIR_STORE_FILE=.data/fiber-ir-incidents.json npm start
```

Then check `http://127.0.0.1:8787/healthz` and open `http://127.0.0.1:8787/?demo=1`.

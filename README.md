# Fiber Incident Recorder

Hackathon scaffold for **Fiber Incident Recorder + Diagnostics API**: a
TypeScript diagnostics/API/dashboard layer around upstream Fiber JSON-RPC.

## Goal

Record Fiber payment failures through an explicit wallet/merchant wrapper or
collector integration, classify them into canonical incident types, persist the
incident history, expose a REST API, and provide a dashboard for investigation,
remediation, and retry outcome.

This repo does not replace upstream Fiber. Fiber itself remains the Rust
payment/networking implementation. Fiber Incident Recorder consumes payment
attempt outcomes and optional snapshots from Fiber JSON-RPC or SDK wrappers, then
stores diagnostic records with provenance labels.

## Scaffold

- `shared/` - shared event, incident, provenance, and remediation types.
- `classifier/` - deterministic incident classification and remediation catalog.
- `collector/` - Fiber RPC wrapper, snapshot hooks, and fixture replay stubs.
- `api/` - Fastify REST API with in-memory and optional JSON-file stores.
- `sdk/` - TypeScript client and `wrapPayment` helper.
- `dashboard/` - React/Vite dashboard shell for the incident workflow.
- `examples/` - demo event fixtures and smoke scripts.
- `docs/` - plans, scope notes, API notes, demo guide, and QA checklist.

## Local Development

1. Install dependencies with `npm install`.
2. Start the diagnostics API with `npm run dev:api`.
3. In another shell, start the dashboard with `npm run dev:dashboard`.
4. Post the fixture demo incident with `npm run demo:fixture`.

The API listens on `PORT` or `8787` by default. The fixture demo posts to
`FIR_API_URL` or `http://localhost:8787` by default.

## Docs

- [API and event contract](docs/api.md)
- [Development and demo guide](docs/dev-and-demo.md)
- [Hackathon scope and provenance policy](docs/hackathon-scope.md)
- [QA checklist](docs/qa-checklist.md)

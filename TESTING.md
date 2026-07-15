# Testing

Fiber Incident Recorder uses TypeScript project references and Vitest.

## Commands

```bash
npm run typecheck
npm test
npm --workspace @fiber-ir/dashboard run build
```

For the full pre-submission gate, run:

```bash
npm run verify
```

## Coverage Areas

- `classifier/classifier.test.ts` covers deterministic incident class mapping and remediation behavior.
- `collector/fiber-rpc.test.ts` covers Fiber JSON-RPC request/response handling and payment observation edge cases.
- `api/src/routes/incidents.test.ts` covers event ingestion, deduplication, incident state transitions, JSON-file persistence, CORS, dashboard static serving, verified replay, and live invoice sender success/failure handling with mocked Fiber RPC.

## Expectations

New classifier rules need positive and fallback tests. New collector behavior needs mocked JSON-RPC responses for success, malformed payloads, and upstream errors. New API routes need `app.inject` tests for validation, status codes, and persistence effects.

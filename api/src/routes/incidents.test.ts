import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FiberIncidentEventV1, IncidentRecord, IncidentStatus } from "@fiber-ir/shared";
import { buildServer } from "../server.js";
import { JsonFileIncidentRepository, type IncidentRepository, type IngestResult } from "../store/incidents-repo.js";
import { registerEventRoutes } from "./events.js";
import { registerIncidentRoutes } from "./incidents.js";

type ListResponse = {
  items: IncidentRecord[];
  nextCursor: null;
};

type SummaryResponse = {
  total: number;
  open: number;
  highSeverity: number;
  resolved: number;
};

const apps: FastifyInstance[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.FIR_DEMO_NODE_A_RPC_URL;
  delete process.env.FIR_DEMO_NODE_A_P2P_ADDR;
  delete process.env.FIR_DEMO_SENDER_RPC_URL;
  delete process.env.FIR_DEMO_SENDER_P2P_ADDR;
  delete process.env.FIR_DEMO_PAYMENT_TIMEOUT_MS;

  for (const app of apps.splice(0)) {
    await app.close();
  }

  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("incident API routes", () => {
  it("rejects invalid event payloads", async () => {
    const app = await testServer();

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: {
        schemaVersion: "fiber-ir.event.v1",
        eventId: "evt_invalid_payload_001",
        observedAt: "not-a-date",
        source: "fiber_rpc",
        kind: "payment_attempt_failed"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(json<{ error: string; issues: unknown[] }>(response)).toMatchObject({
      error: "Invalid fiber-ir.event.v1 payload"
    });
  });

  it("ingests a failed payment event, deduplicates repeats, and exposes list/detail/summary", async () => {
    const app = await testServer();
    const event = paymentAttemptFailedEvent({
      eventId: "evt_no_route_001",
      observedAt: "2026-07-07T10:00:00.000Z",
      paymentId: "pay_no_route_001",
      invoiceId: "inv_no_route_001"
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: event
    });

    expect(created.statusCode).toBe(201);
    const createdBody = json<IngestResult>(created);
    expect(createdBody).toMatchObject({
      eventId: "evt_no_route_001",
      action: "created",
      incidentId: "inc_no_route_001"
    });
    expect(createdBody.incident).toMatchObject({
      id: "inc_no_route_001",
      paymentId: "pay_no_route_001",
      invoiceId: "inv_no_route_001",
      incidentStatus: "OPEN",
      normalizedClass: "NO_ROUTE",
      severity: "HIGH"
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: event
    });

    expect(duplicate.statusCode).toBe(200);
    expect(json<IngestResult>(duplicate)).toEqual({
      eventId: "evt_no_route_001",
      action: "deduplicated"
    });

    const list = await app.inject({ method: "GET", url: "/v1/incidents" });
    expect(list.statusCode).toBe(200);
    const listBody = json<ListResponse>(list);
    expect(listBody.nextCursor).toBeNull();
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]?.id).toBe("inc_no_route_001");

    const detail = await app.inject({ method: "GET", url: "/v1/incidents/inc_no_route_001" });
    expect(detail.statusCode).toBe(200);
    expect(json<IncidentRecord>(detail)).toMatchObject({
      id: "inc_no_route_001",
      rawError: {
        failed_error: "no route found"
      },
      redactedPayload: {
        error: {
          raw: "[redacted]"
        }
      }
    });

    const summary = await app.inject({ method: "GET", url: "/v1/stats/summary" });
    expect(summary.statusCode).toBe(200);
    expect(json<SummaryResponse>(summary)).toEqual({
      total: 1,
      open: 1,
      highSeverity: 1,
      resolved: 0
    });
  });

  it("patches incident status and filters the incident list by status", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_retrying_001",
        observedAt: "2026-07-07T11:00:00.000Z",
        paymentId: "pay_retrying_001"
      })
    );

    const patched = await app.inject({
      method: "PATCH",
      url: "/v1/incidents/inc_retrying_001",
      payload: {
        incidentStatus: "RETRYING" satisfies IncidentStatus,
        resolutionNote: "Retry scheduled by operator."
      }
    });

    expect(patched.statusCode).toBe(200);
    expect(json<IncidentRecord>(patched)).toMatchObject({
      id: "inc_retrying_001",
      incidentStatus: "RETRYING",
      resolutionNote: "Retry scheduled by operator."
    });

    const retrying = await app.inject({ method: "GET", url: "/v1/incidents?status=RETRYING" });
    expect(retrying.statusCode).toBe(200);
    const retryingBody = json<ListResponse>(retrying);
    expect(retryingBody.items.map((incident) => incident.id)).toEqual(["inc_retrying_001"]);

    const open = await app.inject({ method: "GET", url: "/v1/incidents?status=OPEN" });
    expect(open.statusCode).toBe(200);
    expect(json<ListResponse>(open).items).toEqual([]);
  });

  it("rejects invalid incident status patches", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_bad_status_001",
        observedAt: "2026-07-07T11:30:00.000Z",
        paymentId: "pay_bad_status_001"
      })
    );

    const patched = await app.inject({
      method: "PATCH",
      url: "/v1/incidents/inc_bad_status_001",
      payload: {
        incidentStatus: "CLOSED"
      }
    });

    expect(patched.statusCode).toBe(400);
    expect(json<{ error: string }>(patched)).toMatchObject({
      error: "Invalid incidentStatus"
    });
  });

  it("runs the verified replay demo and records the resolved FiberIR flow", async () => {
    const app = await testServer();

    const demo = await app.inject({
      method: "POST",
      url: "/v1/demo/peer-transfer?replay=1"
    });

    expect(demo.statusCode).toBe(200);
    const demoBody = json<{
      mode: string;
      payment: { hash: string; status: string };
      steps: Array<{ id: string; status: string }>;
      fiberIr: { results: IngestResult[] };
    }>(demo);
    expect(demoBody.mode).toBe("verified_replay");
    expect(demoBody.payment).toMatchObject({
      hash: "0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7",
      status: "Success"
    });
    expect(demoBody.steps.map((step) => step.id)).toEqual([
      "nodes",
      "connect",
      "channel",
      "invoice",
      "payment",
      "fiber-ir"
    ]);
    expect(demoBody.fiberIr.results.map((result) => result.action)).toEqual(["created", "updated"]);

    const list = await app.inject({ method: "GET", url: "/v1/incidents" });
    expect(list.statusCode).toBe(200);
    const listBody = json<ListResponse>(list);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({
      paymentId: "0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7",
      fiberPaymentStatus: "Success",
      incidentStatus: "RESOLVED",
      normalizedClass: "CHANNEL_NOT_READY",
      resolutionNote: "Resolved by linked payment_succeeded event."
    });

    const summary = await app.inject({ method: "GET", url: "/v1/stats/summary" });
    expect(summary.statusCode).toBe(200);
    expect(json<SummaryResponse>(summary)).toEqual({
      total: 1,
      open: 0,
      highSeverity: 1,
      resolved: 1
    });
  });

  it("sends a provided invoice from the live sender node without creating a synthetic channel incident", async () => {
    process.env.FIR_DEMO_SENDER_RPC_URL = "http://node-a";
    process.env.FIR_DEMO_SENDER_P2P_ADDR = "/dns6/fiber-ir-node-a.internal/tcp/8228/p2p/QmNodeA";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
        const requestUrl = url.toString();
        const result = liveDemoRpcResult(requestUrl, request.method);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
          headers: { "content-type": "application/json" }
        });
      })
    );

    const app = await testServer();
    const demo = await app.inject({
      method: "POST",
      url: "/v1/demo/pay-invoice",
      payload: {
        invoice: "fibt1liveinvoice"
      }
    });

    expect(demo.statusCode).toBe(200);
    const demoBody = json<{
      mode: string;
      payment: { hash: string; status: string };
      steps: Array<{ id: string; status: string }>;
      fiberIr: { results: IngestResult[] };
    }>(demo);
    expect(demoBody.mode).toBe("live_invoice_payment");
    expect(demoBody.payment).toEqual({
      hash: "0xlivepayment",
      status: "Success",
      fee: "0x0"
    });
    expect(demoBody.steps.map((step) => step.id)).toEqual(["nodes", "invoice", "payment", "fiber-ir"]);
    expect(demoBody.fiberIr.results).toEqual([
      {
        eventId: expect.stringMatching(/^evt_demo_peer_success_/),
        action: "stored"
      }
    ]);

    const list = await app.inject({ method: "GET", url: "/v1/incidents" });
    expect(list.statusCode).toBe(200);
    expect(json<ListResponse>(list).items).toEqual([]);

    const summary = await app.inject({ method: "GET", url: "/v1/stats/summary" });
    expect(summary.statusCode).toBe(200);
    expect(json<SummaryResponse>(summary)).toEqual({
      total: 0,
      open: 0,
      highSeverity: 0,
      resolved: 0
    });
  });

  it("records a real live invoice payment failure as an incident", async () => {
    process.env.FIR_DEMO_SENDER_RPC_URL = "http://node-a";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
        const requestUrl = url.toString();
        if (request.method === "send_payment") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32603, message: "no route found for invoice recipient" }
            }),
            { headers: { "content-type": "application/json" } }
          );
        }

        const result = liveDemoRpcResult(requestUrl, request.method);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
          headers: { "content-type": "application/json" }
        });
      })
    );

    const app = await testServer();
    const demo = await app.inject({
      method: "POST",
      url: "/v1/demo/pay-invoice",
      payload: {
        invoice: "fibt1unreachableinvoice"
      }
    });

    expect(demo.statusCode).toBe(200);
    const demoBody = json<{
      payment: { hash: string; status: string; failure: string };
      fiberIr: { results: IngestResult[] };
    }>(demo);
    expect(demoBody.payment).toEqual({
      hash: expect.stringMatching(/^live_invoice_/),
      status: "Failed",
      fee: "0x0",
      failure: "no route found for invoice recipient"
    });
    expect(demoBody.fiberIr.results[0]).toMatchObject({
      action: "created",
      incidentId: expect.stringMatching(/^inc_demo_peer_failure_/)
    });

    const list = await app.inject({ method: "GET", url: "/v1/incidents" });
    expect(list.statusCode).toBe(200);
    const incidents = json<ListResponse>(list).items;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      normalizedClass: "NO_ROUTE",
      rawError: {
        status: "Failed",
        failed_error: "no route found for invoice recipient"
      }
    });
  });

  it("filters the incident list by normalized class", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_class_no_route_001",
        observedAt: "2026-07-07T11:40:00.000Z",
        paymentId: "pay_class_no_route_001",
        errorMessage: "no route found"
      })
    );
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_class_invoice_expired_001",
        observedAt: "2026-07-07T11:41:00.000Z",
        paymentId: "pay_class_invoice_expired_001",
        errorMessage: "invoice expired"
      })
    );

    const filtered = await app.inject({ method: "GET", url: "/v1/incidents?class=INVOICE_EXPIRED" });

    expect(filtered.statusCode).toBe(200);
    const body = json<ListResponse>(filtered);
    expect(body.items.map((incident) => incident.id)).toEqual(["inc_class_invoice_expired_001"]);
    expect(body.items[0]?.normalizedClass).toBe("INVOICE_EXPIRED");
  });

  it("resolves an open incident when a linked payment_succeeded event arrives", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_linked_failure_001",
        observedAt: "2026-07-07T12:00:00.000Z",
        paymentId: "pay_linked_001",
        invoiceId: "inv_linked_001"
      })
    );

    const resolved = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: paymentSucceededEvent({
        eventId: "evt_linked_success_001",
        observedAt: "2026-07-07T12:02:00.000Z",
        paymentId: "pay_linked_001",
        invoiceId: "inv_linked_001"
      })
    });

    expect(resolved.statusCode).toBe(200);
    expect(json<IngestResult>(resolved)).toMatchObject({
      eventId: "evt_linked_success_001",
      action: "updated",
      incidentId: "inc_linked_failure_001",
      incident: {
        id: "inc_linked_failure_001",
        fiberPaymentStatus: "Success",
        incidentStatus: "RESOLVED",
        resolutionNote: "Resolved by linked payment_succeeded event."
      }
    });

    const detail = await app.inject({ method: "GET", url: "/v1/incidents/inc_linked_failure_001" });
    expect(detail.statusCode).toBe(200);
    expect(json<IncidentRecord>(detail)).toMatchObject({
      incidentStatus: "RESOLVED",
      fiberPaymentStatus: "Success"
    });

    const summary = await app.inject({ method: "GET", url: "/v1/stats/summary" });
    expect(summary.statusCode).toBe(200);
    expect(json<SummaryResponse>(summary)).toEqual({
      total: 1,
      open: 0,
      highSeverity: 1,
      resolved: 1
    });
  });

  it("resolves an open incident by invoice when the succeeding payment id changes", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_invoice_linked_failure_001",
        observedAt: "2026-07-07T12:10:00.000Z",
        paymentId: "pay_invoice_linked_original_001",
        invoiceId: "inv_invoice_linked_001"
      })
    );

    const resolved = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: paymentSucceededEvent({
        eventId: "evt_invoice_linked_success_001",
        observedAt: "2026-07-07T12:12:00.000Z",
        paymentId: "pay_invoice_linked_replacement_001",
        invoiceId: "inv_invoice_linked_001"
      })
    });

    expect(resolved.statusCode).toBe(200);
    expect(json<IngestResult>(resolved)).toMatchObject({
      eventId: "evt_invoice_linked_success_001",
      action: "updated",
      incidentId: "inc_invoice_linked_failure_001",
      incident: {
        id: "inc_invoice_linked_failure_001",
        paymentId: "pay_invoice_linked_original_001",
        invoiceId: "inv_invoice_linked_001",
        fiberPaymentStatus: "Success",
        incidentStatus: "RESOLVED"
      }
    });
  });

  it("stores duplicate non-incident events once without creating incidents", async () => {
    const app = await testServer();
    const event = paymentSucceededEvent({
      eventId: "evt_unmatched_success_001",
      observedAt: "2026-07-07T13:00:00.000Z",
      paymentId: "pay_unmatched_001"
    });

    const stored = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: event
    });

    expect(stored.statusCode).toBe(200);
    expect(json<IngestResult>(stored)).toEqual({
      eventId: "evt_unmatched_success_001",
      action: "stored"
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: event
    });

    expect(duplicate.statusCode).toBe(200);
    expect(json<IngestResult>(duplicate)).toEqual({
      eventId: "evt_unmatched_success_001",
      action: "deduplicated"
    });

    const list = await app.inject({ method: "GET", url: "/v1/incidents" });
    expect(json<ListResponse>(list).items).toEqual([]);
  });

  it("does not leak raw secrets in redactedPayload", async () => {
    const app = await testServer();
    await postEvent(
      app,
      paymentAttemptFailedEvent({
        eventId: "evt_redacted_secret_001",
        observedAt: "2026-07-07T13:10:00.000Z",
        paymentId: "pay_redacted_secret_001",
        rawError: {
          code: -32601,
          message: "Method not found",
          data: {
            method: "send_payment",
            token: "secret-token"
          }
        }
      })
    );

    const detail = await app.inject({ method: "GET", url: "/v1/incidents/inc_redacted_secret_001" });

    expect(detail.statusCode).toBe(200);
    const incident = json<IncidentRecord>(detail);
    expect(incident.redactedPayload).toMatchObject({
      error: {
        raw: "[redacted]"
      }
    });
    expect(JSON.stringify(incident.redactedPayload)).not.toContain("secret-token");
  });

  it("can run the API against a JSON-file repository and preserve dedupe and resolved status across reload", async () => {
    const storeFile = tempStoreFile();
    const event = paymentAttemptFailedEvent({
      eventId: "evt_file_store_001",
      observedAt: "2026-07-07T13:30:00.000Z",
      paymentId: "pay_file_store_001"
    });
    const firstApp = await testServer(new JsonFileIncidentRepository(storeFile));

    await postEvent(firstApp, event);
    const resolved = await firstApp.inject({
      method: "PATCH",
      url: "/v1/incidents/inc_file_store_001",
      payload: {
        incidentStatus: "RESOLVED" satisfies IncidentStatus,
        resolutionNote: "Resolved before API restart."
      }
    });

    expect(resolved.statusCode).toBe(200);

    const reloadedApp = await testServer(new JsonFileIncidentRepository(storeFile));
    const duplicate = await reloadedApp.inject({
      method: "POST",
      url: "/v1/events",
      payload: event
    });

    expect(duplicate.statusCode).toBe(200);
    expect(json<IngestResult>(duplicate)).toEqual({
      eventId: "evt_file_store_001",
      action: "deduplicated"
    });

    const list = await reloadedApp.inject({ method: "GET", url: "/v1/incidents" });
    expect(json<ListResponse>(list).items).toMatchObject([
      {
        id: "inc_file_store_001",
        incidentStatus: "RESOLVED",
        resolutionNote: "Resolved before API restart."
      }
    ]);
  });

  it("registers routes against the repository interface instead of the in-memory class", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const fakeRepo: IncidentRepository = {
      ingestEvent(event) {
        return { eventId: event.eventId, action: "stored" };
      },
      list() {
        return [];
      },
      get() {
        return undefined;
      },
      updateStatus() {
        return undefined;
      },
      summary() {
        return {
          total: 0,
          open: 0,
          highSeverity: 0,
          resolved: 0
        };
      }
    };

    await registerEventRoutes(app, fakeRepo);
    await registerIncidentRoutes(app, fakeRepo);

    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: paymentSucceededEvent({
        eventId: "evt_fake_repo_001",
        observedAt: "2026-07-07T14:00:00.000Z",
        paymentId: "pay_fake_repo_001"
      })
    });

    expect(response.statusCode).toBe(200);
    expect(json<IngestResult>(response)).toEqual({
      eventId: "evt_fake_repo_001",
      action: "stored"
    });
  });

  it("adds CORS headers for configured origins and handles preflight requests", async () => {
    const app = await configuredServer({
      corsOrigin: "https://dashboard.example, http://localhost:5173"
    });

    const allowed = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: {
        origin: "https://dashboard.example"
      }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://dashboard.example");
    expect(allowed.headers.vary).toBe("Origin");

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/incidents",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-headers": "content-type,authorization"
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(preflight.headers["access-control-allow-headers"]).toBe("content-type,authorization");

    const blocked = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: {
        origin: "https://untrusted.example"
      }
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves dashboard assets from a configured production build directory", async () => {
    const dashboardDistDir = tempDashboardDist();
    const app = await configuredServer({ dashboardDistDir });

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.payload).toContain("<div id=\"root\"></div>");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.payload).toBe("console.log('fiber-ir');");

    const spaFallback = await app.inject({ method: "GET", url: "/incidents" });
    expect(spaFallback.statusCode).toBe(200);
    expect(spaFallback.payload).toContain("<div id=\"root\"></div>");

    const missingAsset = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(missingAsset.statusCode).toBe(404);

    const traversal = await app.inject({ method: "GET", url: "/%2e%2e/package.json" });
    expect(traversal.statusCode).toBe(404);
  });
});

async function testServer(repo?: IncidentRepository): Promise<FastifyInstance> {
  const app = await buildServer({ logger: false, repo });
  apps.push(app);
  return app;
}

async function configuredServer(options: Omit<NonNullable<Parameters<typeof buildServer>[0]>, "logger">): Promise<FastifyInstance> {
  const app = await buildServer({ logger: false, ...options });
  apps.push(app);
  return app;
}

function tempStoreFile(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "fiber-ir-api-"));
  tempDirs.push(tempDir);
  return join(tempDir, "store.json");
}

function tempDashboardDist(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "fiber-ir-dashboard-"));
  const assetsDir = join(tempDir, "assets");
  tempDirs.push(tempDir);
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(tempDir, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  writeFileSync(join(assetsDir, "app.js"), "console.log('fiber-ir');", "utf8");
  return tempDir;
}

async function postEvent(app: FastifyInstance, event: FiberIncidentEventV1): Promise<IngestResult> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/events",
    payload: event
  });

  expect(response.statusCode).toBe(201);
  return json<IngestResult>(response);
}

function paymentAttemptFailedEvent(input: {
  eventId: string;
  observedAt: string;
  paymentId: string;
  invoiceId?: string;
  errorMessage?: string;
  rawError?: unknown;
}): FiberIncidentEventV1 {
  const errorMessage = input.errorMessage ?? "no route found";

  return {
    schemaVersion: "fiber-ir.event.v1",
    eventId: input.eventId,
    observedAt: input.observedAt,
    source: "fixture_replay",
    projectId: "test-project",
    environment: "testnet",
    kind: "payment_attempt_failed",
    provenance: {
      payment: "fixture",
      error: "fixture",
      routeSummary: "fixture",
      normalizedClass: "inferred"
    },
    payment: {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      senderNode: "alice-node",
      destinationNode: "bob-node",
      fiberPaymentStatus: "Failed",
      asset: "CKB",
      amount: "10000"
    },
    attempt: {
      correlationId: `${input.paymentId}-correlation`,
      retryCount: 0,
      routeSummary: {
        routers: [],
        failureSource: "unknown"
      }
    },
    error: {
      message: errorMessage,
      raw: input.rawError ?? {
        failed_error: errorMessage
      }
    }
  };
}

function paymentSucceededEvent(input: {
  eventId: string;
  observedAt: string;
  paymentId: string;
  invoiceId?: string;
}): FiberIncidentEventV1 {
  return {
    schemaVersion: "fiber-ir.event.v1",
    eventId: input.eventId,
    observedAt: input.observedAt,
    source: "fixture_replay",
    projectId: "test-project",
    environment: "testnet",
    kind: "payment_succeeded",
    provenance: {
      payment: "fixture"
    },
    payment: {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      senderNode: "alice-node",
      destinationNode: "bob-node",
      fiberPaymentStatus: "Success",
      asset: "CKB",
      amount: "10000"
    }
  };
}

function liveDemoRpcResult(requestUrl: string, method: string): unknown {
  const channel = {
    channel_id: "0xlivechannel",
    channel_outpoint: "0xliveoutpoint",
    pubkey: "0xnodeb",
    state: { state_name: "ChannelReady" },
    local_balance: "0x5f5e100",
    remote_balance: "0x5f5e100"
  };

  if (method === "node_info" && requestUrl === "http://node-a") {
    return {
      pubkey: "0xnodea",
      node_name: "fiber-ir-fly-node-a",
      addresses: ["/dns6/fiber-ir-node-a.internal/tcp/8228/p2p/QmNodeA"]
    };
  }

  if (method === "node_info" && requestUrl === "http://node-b") {
    return {
      pubkey: "0xnodeb",
      node_name: "fiber-ir-fly-node-b",
      addresses: ["/dns6/fiber-ir-node-b.internal/tcp/8228/p2p/QmNodeB"]
    };
  }

  if (method === "connect_peer") return null;
  if (method === "list_channels") return { channels: [channel] };
  if (method === "new_invoice") {
    return {
      invoice_address: "fibt1liveinvoice",
      invoice: {
        currency: "Fibt",
        amount: "0xf4240",
        data: {
          payment_hash: "0xlivepayment"
        }
      }
    };
  }
  if (method === "send_payment") {
    return {
      payment_hash: "0xlivepayment",
      status: "Success",
      fee: "0x0"
    };
  }

  throw new Error(`Unexpected live demo RPC call ${method} to ${requestUrl}`);
}

function json<T>(response: { payload: string }): T {
  return JSON.parse(response.payload) as T;
}

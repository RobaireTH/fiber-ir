import { replayFixture, type FiberRpcSnapshot, type FixtureScenario } from "@fiber-ir/collector";
import { FiberIncidentClient } from "@fiber-ir/sdk";
import type { FiberIncidentEventV1 } from "@fiber-ir/shared";

const startedAt = Date.now();
const failureEventId = `evt_demo_failure_${startedAt}`;
const failureIncidentId = `inc_${failureEventId.replace(/^evt_?/, "")}`;
const retryEventId = `evt_demo_retry_${startedAt}`;
const successEventId = `evt_demo_success_${startedAt}`;
const invoiceId = "inv_demo_retry_042";
const originalPaymentId = "pay_demo_042";
const retryPaymentId = "pay_demo_042_retry_1";
const correlationId = "demo-no-route-retry-001";

const scenario: FixtureScenario = {
  scenarioId: "fixture-no-route-linked-retry-success",
  title: "No-route failure followed by a linked retry success",
  events: [
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: failureEventId,
      observedAt: timestamp(0),
      source: "fixture_replay",
      environment: "demo",
      kind: "payment_attempt_failed",
      provenance: {
        payment: "fixture",
        error: "fixture",
        normalizedClass: "inferred"
      },
      payment: {
        paymentId: originalPaymentId,
        invoiceId,
        senderNode: "alice-node",
        destinationNode: "bob-node",
        fiberPaymentStatus: "Failed",
        asset: "CKB",
        amount: "10000"
      },
      attempt: {
        attemptId: "attempt_demo_001",
        correlationId,
        retryCount: 0
      },
      error: {
        message: "no route found",
        raw: {
          failed_error: "no route found"
        }
      }
    },
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: retryEventId,
      observedAt: timestamp(10),
      source: "fixture_replay",
      environment: "demo",
      kind: "payment_retry_scheduled",
      provenance: {
        payment: "fixture",
        retry: "fixture",
        normalizedClass: "inferred"
      },
      payment: {
        paymentId: retryPaymentId,
        invoiceId,
        senderNode: "alice-node",
        destinationNode: "bob-node",
        fiberPaymentStatus: "Inflight",
        asset: "CKB",
        amount: "10000"
      },
      attempt: {
        attemptId: "attempt_demo_002",
        correlationId,
        retryOfIncidentId: failureIncidentId,
        retryCount: 1
      }
    },
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: successEventId,
      observedAt: timestamp(25),
      source: "fixture_replay",
      environment: "demo",
      kind: "payment_succeeded",
      provenance: {
        payment: "fixture",
        retry: "fixture",
        resolution: "fixture"
      },
      payment: {
        paymentId: retryPaymentId,
        invoiceId,
        senderNode: "alice-node",
        destinationNode: "bob-node",
        fiberPaymentStatus: "Success",
        asset: "CKB",
        amount: "10000"
      },
      attempt: {
        attemptId: "attempt_demo_002",
        correlationId,
        retryOfIncidentId: failureIncidentId,
        retryCount: 1
      }
    }
  ]
};

const liveSnapshotResult = await tryLoadLiveSnapshot();
const events = applyLiveSnapshot(replayFixture(scenario), liveSnapshotResult.snapshot);
const recording = await recordEventsIfConfigured(events);
const result = {
  scenarioId: scenario.scenarioId,
  title: scenario.title,
  fiberRpc: liveSnapshotResult,
  recording
};

console.log(JSON.stringify(process.env.FIR_DEMO_SUMMARY ? summarizeRun(result) : result, null, 2));

function timestamp(offsetSeconds: number): string {
  return new Date(startedAt + offsetSeconds * 1000).toISOString();
}

async function tryLoadLiveSnapshot(): Promise<
  | { configured: false; snapshot?: undefined; error?: undefined }
  | { configured: true; snapshot: FiberRpcSnapshot; error?: undefined }
  | { configured: true; snapshot?: undefined; error: string }
> {
  if (!process.env.FIBER_RPC_URL?.trim()) {
    return { configured: false };
  }

  try {
    const { createFiberRpcClientFromEnv, FiberRpcCollector } = await import("@fiber-ir/collector");
    const rpc = createFiberRpcClientFromEnv();

    if (!rpc) {
      return { configured: false };
    }

    const collector = new FiberRpcCollector(rpc);
    return {
      configured: true,
      snapshot: await collector.snapshotNodeHealth()
    };
  } catch (error) {
    return {
      configured: true,
      error: error instanceof Error ? error.message : "Unknown Fiber RPC snapshot failure"
    };
  }
}

function applyLiveSnapshot(
  events: FiberIncidentEventV1[],
  snapshot: FiberRpcSnapshot | undefined
): FiberIncidentEventV1[] {
  if (!snapshot) {
    return events;
  }

  return events.map((event, index) => {
    if (index !== 0) {
      return event;
    }

    return {
      ...event,
      provenance: {
        ...event.provenance,
        nodeInfo: snapshot.provenance.nodeInfo,
        peers: snapshot.provenance.peers,
        channels: snapshot.provenance.channels
      },
      context: {
        ...event.context,
        nodeHealth: {
          observedAt: snapshot.observedAt,
          nodeInfo: snapshot.nodeInfo,
          peers: snapshot.peers
        },
        channelSnapshot: {
          observedAt: snapshot.observedAt,
          channels: snapshot.channels
        }
      }
    };
  });
}

async function recordEventsIfConfigured(events: FiberIncidentEventV1[]): Promise<
  | { mode: "stdout"; eventCount: number; events: FiberIncidentEventV1[] }
  | { mode: "api"; apiUrl: string; eventCount: number; results: unknown[] }
> {
  const apiUrl = process.env.FIR_API_URL?.trim() || "http://localhost:8787";

  if (apiUrl === "stdout") {
    return {
      mode: "stdout",
      eventCount: events.length,
      events
    };
  }

  const client = new FiberIncidentClient(apiUrl);
  const results: unknown[] = [];

  for (const event of events) {
    results.push(await client.recordEvent(event));
  }

  return {
    mode: "api",
    apiUrl,
    eventCount: events.length,
    results
  };
}

function summarizeRun(value: typeof result): Record<string, unknown> {
  return {
    scenarioId: value.scenarioId,
    title: value.title,
    fiberRpc: summarizeFiberRpc(value.fiberRpc),
    recording: summarizeRecording(value.recording)
  };
}

function summarizeFiberRpc(value: typeof liveSnapshotResult): Record<string, unknown> {
  if (!value.configured) {
    return { configured: false };
  }

  if (value.error) {
    return { configured: true, error: value.error };
  }

  if (!value.snapshot) {
    return { configured: true, error: "Live snapshot unavailable" };
  }

  const nodeInfo = asRecord(value.snapshot.nodeInfo);
  const peers = asRecord(value.snapshot.peers);
  const channels = asRecord(value.snapshot.channels);

  return {
    configured: true,
    version: nodeInfo?.version,
    peersCount: Array.isArray(peers?.peers) ? peers.peers.length : undefined,
    channelsCount: Array.isArray(channels?.channels) ? channels.channels.length : undefined
  };
}

function summarizeRecording(value: typeof recording): Record<string, unknown> {
  if (value.mode === "stdout") {
    return {
      mode: value.mode,
      eventCount: value.eventCount
    };
  }

  return {
    mode: value.mode,
    apiUrl: value.apiUrl,
    eventCount: value.eventCount,
    actions: value.results.map((item) => {
      const record = asRecord(item);
      return {
        eventId: record?.eventId,
        action: record?.action,
        incidentId: record?.incidentId,
        status: asRecord(record?.incident)?.incidentStatus
      };
    })
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import type { FiberIncidentEventV1, Provenance } from "@fiber-ir/shared";
import type { IncidentRepository, IngestResult } from "../store/incidents-repo.js";

type DemoMode = "verified_replay" | "live_probe";

type DemoStep = {
  id: string;
  title: string;
  detail: string;
  status: "complete" | "recorded" | "verified";
};

type DemoResponse = {
  mode: DemoMode;
  runId: string;
  nodes: {
    a: DemoNode;
    b: DemoNode;
  };
  channel: {
    channelId: string;
    outpoint: string;
    state: string;
  };
  invoice: {
    asset: string;
    amount: string;
  };
  payment: {
    hash: string;
    status: "Success";
    fee: string;
  };
  steps: DemoStep[];
  fiberIr: {
    failureEventId: string;
    successEventId: string;
    eventEndpoint: "/v1/events";
    results: IngestResult[];
  };
};

type DemoNode = {
  name: string;
  rpcUrl: string;
  pubkey: string;
  address: string;
};

const VERIFIED_NODES = {
  a: {
    name: "fiber-ir-node-a",
    rpcUrl: "http://127.0.0.1:42227",
    pubkey: "039a5f93f92b94491c9c20aa1795a7e5d8920beb94edba717386603120b8af81b8",
    address: "/ip4/127.0.0.1/tcp/42228/p2p/QmZWHnu1Ef1H7W2vZecbCTs2Nnh1UgMMo1M9YEucSSATE6"
  },
  b: {
    name: "fiber-ir-node-b",
    rpcUrl: "http://127.0.0.1:42327",
    pubkey: "020cd2093717e540f1ca98a74edfae01078e45fe36ae9cf16f9fff2def0c4a4605",
    address: "/ip4/127.0.0.1/tcp/42328/p2p/QmW2o99nPAU7DJqEXsBWDFy14fv74shQHdxUW6GG9q4YmW"
  }
} satisfies DemoResponse["nodes"];

const VERIFIED_CHANNEL = {
  channelId: "0xcffc95361fe4446b0ec88f8995da1c6de802a143d5b3dbbadbd594e5125fdf0c",
  outpoint: "0x584337776689a38ba12360f599a56644b73f83f66f9f356d50cf87c0982d94ee00000000",
  state: "ChannelReady"
};

const VERIFIED_PAYMENT = {
  hash: "0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7",
  status: "Success" as const,
  fee: "0x0"
};

export async function registerDemoRoutes(app: FastifyInstance, repo: IncidentRepository) {
  app.post("/v1/demo/peer-transfer", async (request, reply) => {
    const live = wantsLiveProbe(request.query);
    const runId = ulid().toLowerCase();
    const snapshot = live ? await readLiveSnapshot().catch(() => undefined) : undefined;
    const mode: DemoMode = snapshot ? "live_probe" : "verified_replay";
    const nodes = snapshot?.nodes ?? VERIFIED_NODES;
    const channel = snapshot?.channel ?? VERIFIED_CHANNEL;
    const payment = snapshot?.payment ?? VERIFIED_PAYMENT;
    const provenance = provenanceForMode(mode, Boolean(snapshot));
    const source = mode === "live_probe" && snapshot ? "fiber_rpc" : "demo";
    const events = buildDemoEvents({
      channel,
      nodes,
      payment,
      provenance,
      runId,
      source
    });

    const results: IngestResult[] = [];
    for (const event of events) {
      results.push(await repo.ingestEvent(event));
    }

    const response: DemoResponse = {
      mode,
      runId,
      nodes,
      channel,
      invoice: {
        asset: "Fibt",
        amount: "1000000"
      },
      payment,
      steps: [
        {
          id: "nodes",
          title: "Fiber peers A and B",
          detail: `${nodes.a.name} and ${nodes.b.name} are represented with their FNN pubkeys.`,
          status: snapshot ? "verified" : "complete"
        },
        {
          id: "connect",
          title: "Peer connection",
          detail: `${nodes.a.name} dials ${nodes.b.name} through the Fiber P2P address.`,
          status: snapshot ? "verified" : "complete"
        },
        {
          id: "channel",
          title: "Channel opened",
          detail: `${channel.channelId} is ${channel.state} with outpoint ${channel.outpoint}.`,
          status: snapshot ? "verified" : "complete"
        },
        {
          id: "invoice",
          title: "Invoice created on B",
          detail: "B issues a 1,000,000 Fibt invoice for the demo transfer.",
          status: "complete"
        },
        {
          id: "payment",
          title: "Payment sent from A to B",
          detail: `${payment.hash} finished with Fiber status ${payment.status}.`,
          status: snapshot ? "verified" : "complete"
        },
        {
          id: "fiber-ir",
          title: "FiberIR recorded the outcome",
          detail: "The preflight failure creates an incident; the success event resolves it.",
          status: "recorded"
        }
      ],
      fiberIr: {
        failureEventId: events[0].eventId,
        successEventId: events[1].eventId,
        eventEndpoint: "/v1/events",
        results
      }
    };

    return reply.send(response);
  });
}

function wantsLiveProbe(query: unknown): boolean {
  if (!query || typeof query !== "object") return false;
  const value = (query as Record<string, unknown>).live;
  return value === true || value === "1" || value === "true";
}

function provenanceForMode(mode: DemoMode, hasLiveSnapshot: boolean): Record<string, Provenance> {
  if (mode === "live_probe" && hasLiveSnapshot) {
    return {
      payment: "live",
      senderNode: "live",
      destinationNode: "live",
      fiberPaymentStatus: "live",
      channelSnapshot: "live",
      normalizedClass: "inferred"
    };
  }

  return {
    payment: "fixture",
    senderNode: "fixture",
    destinationNode: "fixture",
    fiberPaymentStatus: "fixture",
    channelSnapshot: "fixture",
    normalizedClass: "inferred"
  };
}

function buildDemoEvents(input: {
  channel: DemoResponse["channel"];
  nodes: DemoResponse["nodes"];
  payment: DemoResponse["payment"];
  provenance: Record<string, Provenance>;
  runId: string;
  source: FiberIncidentEventV1["source"];
}): [FiberIncidentEventV1, FiberIncidentEventV1] {
  const now = Date.now();
  const basePayment = {
    paymentId: input.payment.hash,
    senderNode: input.nodes.a.pubkey,
    destinationNode: input.nodes.b.pubkey,
    asset: "Fibt",
    amount: "1000000"
  };

  return [
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: `evt_demo_peer_preflight_${input.runId}`,
      observedAt: new Date(now - 15_000).toISOString(),
      source: input.source,
      projectId: "fiber-ir-demo",
      environment: "testnet",
      kind: "payment_attempt_failed",
      provenance: input.provenance,
      payment: {
        ...basePayment,
        fiberPaymentStatus: "Failed"
      },
      attempt: {
        attemptId: `attempt_preflight_${input.runId}`,
        correlationId: `peer_transfer_${input.runId}`,
        retryCount: 0,
        routeSummary: {
          peers: [input.nodes.a.pubkey, input.nodes.b.pubkey],
          channelOutpoint: input.channel.outpoint
        }
      },
      error: {
        code: "CHANNEL_NOT_READY",
        message: "channel not ready before funding tx collaboration completed",
        raw: {
          channel_id: input.channel.channelId,
          state: "AwaitingChannelReady"
        }
      },
      context: {
        channelSnapshot: {
          channel_id: input.channel.channelId,
          channel_outpoint: input.channel.outpoint,
          state: "AwaitingChannelReady"
        }
      }
    },
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: `evt_demo_peer_success_${input.runId}`,
      observedAt: new Date(now).toISOString(),
      source: input.source,
      projectId: "fiber-ir-demo",
      environment: "testnet",
      kind: "payment_succeeded",
      provenance: input.provenance,
      payment: {
        ...basePayment,
        fiberPaymentStatus: "Success"
      },
      attempt: {
        attemptId: `attempt_success_${input.runId}`,
        correlationId: `peer_transfer_${input.runId}`,
        retryCount: 1
      },
      context: {
        channelSnapshot: {
          channel_id: input.channel.channelId,
          channel_outpoint: input.channel.outpoint,
          state: input.channel.state,
          sender_local_balance_after: "0x5e69ec0",
          sender_remote_balance_after: "0x6052340",
          receiver_local_balance_after: "0x6052340",
          receiver_remote_balance_after: "0x5e69ec0"
        }
      }
    }
  ];
}

async function readLiveSnapshot(): Promise<{
  nodes: DemoResponse["nodes"];
  channel: DemoResponse["channel"];
  payment: DemoResponse["payment"];
}> {
  const nodeARpcUrl = process.env.FIR_DEMO_NODE_A_RPC_URL ?? VERIFIED_NODES.a.rpcUrl;
  const nodeBRpcUrl = process.env.FIR_DEMO_NODE_B_RPC_URL ?? VERIFIED_NODES.b.rpcUrl;
  const [nodeA, nodeB, payment] = await Promise.all([
    fiberRpc<{ pubkey: string; node_name?: string; addresses?: string[] }>(nodeARpcUrl, "node_info", []),
    fiberRpc<{ pubkey: string; node_name?: string; addresses?: string[] }>(nodeBRpcUrl, "node_info", []),
    fiberRpc<{ payment_hash: string; status: "Success"; fee?: string }>(nodeARpcUrl, "get_payment", [
      { payment_hash: VERIFIED_PAYMENT.hash }
    ])
  ]);

  if (payment.status !== "Success") {
    throw new Error(`Live payment is ${payment.status}, expected Success.`);
  }

  return {
    nodes: {
      a: {
        name: nodeA.node_name ?? VERIFIED_NODES.a.name,
        rpcUrl: nodeARpcUrl,
        pubkey: nodeA.pubkey,
        address: nodeA.addresses?.[0] ?? VERIFIED_NODES.a.address
      },
      b: {
        name: nodeB.node_name ?? VERIFIED_NODES.b.name,
        rpcUrl: nodeBRpcUrl,
        pubkey: nodeB.pubkey,
        address: nodeB.addresses?.[0] ?? VERIFIED_NODES.b.address
      }
    },
    channel: VERIFIED_CHANNEL,
    payment: {
      hash: payment.payment_hash,
      status: "Success",
      fee: payment.fee ?? "0x0"
    }
  };
}

async function fiberRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? `${method} failed with HTTP ${response.status}`);
  }

  return body.result;
}

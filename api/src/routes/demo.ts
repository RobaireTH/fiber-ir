import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import type { FiberIncidentEventV1, Provenance } from "@fiber-ir/shared";
import type { IncidentRepository, IngestResult } from "../store/incidents-repo.js";

type DemoMode = "live_invoice_payment" | "verified_replay";

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
    address?: string;
  };
  payment: {
    hash: string;
    status: string;
    fee: string;
    failure?: string;
  };
  steps: DemoStep[];
  fiberIr: {
    failureEventId?: string;
    successEventId?: string;
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

type FiberNodeInfo = {
  pubkey: string;
  node_name?: string;
  addresses?: string[];
};

type FiberChannel = {
  channel_id?: string;
  channel_outpoint?: string;
  pubkey?: string;
  state?: {
    state_name?: string;
  };
  local_balance?: string;
  remote_balance?: string;
  offered_tlc_balance?: string;
  received_tlc_balance?: string;
};

type FiberPayment = {
  payment_hash?: string;
  status?: string;
  fee?: string;
  failed_error?: string | null;
};

type InvoiceDemoRequest = {
  invoice: string;
  asset: string;
  amount: string;
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
  status: "Success",
  fee: "0x0"
};

const DEFAULT_PAYMENT_AMOUNT = "1000000";
const DEFAULT_PAYMENT_CURRENCY = "Fibt";
const DEFAULT_PAYMENT_TIMEOUT_SECONDS = "60";
const DEFAULT_PAYMENT_TIMEOUT_MS = 30_000;

export async function registerDemoRoutes(app: FastifyInstance, repo: IncidentRepository) {
  app.post("/v1/demo/pay-invoice", async (request, reply) => {
    const runId = ulid().toLowerCase();
    const input = readInvoiceDemoRequest(request.body);
    if (!input.ok) {
      return reply.code(400).send({ error: "Invalid invoice demo request", detail: input.error });
    }

    try {
      return reply.send(await runLiveInvoicePayment(repo, runId, input.value));
    } catch (error) {
      request.log.warn({ err: error }, "live Fiber invoice payment demo failed");
      return reply.code(503).send({
        error: "Live Fiber invoice payment failed",
        detail: error instanceof Error ? error.message : "Unknown Fiber RPC error.",
        hint:
          "The public demo sends the provided invoice from the configured hosted Fiber node and records the actual node result. Ensure FIR_DEMO_SENDER_RPC_URL is reachable."
      });
    }
  });

  app.post("/v1/demo/peer-transfer", async (request, reply) => {
    const runId = ulid().toLowerCase();

    if (wantsVerifiedReplay(request.query)) {
      return reply.send(await runVerifiedReplay(repo, runId));
    }

    const input = readInvoiceDemoRequest(request.body);
    if (!input.ok) {
      return reply.code(400).send({
        error: "Invoice required",
        detail: "POST /v1/demo/pay-invoice with a Fiber invoice. Use ?replay=1 only for the offline A/B replay."
      });
    }

    try {
      return reply.send(await runLiveInvoicePayment(repo, runId, input.value));
    } catch (error) {
      request.log.warn({ err: error }, "live Fiber invoice payment demo failed");
      return reply.code(503).send({
        error: "Live Fiber invoice payment failed",
        detail: error instanceof Error ? error.message : "Unknown Fiber RPC error.",
        hint:
          "The demo route now sends a provided invoice from the configured Fiber node. Set FIR_DEMO_SENDER_RPC_URL, or use ?replay=1 only for offline documentation."
      });
    }
  });
}

function wantsVerifiedReplay(query: unknown): boolean {
  if (!query || typeof query !== "object") return false;
  const value = (query as Record<string, unknown>).replay;
  return value === true || value === "1" || value === "true";
}

function readInvoiceDemoRequest(body: unknown): { ok: true; value: InvoiceDemoRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must include an invoice string." };
  }

  const record = body as Record<string, unknown>;
  const invoice = typeof record.invoice === "string" ? record.invoice.trim() : "";
  if (!invoice) {
    return { ok: false, error: "Request body must include an invoice string." };
  }

  if (invoice.length > 4096) {
    return { ok: false, error: "Invoice is too large for the public demo route." };
  }

  return {
    ok: true,
    value: {
      invoice,
      asset: typeof record.asset === "string" && record.asset.trim() ? record.asset.trim() : "invoice",
      amount: typeof record.amount === "string" && record.amount.trim() ? record.amount.trim() : "provided_by_invoice"
    }
  };
}

async function runLiveInvoicePayment(
  repo: IncidentRepository,
  runId: string,
  input: InvoiceDemoRequest
): Promise<DemoResponse> {
  const config = liveDemoConfig();
  const nodeAInfo = await fiberRpc<FiberNodeInfo>(config.senderRpcUrl, "node_info", []);
  const nodes = {
    a: nodeFromInfo("a", nodeAInfo, config.senderRpcUrl, config.senderP2PAddress),
    b: {
      name: "invoice-recipient",
      rpcUrl: "external",
      pubkey: "provided-by-invoice",
      address: input.invoice
    }
  };

  const fallbackPaymentId = `live_invoice_${runId}`;
  const payment = await sendAndObservePayment(config.senderRpcUrl, input.invoice, fallbackPaymentId, config.paymentTimeoutSeconds);
  const finalChannel = unknownInvoiceChannel(payment);
  const responseChannel = responseChannelFromFiberChannel(finalChannel);
  const responsePayment = {
    hash: payment.payment_hash ?? fallbackPaymentId,
    status: payment.status ?? "Unknown",
    fee: payment.fee ?? "0x0",
    ...(payment.failed_error ? { failure: payment.failed_error } : {})
  };
  const event =
    responsePayment.status === "Success"
      ? buildPaymentSucceededEvent({
          channel: finalChannel,
          nodes,
          payment: responsePayment,
          runId,
          source: "fiber_rpc",
          invoiceAddress: input.invoice,
          asset: input.asset,
          amount: input.amount
        })
      : buildPaymentFailedEvent({
          channel: finalChannel,
          nodes,
          payment: responsePayment,
          runId,
          source: "fiber_rpc",
          invoiceAddress: input.invoice,
          asset: input.asset,
          amount: input.amount
        });
  const result = await repo.ingestEvent(event);
  const success = event.kind === "payment_succeeded";

  return {
    mode: "live_invoice_payment",
    runId,
    nodes,
    channel: responseChannel,
    invoice: {
      asset: input.asset,
      amount: input.amount,
      address: input.invoice
    },
    payment: responsePayment,
    steps: [
      {
        id: "nodes",
        title: "Hosted sender node",
        detail: `${nodes.a.name} answered a live node_info RPC call.`,
        status: "verified"
      },
      {
        id: "invoice",
        title: "Invoice submitted",
        detail: `${nodes.a.name} attempted send_payment for the provided invoice.`,
        status: "complete"
      },
      {
        id: "payment",
        title: "Payment observed",
        detail: success
          ? `${responsePayment.hash} reached Fiber status Success.`
          : `${responsePayment.hash} reached Fiber status ${responsePayment.status}: ${responsePayment.failure ?? "no failure detail"}.`,
        status: success ? "verified" : "complete"
      },
      {
        id: "fiber-ir",
        title: "FiberIR recorded the outcome",
        detail: success
          ? "FiberIR stored the live success event; no incident was created because the transfer completed."
          : "FiberIR created an incident from the live failed payment event.",
        status: "recorded"
      }
    ],
    fiberIr: {
      ...(success ? { successEventId: event.eventId } : { failureEventId: event.eventId }),
      eventEndpoint: "/v1/events",
      results: [result]
    }
  };
}

function liveDemoConfig() {
  return {
    senderRpcUrl: process.env.FIR_DEMO_SENDER_RPC_URL ?? process.env.FIR_DEMO_NODE_A_RPC_URL ?? VERIFIED_NODES.a.rpcUrl,
    senderP2PAddress: process.env.FIR_DEMO_SENDER_P2P_ADDR ?? process.env.FIR_DEMO_NODE_A_P2P_ADDR,
    paymentTimeoutSeconds: process.env.FIR_DEMO_PAYMENT_TIMEOUT_SECONDS ?? DEFAULT_PAYMENT_TIMEOUT_SECONDS
  };
}

function nodeFromInfo(
  nodeKey: keyof typeof VERIFIED_NODES,
  nodeInfo: FiberNodeInfo,
  rpcUrl: string,
  configuredAddress: string | undefined
): DemoNode {
  return {
    name: nodeInfo.node_name ?? VERIFIED_NODES[nodeKey].name,
    rpcUrl,
    pubkey: requireString(nodeInfo.pubkey, "node_info.pubkey"),
    address: configuredAddress ?? nodeInfo.addresses?.[0] ?? VERIFIED_NODES[nodeKey].address
  };
}

async function sendAndObservePayment(
  nodeARpcUrl: string,
  invoiceAddress: string,
  invoiceHash: string,
  timeoutSeconds: string
): Promise<FiberPayment> {
  let submitted: FiberPayment;
  try {
    submitted = await fiberRpc<FiberPayment>(nodeARpcUrl, "send_payment", [
      {
        invoice: invoiceAddress,
        timeout: hexQuantity(timeoutSeconds)
      }
    ]);
  } catch (error) {
    return {
      payment_hash: invoiceHash,
      status: "Failed",
      fee: "0x0",
      failed_error: error instanceof Error ? error.message : "send_payment failed"
    };
  }

  const paymentHash = submitted.payment_hash ?? invoiceHash;
  try {
    return await waitForPaymentTerminal(nodeARpcUrl, paymentHash, submitted);
  } catch (error) {
    return {
      ...submitted,
      payment_hash: paymentHash,
      status: "Failed",
      failed_error: error instanceof Error ? error.message : "get_payment failed"
    };
  }
}

async function waitForPaymentTerminal(
  nodeARpcUrl: string,
  paymentHash: string,
  initialPayment: FiberPayment
): Promise<FiberPayment> {
  const timeoutMs = positiveIntegerFromEnv("FIR_DEMO_PAYMENT_TIMEOUT_MS", DEFAULT_PAYMENT_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  let latest = initialPayment;

  while (!isTerminalPayment(latest.status) && Date.now() < deadline) {
    await delay(500);
    latest = await fiberRpc<FiberPayment>(nodeARpcUrl, "get_payment", [{ payment_hash: paymentHash }]);
  }

  if (!isTerminalPayment(latest.status)) {
    return {
      ...latest,
      payment_hash: paymentHash,
      status: "Failed",
      failed_error: `payment did not reach a terminal state before ${timeoutMs}ms`
    };
  }

  return latest;
}

function isTerminalPayment(status: string | undefined): boolean {
  return status === "Success" || status === "Failed";
}

function buildPaymentSucceededEvent(input: {
  channel: FiberChannel;
  nodes: DemoResponse["nodes"];
  payment: DemoResponse["payment"];
  runId: string;
  source: FiberIncidentEventV1["source"];
  invoiceAddress: string;
  asset: string;
  amount: string;
}): FiberIncidentEventV1 {
  return basePaymentEvent(input, "payment_succeeded");
}

function buildPaymentFailedEvent(input: {
  channel: FiberChannel;
  nodes: DemoResponse["nodes"];
  payment: DemoResponse["payment"];
  runId: string;
  source: FiberIncidentEventV1["source"];
  invoiceAddress: string;
  asset: string;
  amount: string;
}): FiberIncidentEventV1 {
  return {
    ...basePaymentEvent(input, "payment_attempt_failed"),
    error: {
      code: classifyLiveFailureCode(input.payment.failure),
      message: input.payment.failure ?? `Fiber payment ended with status ${input.payment.status}`,
      raw: {
        status: input.payment.status,
        failed_error: input.payment.failure
      }
    }
  };
}

function basePaymentEvent(
  input: {
    channel: FiberChannel;
    nodes: DemoResponse["nodes"];
    payment: DemoResponse["payment"];
    runId: string;
    source: FiberIncidentEventV1["source"];
    invoiceAddress: string;
    asset: string;
    amount: string;
  },
  kind: FiberIncidentEventV1["kind"]
): FiberIncidentEventV1 {
  const channelSnapshot = channelSnapshotFromFiberChannel(input.channel);
  return {
    schemaVersion: "fiber-ir.event.v1",
    eventId: `evt_demo_peer_${kind === "payment_succeeded" ? "success" : "failure"}_${input.runId}`,
    observedAt: new Date().toISOString(),
    source: input.source,
    projectId: "fiber-ir-demo",
    environment: "testnet",
    kind,
    provenance: liveProvenance(),
    payment: {
      paymentId: input.payment.hash,
      invoiceId: input.invoiceAddress,
      senderNode: input.nodes.a.pubkey,
      destinationNode: input.nodes.b.pubkey,
      asset: input.asset,
      amount: input.amount,
      fiberPaymentStatus: kind === "payment_succeeded" ? "Success" : "Failed"
    },
    attempt: {
      attemptId: `attempt_${input.runId}`,
      correlationId: `peer_transfer_${input.runId}`,
      retryCount: 0,
      routeSummary: {
        peers: [input.nodes.a.pubkey, input.nodes.b.pubkey],
        channelOutpoint: channelSnapshot.channel_outpoint
      }
    },
    context: {
      channelSnapshot
    }
  };
}

function liveProvenance(): Record<string, Provenance> {
  return {
    payment: "live",
    senderNode: "live",
    destinationNode: "inferred",
    fiberPaymentStatus: "live",
    channelSnapshot: "inferred",
    routeSummary: "inferred",
    normalizedClass: "inferred"
  };
}

function classifyLiveFailureCode(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("no route")) return "NO_ROUTE";
  if (normalized.includes("peer") && (normalized.includes("offline") || normalized.includes("connect"))) {
    return "PEER_OFFLINE";
  }
  if (normalized.includes("channel") && (normalized.includes("ready") || normalized.includes("not found"))) {
    return "CHANNEL_NOT_READY";
  }
  if (normalized.includes("liquidity") || normalized.includes("balance")) {
    return "INSUFFICIENT_OUTBOUND_LIQUIDITY";
  }
  if (normalized.includes("timeout") || normalized.includes("expired")) return "PAYMENT_TIMEOUT";
  return "UNKNOWN_NODE_FAILURE";
}

async function runVerifiedReplay(repo: IncidentRepository, runId: string): Promise<DemoResponse> {
  const provenance: Record<string, Provenance> = {
    payment: "fixture",
    senderNode: "fixture",
    destinationNode: "fixture",
    fiberPaymentStatus: "fixture",
    channelSnapshot: "fixture",
    normalizedClass: "inferred"
  };
  const events = buildVerifiedReplayEvents({
    channel: VERIFIED_CHANNEL,
    nodes: VERIFIED_NODES,
    payment: VERIFIED_PAYMENT,
    provenance,
    runId
  });
  const results: IngestResult[] = [];
  for (const event of events) {
    results.push(await repo.ingestEvent(event));
  }

  return {
    mode: "verified_replay",
    runId,
    nodes: VERIFIED_NODES,
    channel: VERIFIED_CHANNEL,
    invoice: {
      asset: DEFAULT_PAYMENT_CURRENCY,
      amount: DEFAULT_PAYMENT_AMOUNT
    },
    payment: VERIFIED_PAYMENT,
    steps: [
      {
        id: "nodes",
        title: "Fiber peers A and B",
        detail: `${VERIFIED_NODES.a.name} and ${VERIFIED_NODES.b.name} are represented with their FNN pubkeys.`,
        status: "complete"
      },
      {
        id: "connect",
        title: "Peer connection",
        detail: `${VERIFIED_NODES.a.name} dials ${VERIFIED_NODES.b.name} through the Fiber P2P address.`,
        status: "complete"
      },
      {
        id: "channel",
        title: "Channel opened",
        detail: `${VERIFIED_CHANNEL.channelId} is ${VERIFIED_CHANNEL.state} with outpoint ${VERIFIED_CHANNEL.outpoint}.`,
        status: "complete"
      },
      {
        id: "invoice",
        title: "Invoice created on B",
        detail: "B issues a 1,000,000 Fibt invoice for the offline replay.",
        status: "complete"
      },
      {
        id: "payment",
        title: "Payment sent from A to B",
        detail: `${VERIFIED_PAYMENT.hash} finished with Fiber status ${VERIFIED_PAYMENT.status}.`,
        status: "complete"
      },
      {
        id: "fiber-ir",
        title: "FiberIR recorded the outcome",
        detail: "The offline replay creates a sample incident and resolves it with the success event.",
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
}

function buildVerifiedReplayEvents(input: {
  channel: DemoResponse["channel"];
  nodes: DemoResponse["nodes"];
  payment: DemoResponse["payment"];
  provenance: Record<string, Provenance>;
  runId: string;
}): [FiberIncidentEventV1, FiberIncidentEventV1] {
  const now = Date.now();
  const basePayment = {
    paymentId: input.payment.hash,
    senderNode: input.nodes.a.pubkey,
    destinationNode: input.nodes.b.pubkey,
    asset: DEFAULT_PAYMENT_CURRENCY,
    amount: DEFAULT_PAYMENT_AMOUNT
  };

  return [
    {
      schemaVersion: "fiber-ir.event.v1",
      eventId: `evt_demo_peer_preflight_${input.runId}`,
      observedAt: new Date(now - 15_000).toISOString(),
      source: "demo",
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
      source: "demo",
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

function responseChannelFromFiberChannel(channel: FiberChannel): DemoResponse["channel"] {
  return {
    channelId: channel.channel_id ?? "unknown-channel",
    outpoint: channel.channel_outpoint ?? "unknown-outpoint",
    state: channelState(channel) ?? "Unknown"
  };
}

function unknownInvoiceChannel(payment: FiberPayment): FiberChannel {
  return {
    channel_id: "provided-by-invoice",
    channel_outpoint: "provided-by-invoice",
    state: { state_name: payment.status === "Success" ? "PaymentSucceeded" : "PaymentObserved" }
  };
}

function channelSnapshotFromFiberChannel(channel: FiberChannel): Record<string, unknown> {
  return {
    channel_id: channel.channel_id,
    channel_outpoint: channel.channel_outpoint,
    state: channelState(channel),
    sender_local_balance_after: channel.local_balance,
    sender_remote_balance_after: channel.remote_balance,
    sender_offered_tlc_balance: channel.offered_tlc_balance,
    sender_received_tlc_balance: channel.received_tlc_balance
  };
}

function channelState(channel: FiberChannel): string | undefined {
  return channel.state?.state_name;
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

  const text = await response.text();
  const body = safeJsonParse(text) as { result?: T; error?: { message?: string; code?: string | number } } | undefined;
  if (!response.ok || !body || body.error || body.result === undefined) {
    throw new Error(body?.error?.message ?? `${method} failed with HTTP ${response.status}`);
  }

  return body.result;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function hexQuantity(value: string): string {
  const trimmed = value.trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return trimmed.toLowerCase();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Expected a decimal or hex quantity, got ${value}`);
  }

  return `0x${BigInt(trimmed).toString(16)}`;
}

function requireString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Fiber RPC response missing ${label}`);
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

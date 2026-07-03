export const INCIDENT_CLASSES = [
  "NO_ROUTE",
  "PEER_OFFLINE",
  "CHANNEL_NOT_READY",
  "INSUFFICIENT_OUTBOUND_LIQUIDITY",
  "INSUFFICIENT_INBOUND_LIQUIDITY",
  "ASSET_MISMATCH",
  "FEE_TOO_LOW",
  "PAYMENT_TIMEOUT",
  "INVOICE_EXPIRED",
  "UNKNOWN_NODE_FAILURE"
] as const;

export type IncidentClass = (typeof INCIDENT_CLASSES)[number];

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const INCIDENT_STATUSES = ["OPEN", "RETRYING", "RESOLVED", "FAILED", "IGNORED"] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type FiberPaymentStatus = "Created" | "Inflight" | "Success" | "Failed";

export type Provenance = "live" | "inferred" | "fixture" | "mock";

export type EventSource = "fiber_rpc" | "sdk" | "fixture_replay" | "demo";

export type FiberIncidentEventV1 = {
  schemaVersion: "fiber-ir.event.v1";
  eventId: string;
  observedAt: string;
  source: EventSource;
  provenance: Record<string, Provenance>;
  projectId?: string;
  environment?: "dev" | "testnet" | "mainnet" | "demo";
  kind:
    | "payment_attempt_failed"
    | "payment_retry_scheduled"
    | "payment_succeeded"
    | "node_health_snapshot";
  payment: {
    paymentId?: string;
    invoiceId?: string;
    senderNode: string;
    destinationNode?: string;
    fiberPaymentStatus?: FiberPaymentStatus;
    asset: string;
    amount: string;
  };
  attempt?: {
    attemptId?: string;
    correlationId?: string;
    retryOfIncidentId?: string;
    retryCount?: number;
    routeSummary?: unknown;
  };
  error?: {
    code?: string;
    message: string;
    raw?: unknown;
  };
  context?: {
    nodeHealth?: unknown;
    channelSnapshot?: unknown;
  };
};

export type Remediation = {
  code: string;
  title: string;
  detail: string;
};

export type ClassifierResult = {
  normalizedClass: IncidentClass;
  confidence: number;
  severity: Severity;
  explanation: string;
  remediation: Remediation;
  evidenceRefs: string[];
};

export type IncidentRecord = {
  id: string;
  idempotencyKey: string;
  projectId: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  paymentId?: string;
  invoiceId?: string;
  senderNode: string;
  destinationNode?: string;
  asset: string;
  amount: string;
  fiberPaymentStatus?: FiberPaymentStatus;
  incidentStatus: IncidentStatus;
  normalizedClass: IncidentClass;
  classifierConfidence: number;
  severity: Severity;
  remediation: Remediation;
  rawError?: unknown;
  redactedPayload?: unknown;
  provenance: Record<string, Provenance>;
  retryOfIncidentId?: string;
  resolutionNote?: string;
};

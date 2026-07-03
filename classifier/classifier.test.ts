import { describe, expect, it } from "vitest";
import { INCIDENT_CLASSES, type FiberIncidentEventV1, type IncidentClass, type Severity } from "@fiber-ir/shared";
import { classifyIncident } from "./src/index";

type ClassifierCase = {
  name: string;
  message: string;
  expectedClass: IncidentClass;
  expectedSeverity: Severity;
  expectedEvidenceRefs: string[];
  eventOverrides?: Partial<FiberIncidentEventV1>;
};

const baseEvent = (message: string, overrides: Partial<FiberIncidentEventV1> = {}): FiberIncidentEventV1 => ({
  schemaVersion: "fiber-ir.event.v1",
  eventId: `evt_${message.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
  observedAt: "2026-07-07T12:00:00.000Z",
  source: "fixture_replay",
  provenance: {
    payment: "fixture",
    error: "fixture",
    routeSummary: "fixture",
    normalizedClass: "inferred"
  },
  kind: "payment_attempt_failed",
  payment: {
    paymentId: "pay_test_001",
    senderNode: "alice-node",
    destinationNode: "bob-node",
    fiberPaymentStatus: "Failed",
    asset: "CKB",
    amount: "10000"
  },
  attempt: {
    correlationId: "corr_test_001",
    retryCount: 0,
    routeSummary: {
      hops: [],
      failureSource: "fixture"
    }
  },
  context: {
    nodeHealth: {
      peers: []
    },
    channelSnapshot: {
      channels: []
    }
  },
  error: {
    message,
    raw: {
      failed_error: message
    }
  },
  ...overrides
});

const cases: ClassifierCase[] = [
  {
    name: "no route",
    message: "route not found from alice-node to bob-node",
    expectedClass: "NO_ROUTE",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["error.message", "attempt.routeSummary"]
  },
  {
    name: "peer offline",
    message: "target peer is unreachable during payment forwarding",
    expectedClass: "PEER_OFFLINE",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["context.nodeHealth", "error.message"]
  },
  {
    name: "channel not ready",
    message: "channel inactive: not ready to forward payment",
    expectedClass: "CHANNEL_NOT_READY",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["context.channelSnapshot", "error.message"]
  },
  {
    name: "insufficient outbound liquidity",
    message: "insufficient local balance for outbound edge",
    expectedClass: "INSUFFICIENT_OUTBOUND_LIQUIDITY",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["context.channelSnapshot", "error.message"]
  },
  {
    name: "insufficient inbound liquidity",
    message: "remote balance too low to receive payment",
    expectedClass: "INSUFFICIENT_INBOUND_LIQUIDITY",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["context.channelSnapshot", "error.message"]
  },
  {
    name: "asset mismatch",
    message: "invoice asset does not match payment asset",
    expectedClass: "ASSET_MISMATCH",
    expectedSeverity: "MEDIUM",
    expectedEvidenceRefs: ["payment.asset", "error.message"]
  },
  {
    name: "fee too low",
    message: "max fee exceeded before route completion",
    expectedClass: "FEE_TOO_LOW",
    expectedSeverity: "MEDIUM",
    expectedEvidenceRefs: ["error.message"]
  },
  {
    name: "payment timeout",
    message: "deadline exceeded while waiting for payment result",
    expectedClass: "PAYMENT_TIMEOUT",
    expectedSeverity: "HIGH",
    expectedEvidenceRefs: ["error.message", "attempt.timeout"]
  },
  {
    name: "invoice expired",
    message: "invoice has expired according to node clock",
    expectedClass: "INVOICE_EXPIRED",
    expectedSeverity: "MEDIUM",
    expectedEvidenceRefs: ["error.message", "invoice.expiry"]
  },
  {
    name: "unknown node failure",
    message: "fiber node returned application error 90210",
    expectedClass: "UNKNOWN_NODE_FAILURE",
    expectedSeverity: "MEDIUM",
    expectedEvidenceRefs: ["error.raw"]
  }
];

describe("classifyIncident", () => {
  it("has a table case for every canonical incident class", () => {
    expect(cases.map((testCase) => testCase.expectedClass).sort()).toStrictEqual([...INCIDENT_CLASSES].sort());
  });

  it.each(cases)("classifies $name evidence", ({ message, expectedClass, expectedSeverity, expectedEvidenceRefs, eventOverrides }) => {
    const result = classifyIncident(baseEvent(message, eventOverrides));

    expect(result.normalizedClass).toBe(expectedClass);
    expect(result.severity).toBe(expectedSeverity);
    expect(result.evidenceRefs).toStrictEqual(expectedEvidenceRefs);
    expect(result.remediation.code).toBeTruthy();
    expect(result.explanation).toContain(expectedClass);
  });

  it("uses rule order when evidence contains multiple class signals", () => {
    const result = classifyIncident(baseEvent("invoice has expired after route not found"));

    expect(result.normalizedClass).toBe("INVOICE_EXPIRED");
    expect(result.evidenceRefs).toStrictEqual(["error.message", "invoice.expiry"]);
  });
});

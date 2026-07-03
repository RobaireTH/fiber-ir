import type { ClassifierResult, FiberIncidentEventV1, IncidentClass, Severity } from "@fiber-ir/shared";
import { remediations } from "./remediations.js";

type Rule = {
  incidentClass: IncidentClass;
  severity: Severity;
  confidence: number;
  evidenceRefs: string[];
  matches: (event: FiberIncidentEventV1, searchable: string) => boolean;
};

const includesAny = (value: string, needles: string[]) => needles.some((needle) => value.includes(needle));

const rules: Rule[] = [
  {
    incidentClass: "INVOICE_EXPIRED",
    severity: "MEDIUM",
    confidence: 0.9,
    evidenceRefs: ["error.message", "invoice.expiry"],
    matches: (_event, text) =>
      includesAny(text, ["invoice expired", "invoice has expired", "expired invoice", "stale invoice"])
  },
  {
    incidentClass: "ASSET_MISMATCH",
    severity: "MEDIUM",
    confidence: 0.88,
    evidenceRefs: ["payment.asset", "error.message"],
    matches: (_event, text) =>
      includesAny(text, [
        "asset mismatch",
        "asset does not match",
        "invoice asset does not match",
        "payment asset does not match",
        "unsupported asset",
        "currency mismatch"
      ])
  },
  {
    incidentClass: "PAYMENT_TIMEOUT",
    severity: "HIGH",
    confidence: 0.84,
    evidenceRefs: ["error.message", "attempt.timeout"],
    matches: (_event, text) => includesAny(text, ["timeout", "deadline exceeded", "timed out"])
  },
  {
    incidentClass: "FEE_TOO_LOW",
    severity: "MEDIUM",
    confidence: 0.76,
    evidenceRefs: ["error.message"],
    matches: (_event, text) =>
      includesAny(text, ["fee too low", "insufficient fee", "fee limit", "fee budget", "max fee exceeded"])
  },
  {
    incidentClass: "CHANNEL_NOT_READY",
    severity: "HIGH",
    confidence: 0.78,
    evidenceRefs: ["context.channelSnapshot", "error.message"],
    matches: (_event, text) =>
      includesAny(text, [
        "channel not ready",
        "channel pending",
        "channel disabled",
        "channel inactive",
        "closing channel",
        "not ready to forward"
      ])
  },
  {
    incidentClass: "PEER_OFFLINE",
    severity: "HIGH",
    confidence: 0.82,
    evidenceRefs: ["context.nodeHealth", "error.message"],
    matches: (_event, text) =>
      includesAny(text, ["peer offline", "peer unreachable", "peer is unreachable", "dial failed", "disconnected"])
  },
  {
    incidentClass: "INSUFFICIENT_OUTBOUND_LIQUIDITY",
    severity: "HIGH",
    confidence: 0.8,
    evidenceRefs: ["context.channelSnapshot", "error.message"],
    matches: (_event, text) => includesAny(text, ["outbound liquidity", "local balance", "insufficient outbound"])
  },
  {
    incidentClass: "INSUFFICIENT_INBOUND_LIQUIDITY",
    severity: "HIGH",
    confidence: 0.72,
    evidenceRefs: ["context.channelSnapshot", "error.message"],
    matches: (_event, text) => includesAny(text, ["inbound liquidity", "remote balance", "insufficient inbound"])
  },
  {
    incidentClass: "NO_ROUTE",
    severity: "HIGH",
    confidence: 0.86,
    evidenceRefs: ["error.message", "attempt.routeSummary"],
    matches: (_event, text) => includesAny(text, ["no route", "route not found", "no path", "pathfinding failed"])
  }
];

export function classifyIncident(event: FiberIncidentEventV1): ClassifierResult {
  const searchable = JSON.stringify({
    error: event.error,
    attempt: event.attempt,
    context: event.context,
    payment: event.payment
  }).toLowerCase();

  const match = rules.find((rule) => rule.matches(event, searchable));
  const incidentClass = match?.incidentClass ?? "UNKNOWN_NODE_FAILURE";

  return {
    normalizedClass: incidentClass,
    confidence: match?.confidence ?? 0.45,
    severity: match?.severity ?? "MEDIUM",
    explanation: buildExplanation(event, incidentClass),
    remediation: remediations[incidentClass],
    evidenceRefs: match?.evidenceRefs ?? ["error.raw"]
  };
}

function buildExplanation(event: FiberIncidentEventV1, incidentClass: IncidentClass): string {
  const payment = event.payment.paymentId ?? event.payment.invoiceId ?? "unknown payment";
  const error = event.error?.message ?? "No raw error was provided.";
  return `${payment} was classified as ${incidentClass} from recorder evidence: ${error}`;
}

export { remediations };

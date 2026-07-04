import { z } from "zod";

export const fiberIncidentEventV1Schema = z.object({
  schemaVersion: z.literal("fiber-ir.event.v1"),
  eventId: z.string().min(1),
  observedAt: z.string().datetime(),
  source: z.enum(["fiber_rpc", "sdk", "fixture_replay", "demo"]),
  provenance: z.record(z.enum(["live", "inferred", "fixture", "mock"])),
  projectId: z.string().optional(),
  environment: z.enum(["dev", "testnet", "mainnet", "demo"]).optional(),
  kind: z.enum([
    "payment_attempt_failed",
    "payment_retry_scheduled",
    "payment_succeeded",
    "node_health_snapshot"
  ]),
  payment: z.object({
    paymentId: z.string().optional(),
    invoiceId: z.string().optional(),
    senderNode: z.string().min(1),
    destinationNode: z.string().optional(),
    fiberPaymentStatus: z.enum(["Created", "Inflight", "Success", "Failed"]).optional(),
    asset: z.string().min(1),
    amount: z.string().min(1)
  }),
  attempt: z
    .object({
      attemptId: z.string().optional(),
      correlationId: z.string().optional(),
      retryOfIncidentId: z.string().optional(),
      retryCount: z.number().int().min(0).optional(),
      routeSummary: z.unknown().optional()
    })
    .optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().min(1),
      raw: z.unknown().optional()
    })
    .optional(),
  context: z
    .object({
      nodeHealth: z.unknown().optional(),
      channelSnapshot: z.unknown().optional()
    })
    .optional()
});


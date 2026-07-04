import type { FiberIncidentEventV1 } from "@fiber-ir/shared";
import { FiberIncidentClient } from "./client.js";

export type WrapPaymentEventInput = Omit<
  FiberIncidentEventV1,
  "schemaVersion" | "kind" | "source" | "observedAt" | "error"
> & {
  kind?: FiberIncidentEventV1["kind"];
  source?: FiberIncidentEventV1["source"];
  observedAt?: string;
  error?: FiberIncidentEventV1["error"];
};

export type WrapPaymentOptions<T> = {
  client: FiberIncidentClient;
  event: WrapPaymentEventInput | ((error: unknown) => WrapPaymentEventInput);
  paymentCall: () => Promise<T>;
};

export async function wrapPayment<T>({ client, event, paymentCall }: WrapPaymentOptions<T>): Promise<T> {
  try {
    return await paymentCall();
  } catch (error) {
    const eventInput = typeof event === "function" ? event(error) : event;
    const message = error instanceof Error ? error.message : "Unknown payment failure";

    await client.recordEvent({
      ...eventInput,
      schemaVersion: "fiber-ir.event.v1",
      source: eventInput.source ?? "sdk",
      observedAt: eventInput.observedAt ?? new Date().toISOString(),
      kind: eventInput.kind ?? "payment_attempt_failed",
      error: eventInput.error ?? {
        message,
        raw: error
      }
    });
    throw error;
  }
}

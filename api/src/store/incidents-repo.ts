import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { classifyIncident } from "@fiber-ir/classifier";
import type { FiberIncidentEventV1, IncidentRecord, IncidentStatus } from "@fiber-ir/shared";

type MaybePromise<T> = T | Promise<T>;

export type IngestResult = {
  eventId: string;
  incidentId?: string;
  action: "created" | "updated" | "deduplicated" | "stored";
  incident?: IncidentRecord;
};

export type IncidentListFilters = {
  status?: IncidentStatus;
  class?: string;
};

export type IncidentSummary = {
  total: number;
  open: number;
  highSeverity: number;
  resolved: number;
};

export interface IncidentRepository {
  ingestEvent(event: FiberIncidentEventV1): MaybePromise<IngestResult>;
  list(filters?: IncidentListFilters): MaybePromise<IncidentRecord[]>;
  get(id: string): MaybePromise<IncidentRecord | undefined>;
  updateStatus(
    id: string,
    incidentStatus: IncidentStatus,
    resolutionNote?: string
  ): MaybePromise<IncidentRecord | undefined>;
  summary(): MaybePromise<IncidentSummary>;
}

export type IncidentRepositorySnapshot = {
  incidents: IncidentRecord[];
  eventIds: string[];
};

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidents = new Map<string, IncidentRecord>();
  private readonly eventIds = new Set<string>();

  constructor(initialSnapshot?: IncidentRepositorySnapshot) {
    for (const eventId of initialSnapshot?.eventIds ?? []) {
      this.eventIds.add(eventId);
    }

    for (const incident of initialSnapshot?.incidents ?? []) {
      this.incidents.set(incident.id, incident);
    }
  }

  ingestEvent(event: FiberIncidentEventV1): IngestResult {
    if (this.eventIds.has(event.eventId)) {
      return { eventId: event.eventId, action: "deduplicated" };
    }

    if (event.kind === "payment_succeeded") {
      const existing = this.findOpenIncidentForPayment(event);
      this.eventIds.add(event.eventId);
      if (!existing) {
        this.onStateChanged();
        return { eventId: event.eventId, action: "stored" };
      }

      const updated = {
        ...existing,
        fiberPaymentStatus: "Success" as const,
        incidentStatus: "RESOLVED" as const,
        updatedAt: new Date().toISOString(),
        resolutionNote: "Resolved by linked payment_succeeded event."
      };
      this.incidents.set(updated.id, updated);
      this.onStateChanged();
      return { eventId: event.eventId, action: "updated", incidentId: updated.id, incident: updated };
    }

    if (event.kind !== "payment_attempt_failed") {
      this.eventIds.add(event.eventId);
      this.onStateChanged();
      return { eventId: event.eventId, action: "stored" };
    }

    const classifier = classifyIncident(event);
    const now = new Date().toISOString();
    const incident: IncidentRecord = {
      id: `inc_${event.eventId.replace(/^evt_?/, "")}`,
      idempotencyKey: event.eventId,
      projectId: event.projectId ?? "default",
      occurredAt: event.observedAt,
      createdAt: now,
      updatedAt: now,
      paymentId: event.payment.paymentId,
      invoiceId: event.payment.invoiceId,
      senderNode: event.payment.senderNode,
      destinationNode: event.payment.destinationNode,
      asset: event.payment.asset,
      amount: event.payment.amount,
      fiberPaymentStatus: event.payment.fiberPaymentStatus,
      incidentStatus: "OPEN",
      normalizedClass: classifier.normalizedClass,
      classifierConfidence: classifier.confidence,
      severity: classifier.severity,
      remediation: classifier.remediation,
      rawError: event.error?.raw ?? event.error,
      redactedPayload: redactEvent(event),
      provenance: event.provenance,
      retryOfIncidentId: event.attempt?.retryOfIncidentId
    };

    this.eventIds.add(event.eventId);
    this.incidents.set(incident.id, incident);
    this.onStateChanged();
    return { eventId: event.eventId, action: "created", incidentId: incident.id, incident };
  }

  list(filters: IncidentListFilters = {}): IncidentRecord[] {
    return [...this.incidents.values()]
      .filter((incident) => !filters.status || incident.incidentStatus === filters.status)
      .filter((incident) => !filters.class || incident.normalizedClass === filters.class)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  get(id: string): IncidentRecord | undefined {
    return this.incidents.get(id);
  }

  updateStatus(id: string, incidentStatus: IncidentStatus, resolutionNote?: string): IncidentRecord | undefined {
    const incident = this.incidents.get(id);
    if (!incident) return undefined;

    const updated = {
      ...incident,
      incidentStatus,
      resolutionNote,
      updatedAt: new Date().toISOString()
    };
    this.incidents.set(id, updated);
    this.onStateChanged();
    return updated;
  }

  summary(): IncidentSummary {
    const incidents = [...this.incidents.values()];
    return {
      total: incidents.length,
      open: incidents.filter((incident) => incident.incidentStatus === "OPEN").length,
      highSeverity: incidents.filter((incident) => incident.severity === "HIGH" || incident.severity === "CRITICAL").length,
      resolved: incidents.filter((incident) => incident.incidentStatus === "RESOLVED").length
    };
  }

  protected onStateChanged(): void {}

  protected toSnapshot(): IncidentRepositorySnapshot {
    return {
      incidents: [...this.incidents.values()],
      eventIds: [...this.eventIds.values()]
    };
  }

  private findOpenIncidentForPayment(event: FiberIncidentEventV1): IncidentRecord | undefined {
    return [...this.incidents.values()].find(
      (incident) =>
        incident.incidentStatus !== "RESOLVED" &&
        ((event.payment.paymentId && incident.paymentId === event.payment.paymentId) ||
          (event.payment.invoiceId && incident.invoiceId === event.payment.invoiceId))
    );
  }
}

export class JsonFileIncidentRepository extends InMemoryIncidentRepository {
  constructor(private readonly filePath: string) {
    super(loadJsonFileSnapshot(filePath));
  }

  protected override onStateChanged(): void {
    persistJsonFileSnapshot(this.filePath, this.toSnapshot());
  }
}

function loadJsonFileSnapshot(filePath: string): IncidentRepositorySnapshot | undefined {
  if (!existsSync(filePath)) return undefined;

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isSnapshotLike(parsed)) {
    throw new Error(`Invalid Fiber Incident Recorder store file: ${filePath}`);
  }

  return parsed;
}

function persistJsonFileSnapshot(filePath: string, snapshot: IncidentRepositorySnapshot): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function isSnapshotLike(value: unknown): value is IncidentRepositorySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<IncidentRepositorySnapshot>;
  return Array.isArray(snapshot.incidents) && Array.isArray(snapshot.eventIds);
}

function redactEvent(event: FiberIncidentEventV1): unknown {
  return {
    ...event,
    error: event.error ? { ...event.error, raw: event.error.raw ? "[redacted]" : undefined } : undefined
  };
}

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  WifiOff
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type DashboardSource = "api" | "fixture";
type IncidentStatus = "OPEN" | "RETRYING" | "RESOLVED" | "FAILED" | "IGNORED" | string;

type DashboardSummary = {
  total: number;
  open: number;
  highSeverity: number;
  resolved: number;
};

type ProvenanceItem = {
  field: string;
  kind: string;
};

type RemediationView = {
  code: string;
  title: string;
  detail: string;
};

type IncidentView = {
  id: string;
  paymentId: string;
  invoiceId: string;
  occurredAt: string;
  updatedAt: string;
  senderNode: string;
  destinationNode: string;
  asset: string;
  amount: string;
  fiberPaymentStatus: string;
  incidentStatus: IncidentStatus;
  normalizedClass: string;
  classifierConfidence: number | null;
  severity: string;
  remediation: RemediationView;
  rawErrorSummary: string;
  provenance: ProvenanceItem[];
  retryOfIncidentId: string;
  resolutionNote: string;
  source: DashboardSource;
};

type DashboardData = {
  incidents: IncidentView[];
  summary: DashboardSummary;
  source: DashboardSource;
  fallbackReason?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DashboardData }
  | { status: "error"; message: string };

type ActionState = {
  incidentId: string;
  status: IncidentStatus;
};

const FIXTURE_INCIDENTS: unknown[] = [
  {
    id: "inc_01J_NO_ROUTE_042",
    idempotencyKey: "evt_demo_042",
    projectId: "default",
    occurredAt: "2026-07-07T10:24:07.000Z",
    createdAt: "2026-07-07T10:24:08.000Z",
    updatedAt: "2026-07-07T10:24:08.000Z",
    paymentId: "pay_demo_042",
    senderNode: "alice-node",
    destinationNode: "bob-node",
    asset: "CKB",
    amount: "10000",
    fiberPaymentStatus: "Failed",
    incidentStatus: "OPEN",
    normalizedClass: "NO_ROUTE",
    classifierConfidence: 0.86,
    severity: "HIGH",
    remediation: {
      code: "REFRESH_GRAPH_AND_RETRY",
      title: "Refresh graph data and retry",
      detail: "Refresh graph state, verify the peer is reachable, then retry with an updated route snapshot."
    },
    rawError: { message: "no route found" },
    provenance: {
      payment: "fixture",
      error: "fixture",
      routeSummary: "fixture",
      normalizedClass: "inferred"
    }
  },
  {
    id: "inc_01J_PEER_067",
    idempotencyKey: "evt_demo_067",
    projectId: "default",
    occurredAt: "2026-07-07T09:52:16.000Z",
    createdAt: "2026-07-07T09:52:18.000Z",
    updatedAt: "2026-07-07T09:54:20.000Z",
    paymentId: "pay_demo_067",
    senderNode: "relay-east",
    destinationNode: "merchant-gateway",
    asset: "CKB",
    amount: "25000",
    fiberPaymentStatus: "Failed",
    incidentStatus: "RETRYING",
    normalizedClass: "PEER_OFFLINE",
    classifierConfidence: 0.79,
    severity: "MEDIUM",
    remediation: {
      code: "VERIFY_PEER_HEALTH",
      title: "Verify peer health",
      detail: "Confirm the destination peer is online and the channel has an active state before retrying."
    },
    rawError: { message: "peer is not connected" },
    provenance: {
      payment: "live",
      nodeHealth: "live",
      normalizedClass: "inferred"
    }
  },
  {
    id: "inc_01J_LIQ_031",
    idempotencyKey: "evt_demo_031",
    projectId: "default",
    occurredAt: "2026-07-07T08:41:33.000Z",
    createdAt: "2026-07-07T08:41:35.000Z",
    updatedAt: "2026-07-07T08:46:02.000Z",
    paymentId: "pay_demo_031",
    senderNode: "alice-node",
    destinationNode: "exchange-node",
    asset: "CKB",
    amount: "75000",
    fiberPaymentStatus: "Success",
    incidentStatus: "RESOLVED",
    normalizedClass: "INSUFFICIENT_OUTBOUND_LIQUIDITY",
    classifierConfidence: 0.91,
    severity: "CRITICAL",
    remediation: {
      code: "REBALANCE_OUTBOUND",
      title: "Rebalance outbound liquidity",
      detail: "Move liquidity toward the sender channel or choose a route with sufficient outbound balance."
    },
    rawError: { message: "insufficient outbound liquidity" },
    provenance: {
      payment: "live",
      channelSnapshot: "live",
      normalizedClass: "inferred"
    },
    resolutionNote: "Resolved by linked payment_succeeded event."
  }
];

const SOURCE_LABELS: Record<DashboardSource, string> = {
  api: "API live",
  fixture: "Fixture fallback"
};

function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoadState({ status: "loading" });
      setActionError("");

      try {
        const data = await fetchDashboardData(controller.signal);
        setLoadState({ status: "ready", data });
        setSelectedId(data.incidents[0]?.id ?? "");
      } catch (error) {
        if (isAbortError(error)) return;

        if (error instanceof ApiUnavailableError) {
          const fixtureData = createFixtureData(error.message);
          setLoadState({ status: "ready", data: fixtureData });
          setSelectedId(fixtureData.incidents[0]?.id ?? "");
          return;
        }

        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "The API returned an unexpected error."
        });
      }
    }

    void load();

    return () => controller.abort();
  }, [reloadKey]);

  const incidents = loadState.status === "ready" ? loadState.data.incidents : [];
  const summary = loadState.status === "ready" ? loadState.data.summary : null;
  const filteredIncidents = useMemo(() => filterIncidents(incidents, query), [incidents, query]);
  const selectedIncident = filteredIncidents.find((incident) => incident.id === selectedId) ?? filteredIncidents[0] ?? null;

  useEffect(() => {
    if (filteredIncidents.length === 0) return;
    if (!filteredIncidents.some((incident) => incident.id === selectedId)) {
      setSelectedId(filteredIncidents[0].id);
    }
  }, [filteredIncidents, selectedId]);

  async function updateIncidentStatus(incident: IncidentView, nextStatus: IncidentStatus) {
    if (actionState) return;

    const resolutionNote =
      nextStatus === "RESOLVED" ? "Resolved from dashboard detail pane." : "Retry started from dashboard detail pane.";

    setActionState({ incidentId: incident.id, status: nextStatus });
    setActionError("");

    try {
      const updatedIncident =
        loadState.status === "ready" && loadState.data.source === "api"
          ? normalizeIncident(await patchIncidentStatus(incident.id, nextStatus, resolutionNote), 0, "api")
          : { ...incident, incidentStatus: nextStatus, resolutionNote, updatedAt: new Date().toISOString() };

      setLoadState((current) => {
        if (current.status !== "ready") return current;

        const incidents = current.data.incidents.map((item) => (item.id === incident.id ? updatedIncident : item));
        return {
          status: "ready",
          data: {
            ...current.data,
            incidents,
            summary: deriveSummary(incidents)
          }
        };
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update incident status.");
    } finally {
      setActionState(null);
    }
  }

  function reload() {
    setReloadKey((key) => key + 1);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <strong>Fiber IR</strong>
          <span>Diagnostics API</span>
        </div>
        <nav aria-label="Dashboard sections">
          <a className="active">Incidents</a>
          <a>Trends</a>
          <a>Settings</a>
        </nav>
        <p>Collector: RPC wrapper online</p>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>Fiber payment incidents</h1>
            <p>Investigate failures, evidence, remediation, and retry outcomes.</p>
          </div>
          <div className="topbar-actions">
            {loadState.status === "ready" ? (
              <span className={`source-badge source-${loadState.data.source}`}>{SOURCE_LABELS[loadState.data.source]}</span>
            ) : null}
            <button className="secondary icon-button" onClick={reload} type="button">
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
        </header>

        {loadState.status === "ready" && loadState.data.fallbackReason ? (
          <section className="notice notice-warn">
            <WifiOff size={18} />
            <span>{loadState.data.fallbackReason} Showing local fixture incidents until the API is reachable.</span>
          </section>
        ) : null}

        {actionError ? (
          <section className="notice notice-error">
            <AlertCircle size={18} />
            <span>{actionError}</span>
          </section>
        ) : null}

        {loadState.status === "loading" ? (
          <DashboardLoading />
        ) : loadState.status === "error" ? (
          <ApiErrorState message={loadState.message} onRetry={reload} />
        ) : (
          <>
            <section className="metrics" aria-label="Incident summary">
              <Metric icon={<Database />} label="Total" value={String(summary?.total ?? 0)} />
              <Metric icon={<Activity />} label="Open" value={String(summary?.open ?? 0)} />
              <Metric icon={<ShieldCheck />} label="High/Critical" value={String(summary?.highSeverity ?? 0)} />
              <Metric icon={<CheckCircle2 />} label="Resolved" value={String(summary?.resolved ?? 0)} />
            </section>

            <section className="toolbar">
              <label className="search-field">
                <Search size={18} />
                <input
                  aria-label="Filter incidents"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by payment, class, node, status"
                  value={query}
                />
              </label>
              <div className="toolbar-status">
                <span>{incidents.length} loaded</span>
                <span>{filteredIncidents.length} shown</span>
              </div>
            </section>

            {incidents.length === 0 ? (
              <EmptyState title="No incidents found" detail="The API returned an empty incident list." onRetry={reload} />
            ) : filteredIncidents.length === 0 ? (
              <EmptyState title="No matching incidents" detail="No loaded incidents match the current filter." onRetry={() => setQuery("")} />
            ) : (
              <section className="incident-grid">
                <IncidentList
                  incidents={filteredIncidents}
                  selectedId={selectedIncident?.id ?? ""}
                  onSelect={(incident) => setSelectedId(incident.id)}
                />
                {selectedIncident ? (
                  <IncidentDetail
                    actionState={actionState}
                    incident={selectedIncident}
                    onUpdateStatus={updateIncidentStatus}
                  />
                ) : null}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function DashboardLoading() {
  return (
    <>
      <section className="metrics" aria-label="Loading incident summary">
        {["Total", "Open", "High/Critical", "Resolved"].map((label) => (
          <article className="metric loading" key={label}>
            <span>{label}</span>
            <strong>...</strong>
          </article>
        ))}
      </section>

      <section className="incident-grid">
        <article className="incident-list" aria-label="Loading incidents">
          <div className="row head">
            <span>Severity</span>
            <span>Status</span>
            <span>Class</span>
            <span>Payment</span>
            <span>Source</span>
          </div>
          {[0, 1, 2, 3].map((item) => (
            <div className="row skeleton-row" key={item}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          ))}
        </article>
        <article className="detail-panel loading-panel">
          <Loader2 className="spin" size={22} />
          <strong>Loading incident feed</strong>
          <p>Fetching incidents and summary.</p>
        </article>
      </section>
    </>
  );
}

function ApiErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="state-panel error-state">
      <AlertCircle size={28} />
      <div>
        <h2>API error</h2>
        <p>{message}</p>
      </div>
      <button className="primary icon-button" onClick={onRetry} type="button">
        <RefreshCcw size={16} />
        Retry fetch
      </button>
    </section>
  );
}

function EmptyState({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <section className="state-panel">
      <Database size={28} />
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <button className="secondary icon-button" onClick={onRetry} type="button">
        <RefreshCcw size={16} />
        Refresh
      </button>
    </section>
  );
}

function IncidentList({
  incidents,
  selectedId,
  onSelect
}: {
  incidents: IncidentView[];
  selectedId: string;
  onSelect: (incident: IncidentView) => void;
}) {
  return (
    <article className="incident-list" aria-label="Incident list">
      <div className="row head">
        <span>Severity</span>
        <span>Status</span>
        <span>Class</span>
        <span>Payment</span>
        <span>Source</span>
      </div>
      {incidents.map((incident) => (
        <button
          aria-pressed={incident.id === selectedId}
          className={`row ${incident.id === selectedId ? "selected" : ""}`}
          key={incident.id}
          onClick={() => onSelect(incident)}
          type="button"
        >
          <span className={`severity severity-${cssToken(incident.severity)}`}>{incident.severity}</span>
          <StatusPill status={incident.incidentStatus} />
          <span className="mono">{incident.normalizedClass}</span>
          <span>{incident.paymentId}</span>
          <span>{sourceSummary(incident.provenance)}</span>
        </button>
      ))}
    </article>
  );
}

function IncidentDetail({
  incident,
  actionState,
  onUpdateStatus
}: {
  incident: IncidentView;
  actionState: ActionState | null;
  onUpdateStatus: (incident: IncidentView, nextStatus: IncidentStatus) => void;
}) {
  const busy = actionState?.incidentId === incident.id;
  const isRetrying = incident.incidentStatus === "RETRYING";
  const isResolved = incident.incidentStatus === "RESOLVED";

  return (
    <article className="detail-panel">
      <div className="detail-title">
        <div>
          <span>{incident.id}</span>
          <h2>
            {incident.normalizedClass} on {incident.paymentId}
          </h2>
        </div>
        <StatusPill status={incident.incidentStatus} />
      </div>

      <p className="detail-summary">
        {incident.rawErrorSummary || "No raw error message returned."} Confidence is{" "}
        {incident.classifierConfidence === null ? "unavailable" : `${Math.round(incident.classifierConfidence * 100)}%`}.
      </p>

      <dl className="facts-grid">
        <div>
          <dt>Route</dt>
          <dd>
            {incident.senderNode} to {incident.destinationNode}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>
            {incident.amount} {incident.asset}
          </dd>
        </div>
        <div>
          <dt>Fiber status</dt>
          <dd>{incident.fiberPaymentStatus}</dd>
        </div>
        <div>
          <dt>Occurred</dt>
          <dd>{formatDate(incident.occurredAt)}</dd>
        </div>
      </dl>

      <section className="detail-section">
        <div className="section-heading">
          <strong>Provenance</strong>
          <span>{incident.source === "api" ? "API response" : "Local fixture"}</span>
        </div>
        <ProvenanceBadges items={incident.provenance} />
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <strong>Remediation</strong>
          <span>{incident.remediation.code}</span>
        </div>
        <h3>{incident.remediation.title}</h3>
        <p>{incident.remediation.detail}</p>
      </section>

      <section className="detail-section">
        <div className="section-heading">
          <strong>Retry state</strong>
          <span>Updated {formatDate(incident.updatedAt)}</span>
        </div>
        {incident.retryOfIncidentId ? <p>Retry of {incident.retryOfIncidentId}.</p> : null}
        {incident.resolutionNote ? <p>{incident.resolutionNote}</p> : null}
        <div className="detail-actions">
          <button
            className="secondary icon-button"
            disabled={busy || isRetrying || isResolved}
            onClick={() => onUpdateStatus(incident, "RETRYING")}
            type="button"
          >
            {busy && actionState?.status === "RETRYING" ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
            {isRetrying ? "Retrying" : "Mark retrying"}
          </button>
          <button
            className="primary icon-button"
            disabled={busy || isResolved}
            onClick={() => onUpdateStatus(incident, "RESOLVED")}
            type="button"
          >
            {busy && actionState?.status === "RESOLVED" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {isResolved ? "Resolved" : "Mark resolved"}
          </button>
        </div>
      </section>
    </article>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ status }: { status: IncidentStatus }) {
  return <span className={`pill status-${cssToken(status)}`}>{status}</span>;
}

function ProvenanceBadges({ items }: { items: ProvenanceItem[] }) {
  if (items.length === 0) {
    return (
      <div className="provenance-list">
        <span className="provenance-badge provenance-unknown">provenance unknown</span>
      </div>
    );
  }

  return (
    <div className="provenance-list">
      {items.map((item) => (
        <span className={`provenance-badge provenance-${cssToken(item.kind)}`} key={`${item.field}-${item.kind}`}>
          {item.field}: {item.kind}
        </span>
      ))}
    </div>
  );
}

class ApiUnavailableError extends Error {}

class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

async function fetchDashboardData(signal: AbortSignal): Promise<DashboardData> {
  if (isDemoMode()) {
    return createFixtureData("Demo mode is showing local fixture incidents.");
  }

  const [incidentsPayload, summaryPayload] = await Promise.all([
    requestJson("/v1/incidents", signal),
    requestJson("/v1/stats/summary", signal)
  ]);

  return normalizeDashboardData(incidentsPayload, summaryPayload, "api");
}

async function requestJson(path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(path, {
      headers: { accept: "application/json" },
      signal
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiUnavailableError(`Unable to reach ${path}.`);
  }

  const body = await response.text();

  if (!response.ok) {
    if (isUnavailableHttpResponse(response.status, body)) {
      throw new ApiUnavailableError(`Unable to reach ${path}.`);
    }

    throw new ApiResponseError(`${path} returned HTTP ${response.status}.`, response.status);
  }

  if (!body.trim()) return null;

  try {
    return JSON.parse(body);
  } catch (error) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new ApiUnavailableError(`${path} did not return JSON.`);
    }

    throw new ApiResponseError(`${path} returned invalid JSON.`, response.status);
  }
}

async function patchIncidentStatus(id: string, incidentStatus: IncidentStatus, resolutionNote: string): Promise<unknown> {
  const response = await fetch(`/v1/incidents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ incidentStatus, resolutionNote })
  });

  const body = await response.text();

  if (!response.ok) {
    throw new ApiResponseError(`/v1/incidents/${id} returned HTTP ${response.status}.`, response.status);
  }

  return body.trim() ? JSON.parse(body) : null;
}

function createFixtureData(reason: string): DashboardData {
  const data = normalizeDashboardData({ items: FIXTURE_INCIDENTS, nextCursor: null }, null, "fixture");
  return {
    ...data,
    fallbackReason: reason
  };
}

function normalizeDashboardData(incidentsPayload: unknown, summaryPayload: unknown, source: DashboardSource): DashboardData {
  const incidentContainer = asRecord(incidentsPayload);
  const rawItems = Array.isArray(incidentsPayload)
    ? incidentsPayload
    : Array.isArray(incidentContainer?.items)
      ? incidentContainer.items
      : [];
  const incidents = rawItems.map((item, index) => normalizeIncident(item, index, source));

  return {
    incidents,
    summary: normalizeSummary(summaryPayload, incidents),
    source
  };
}

function normalizeIncident(value: unknown, index: number, source: DashboardSource): IncidentView {
  const record = asRecord(value) ?? {};
  const remediation = asRecord(record.remediation);
  const provenance = asRecord(record.provenance);
  const id = textValue(record.id, `incident_${source}_${index + 1}`);

  return {
    id,
    paymentId: textValue(record.paymentId, "payment unavailable"),
    invoiceId: textValue(record.invoiceId, ""),
    occurredAt: textValue(record.occurredAt ?? record.createdAt, ""),
    updatedAt: textValue(record.updatedAt ?? record.createdAt ?? record.occurredAt, ""),
    senderNode: textValue(record.senderNode, "sender unknown"),
    destinationNode: textValue(record.destinationNode, "destination unknown"),
    asset: textValue(record.asset, "asset unknown"),
    amount: textValue(record.amount, "amount unknown"),
    fiberPaymentStatus: textValue(record.fiberPaymentStatus, "Unknown"),
    incidentStatus: textValue(record.incidentStatus, "OPEN").toUpperCase(),
    normalizedClass: textValue(record.normalizedClass, "UNCLASSIFIED").toUpperCase(),
    classifierConfidence: numberValue(record.classifierConfidence),
    severity: textValue(record.severity, "MEDIUM").toUpperCase(),
    remediation: {
      code: textValue(remediation?.code, "NO_REMEDIATION_CODE"),
      title: textValue(remediation?.title, "Remediation pending"),
      detail: textValue(remediation?.detail, "No remediation detail returned by the API.")
    },
    rawErrorSummary: summarizeRawError(record.rawError),
    provenance: provenance ? normalizeProvenance(provenance) : [],
    retryOfIncidentId: textValue(record.retryOfIncidentId, ""),
    resolutionNote: textValue(record.resolutionNote, ""),
    source
  };
}

function normalizeSummary(value: unknown, incidents: IncidentView[]): DashboardSummary {
  const record = asRecord(value);
  const derived = deriveSummary(incidents);

  return {
    total: numberValue(record?.total) ?? derived.total,
    open: numberValue(record?.open) ?? derived.open,
    highSeverity: numberValue(record?.highSeverity) ?? derived.highSeverity,
    resolved: numberValue(record?.resolved) ?? derived.resolved
  };
}

function deriveSummary(incidents: IncidentView[]): DashboardSummary {
  return incidents.reduce(
    (summary, incident) => {
      summary.total += 1;
      if (incident.incidentStatus === "OPEN") summary.open += 1;
      if (incident.incidentStatus === "RESOLVED") summary.resolved += 1;
      if (incident.severity === "HIGH" || incident.severity === "CRITICAL") summary.highSeverity += 1;
      return summary;
    },
    { total: 0, open: 0, highSeverity: 0, resolved: 0 }
  );
}

function normalizeProvenance(record: Record<string, unknown>): ProvenanceItem[] {
  return Object.entries(record).map(([field, kind]) => ({
    field,
    kind: textValue(kind, "unknown").toLowerCase()
  }));
}

function filterIncidents(incidents: IncidentView[], query: string): IncidentView[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return incidents;

  return incidents.filter((incident) =>
    [
      incident.id,
      incident.paymentId,
      incident.invoiceId,
      incident.incidentStatus,
      incident.normalizedClass,
      incident.severity,
      incident.senderNode,
      incident.destinationNode,
      incident.asset
    ]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  );
}

function sourceSummary(items: ProvenanceItem[]): string {
  if (items.length === 0) return "unknown";

  const uniqueKinds = [...new Set(items.map((item) => item.kind))];
  return uniqueKinds.slice(0, 2).join(" + ") + (uniqueKinds.length > 2 ? ` +${uniqueKinds.length - 2}` : "");
}

function summarizeRawError(value: unknown): string {
  if (typeof value === "string") return value;

  const record = asRecord(value);
  if (record) {
    const message = textValue(record.message, "");
    if (message) return message;

    const failedError = textValue(record.failed_error, "");
    if (failedError) return failedError;

    const error = textValue(record.error, "");
    if (error) return error;
  }

  if (value === null || value === undefined) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return "Raw error unavailable.";
  }
}

function formatDate(value: string): string {
  if (!value) return "Time unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isUnavailableHttpResponse(status: number, body: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 500 || /proxy|econnrefused|socket hang up|fetch failed/i.test(body);
}

function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

function cssToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

createRoot(document.getElementById("root")!).render(<App />);

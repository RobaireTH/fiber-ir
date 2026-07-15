import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Database,
  GitBranch,
  Link2,
  Loader2,
  PlayCircle,
  RefreshCcw,
  ReceiptText,
  RotateCcw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  WifiOff
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type DashboardSource = "api" | "fixture";
type DashboardSection = "incidents" | "trends" | "settings" | "demo";
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

type PeerDemoStepStatus = "pending" | "active" | "complete" | "recorded" | "verified";

type PeerDemoStep = {
  id: string;
  title: string;
  detail: string;
  status: PeerDemoStepStatus;
};

type PeerDemoResult = {
  mode: "verified_replay" | "live_probe";
  runId: string;
  nodes: {
    a: PeerDemoNode;
    b: PeerDemoNode;
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
    status: string;
    fee: string;
  };
  steps: PeerDemoStep[];
  fiberIr: {
    failureEventId: string;
    successEventId: string;
    eventEndpoint: string;
    results: Array<{
      eventId: string;
      action: string;
      incidentId?: string;
    }>;
  };
};

type PeerDemoNode = {
  name: string;
  rpcUrl: string;
  pubkey: string;
  address: string;
};

type PeerDemoState =
  | { status: "idle" }
  | { status: "running"; mode: "verified_replay" | "live_probe"; stepIndex: number }
  | { status: "success"; result: PeerDemoResult }
  | { status: "error"; message: string };

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
const SECTION_COPY: Record<DashboardSection, { title: string; detail: string }> = {
  incidents: {
    title: "Fiber payment incidents",
    detail: "Investigate failures, evidence, remediation, and retry outcomes."
  },
  trends: {
    title: "Incident trends",
    detail: "Review failure classes, severity mix, provenance, and resolution posture."
  },
  settings: {
    title: "Integration settings",
    detail: "Check API wiring, storage mode, event endpoints, and deployment runtime."
  },
  demo: {
    title: "Peer transfer demo",
    detail: "Run the A to B channel and payment flow through FiberIR."
  }
};
const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_FIR_API_BASE_URL);
const DEFAULT_PEER_DEMO_STEPS: PeerDemoStep[] = [
  {
    id: "nodes",
    title: "Fiber peers A and B",
    detail: "Two Fiber Network Nodes are selected for the transfer.",
    status: "pending"
  },
  {
    id: "connect",
    title: "Peer connection",
    detail: "Node A connects to node B over Fiber P2P.",
    status: "pending"
  },
  {
    id: "channel",
    title: "Channel opened",
    detail: "A private one-way channel is opened and waits for readiness.",
    status: "pending"
  },
  {
    id: "invoice",
    title: "Invoice created on B",
    detail: "Node B creates the payment invoice.",
    status: "pending"
  },
  {
    id: "payment",
    title: "Payment sent from A to B",
    detail: "Node A pays B through the ready channel.",
    status: "pending"
  },
  {
    id: "fiber-ir",
    title: "FiberIR recorded the outcome",
    detail: "FiberIR stores the failed preflight and resolves it with the success event.",
    status: "pending"
  }
];
const PEER_DEMO_STEP_DELAY_MS = 850;

function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [section, setSection] = useState<DashboardSection>(() => initialDashboardSection());
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [actionError, setActionError] = useState("");
  const [peerDemoState, setPeerDemoState] = useState<PeerDemoState>({ status: "idle" });

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
  const sectionCopy = SECTION_COPY[section];
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

  async function runPeerDemo(mode: "verified_replay" | "live_probe") {
    setPeerDemoState({ status: "running", mode, stepIndex: 0 });
    setActionError("");

    try {
      for (let stepIndex = 0; stepIndex < DEFAULT_PEER_DEMO_STEPS.length; stepIndex += 1) {
        setPeerDemoState({ status: "running", mode, stepIndex });
        await wait(PEER_DEMO_STEP_DELAY_MS);
      }

      const path = mode === "live_probe" ? "/v1/demo/peer-transfer?live=1" : "/v1/demo/peer-transfer";
      const result = normalizePeerDemoResult(await postJson(path, {}));
      setPeerDemoState({ status: "success", result });
      reload();
    } catch (error) {
      setPeerDemoState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to run the peer transfer demo."
      });
    }
  }

  function openDemoIncidentFeed() {
    reload();
    setSection("incidents");
    setQuery("CHANNEL_NOT_READY");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <strong>Fiber IR</strong>
          <span>Diagnostics API</span>
        </div>
        <nav aria-label="Dashboard sections">
          <button className={section === "incidents" ? "active" : ""} onClick={() => setSection("incidents")} type="button">
            <Database size={16} />
            Incidents
          </button>
          <button className={section === "trends" ? "active" : ""} onClick={() => setSection("trends")} type="button">
            <BarChart3 size={16} />
            Trends
          </button>
          <button className={section === "demo" ? "active" : ""} onClick={() => setSection("demo")} type="button">
            <PlayCircle size={16} />
            Peer demo
          </button>
          <button className={section === "settings" ? "active" : ""} onClick={() => setSection("settings")} type="button">
            <Settings size={16} />
            Settings
          </button>
        </nav>
        <p>Collector: RPC wrapper online</p>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{sectionCopy.title}</h1>
            <p>{sectionCopy.detail}</p>
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
            <SummaryMetrics summary={summary} />

            {section === "incidents" ? (
              <IncidentWorkspace
                actionState={actionState}
                filteredIncidents={filteredIncidents}
                incidents={incidents}
                onClearQuery={() => setQuery("")}
                onQueryChange={setQuery}
                onReload={reload}
                onSelectIncident={(incident) => setSelectedId(incident.id)}
                onUpdateStatus={updateIncidentStatus}
                query={query}
                selectedIncident={selectedIncident}
                selectedId={selectedIncident?.id ?? ""}
              />
            ) : section === "trends" ? (
              <TrendsView incidents={incidents} summary={summary} />
            ) : section === "demo" ? (
              <PeerDemoView
                dataSource={loadState.data.source}
                onOpenIncidentFeed={openDemoIncidentFeed}
                onRun={runPeerDemo}
                state={peerDemoState}
              />
            ) : (
              <SettingsView data={loadState.data} />
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

function SummaryMetrics({ summary }: { summary: DashboardSummary | null }) {
  return (
    <section className="metrics" aria-label="Incident summary">
      <Metric icon={<Database />} label="Total" value={String(summary?.total ?? 0)} />
      <Metric icon={<Activity />} label="Open" value={String(summary?.open ?? 0)} />
      <Metric icon={<ShieldCheck />} label="High/Critical" value={String(summary?.highSeverity ?? 0)} />
      <Metric icon={<CheckCircle2 />} label="Resolved" value={String(summary?.resolved ?? 0)} />
    </section>
  );
}

function IncidentWorkspace({
  actionState,
  filteredIncidents,
  incidents,
  onClearQuery,
  onQueryChange,
  onReload,
  onSelectIncident,
  onUpdateStatus,
  query,
  selectedIncident,
  selectedId
}: {
  actionState: ActionState | null;
  filteredIncidents: IncidentView[];
  incidents: IncidentView[];
  onClearQuery: () => void;
  onQueryChange: (query: string) => void;
  onReload: () => void;
  onSelectIncident: (incident: IncidentView) => void;
  onUpdateStatus: (incident: IncidentView, nextStatus: IncidentStatus) => void;
  query: string;
  selectedIncident: IncidentView | null;
  selectedId: string;
}) {
  return (
    <>
      <section className="toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Filter incidents"
            onChange={(event) => onQueryChange(event.target.value)}
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
        <EmptyState title="No incidents found" detail="The API returned an empty incident list." onRetry={onReload} />
      ) : filteredIncidents.length === 0 ? (
        <EmptyState title="No matching incidents" detail="No loaded incidents match the current filter." onRetry={onClearQuery} />
      ) : (
        <section className="incident-grid">
          <IncidentList incidents={filteredIncidents} selectedId={selectedId} onSelect={onSelectIncident} />
          {selectedIncident ? (
            <IncidentDetail actionState={actionState} incident={selectedIncident} onUpdateStatus={onUpdateStatus} />
          ) : null}
        </section>
      )}
    </>
  );
}

function PeerDemoView({
  dataSource,
  onOpenIncidentFeed,
  onRun,
  state
}: {
  dataSource: DashboardSource;
  onOpenIncidentFeed: () => void;
  onRun: (mode: "verified_replay" | "live_probe") => void;
  state: PeerDemoState;
}) {
  const busy = state.status === "running";
  const result = state.status === "success" ? state.result : null;
  const steps = stepsForPeerDemoState(state);
  const flowState =
    state.status === "running"
      ? `running ${Math.min(state.stepIndex + 1, DEFAULT_PEER_DEMO_STEPS.length)}/${DEFAULT_PEER_DEMO_STEPS.length}`
      : result
        ? result.mode.replace("_", " ")
        : "not run";

  return (
    <section className="peer-demo-grid" aria-label="Peer transfer demo">
      <article className="peer-demo-panel peer-demo-hero">
        <div>
          <div className="section-heading">
            <strong>A to B transfer</strong>
            <span>{dataSource === "api" ? "FiberIR API" : "fixture view"}</span>
          </div>
          <h2>Open channel, pay invoice, record outcome</h2>
          <p>
            Hosted testers get a guided verified replay of the completed A to B transfer. Local API environments can
            probe already-running FNN peers with the live button.
          </p>
        </div>
        <div className="peer-demo-actions">
          <button className="primary icon-button" disabled={busy} onClick={() => onRun("verified_replay")} type="button">
            {busy && state.mode === "verified_replay" ? <Loader2 className="spin" size={16} /> : <PlayCircle size={16} />}
            {busy && state.mode === "verified_replay" ? "Running flow" : "Run guided demo"}
          </button>
          <button className="secondary icon-button" disabled={busy} onClick={() => onRun("live_probe")} type="button">
            {busy && state.mode === "live_probe" ? <Loader2 className="spin" size={16} /> : <Server size={16} />}
            Probe live peers
          </button>
        </div>
      </article>

      {state.status === "error" ? (
        <section className="notice notice-error peer-demo-notice">
          <AlertCircle size={18} />
          <span>{state.message}</span>
        </section>
      ) : null}

      <article className="peer-demo-panel">
        <div className="section-heading">
          <strong>Flow</strong>
          <span>{flowState}</span>
        </div>
        <div className="demo-timeline">
          {steps.map((step, index) => (
            <div className={`demo-step demo-step-row-${cssToken(step.status)}`} key={step.id}>
              <span className={`demo-step-icon demo-step-${cssToken(step.status)}`}>
                <DemoStepIcon id={step.id} />
              </span>
              <div>
                <strong>
                  {index + 1}. {step.title}
                </strong>
                <p>{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="peer-demo-panel">
        <div className="section-heading">
          <strong>Proof</strong>
          <span>{busy ? "running" : result ? result.payment.status : "not run"}</span>
        </div>
        <dl className="demo-proof-list">
          <div>
            <dt>Node A</dt>
            <dd>{result ? shortHash(result.nodes.a.pubkey) : "pending"}</dd>
          </div>
          <div>
            <dt>Node B</dt>
            <dd>{result ? shortHash(result.nodes.b.pubkey) : "pending"}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>{result ? shortHash(result.channel.channelId) : "pending"}</dd>
          </div>
          <div>
            <dt>Outpoint</dt>
            <dd>{result ? shortHash(result.channel.outpoint) : "pending"}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{result ? shortHash(result.payment.hash) : "pending"}</dd>
          </div>
          <div>
            <dt>FiberIR</dt>
            <dd>{result ? result.fiberIr.results.map((item) => item.action).join(" -> ") : "pending"}</dd>
          </div>
        </dl>
        {result ? (
          <div className="detail-actions">
            <button className="primary icon-button" onClick={onOpenIncidentFeed} type="button">
              <Database size={16} />
              Open recorded incident
            </button>
          </div>
        ) : null}
      </article>
    </section>
  );
}

function DemoStepIcon({ id }: { id: string }) {
  switch (id) {
    case "nodes":
      return <Server size={16} />;
    case "connect":
      return <Link2 size={16} />;
    case "channel":
      return <GitBranch size={16} />;
    case "invoice":
      return <ReceiptText size={16} />;
    case "payment":
      return <Send size={16} />;
    default:
      return <CheckCircle2 size={16} />;
  }
}

function stepsForPeerDemoState(state: PeerDemoState): PeerDemoStep[] {
  if (state.status === "success") return state.result.steps;

  if (state.status !== "running") return DEFAULT_PEER_DEMO_STEPS;

  return DEFAULT_PEER_DEMO_STEPS.map((step, index) => {
    if (index < state.stepIndex) {
      return {
        ...step,
        status: index === DEFAULT_PEER_DEMO_STEPS.length - 1 ? "recorded" : "complete"
      };
    }

    if (index === state.stepIndex) {
      return {
        ...step,
        status: "active"
      };
    }

    return step;
  });
}

function TrendsView({ incidents, summary }: { incidents: IncidentView[]; summary: DashboardSummary | null }) {
  const statusCounts = sortedCounts(countBy(incidents, (incident) => incident.incidentStatus));
  const classCounts = sortedCounts(countBy(incidents, (incident) => incident.normalizedClass));
  const severityCounts = sortedCounts(countBy(incidents, (incident) => incident.severity));
  const provenanceCounts = sortedCounts(countBy(incidents, (incident) => sourceSummary(incident.provenance)));
  const resolutionRate = incidents.length ? Math.round(((summary?.resolved ?? 0) / incidents.length) * 100) : 0;
  const latestIncident = incidents[0];

  if (incidents.length === 0) {
    return <EmptyState title="No trend data" detail="Trend panels will populate after incidents are ingested." onRetry={() => undefined} />;
  }

  return (
    <section className="analytics-grid" aria-label="Incident trend analysis">
      <article className="analytics-panel hero-panel">
        <div className="section-heading">
          <strong>Resolution posture</strong>
          <span>{incidents.length} incidents</span>
        </div>
        <div className="resolution-meter" aria-label={`${resolutionRate}% resolved`}>
          <span style={{ width: `${resolutionRate}%` }} />
        </div>
        <div className="resolution-copy">
          <strong>{resolutionRate}% resolved</strong>
          <span>{summary?.open ?? 0} still open or retrying</span>
        </div>
      </article>

      <BarList title="Failure classes" items={classCounts} total={incidents.length} />
      <BarList title="Incident status" items={statusCounts} total={incidents.length} />
      <BarList title="Severity mix" items={severityCounts} total={incidents.length} />
      <BarList title="Evidence source" items={provenanceCounts} total={incidents.length} />

      <article className="analytics-panel">
        <div className="section-heading">
          <strong>Latest incident</strong>
          <span>{latestIncident ? formatDate(latestIncident.occurredAt) : "None"}</span>
        </div>
        {latestIncident ? (
          <dl className="compact-facts">
            <div>
              <dt>Class</dt>
              <dd>{latestIncident.normalizedClass}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{latestIncident.incidentStatus}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{latestIncident.paymentId}</dd>
            </div>
            <div>
              <dt>Remediation</dt>
              <dd>{latestIncident.remediation.title}</dd>
            </div>
          </dl>
        ) : null}
      </article>
    </section>
  );
}

function SettingsView({ data }: { data: DashboardData }) {
  const apiBase = API_BASE_URL || "same origin";
  const dashboardMode = data.source === "api" ? "API-backed" : "fixture fallback";
  const endpoints = [
    "POST /v1/events",
    "POST /v1/demo/peer-transfer",
    "GET /v1/incidents",
    "PATCH /v1/incidents/:id",
    "GET /v1/stats/summary"
  ];

  return (
    <section className="settings-grid" aria-label="Integration settings">
      <article className="settings-panel">
        <div className="section-heading">
          <strong>Runtime</strong>
          <span>{dashboardMode}</span>
        </div>
        <dl className="compact-facts">
          <div>
            <dt>API base</dt>
            <dd>{apiBase}</dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd>{SOURCE_LABELS[data.source]}</dd>
          </div>
          <div>
            <dt>Store</dt>
            <dd>{data.source === "api" ? "Server repository" : "Browser fixture"}</dd>
          </div>
        </dl>
      </article>

      <article className="settings-panel">
        <div className="section-heading">
          <strong>API contract</strong>
          <span>fiber-ir.event.v1</span>
        </div>
        <div className="endpoint-list">
          {endpoints.map((endpoint) => (
            <span className="endpoint" key={endpoint}>
              {endpoint}
            </span>
          ))}
        </div>
      </article>

      <article className="settings-panel wide-panel">
        <div className="section-heading">
          <strong>Integration handoff</strong>
          <span>Wallet, merchant, node service</span>
        </div>
        <div className="handoff-grid">
          <div>
            <Server size={18} />
            <strong>Record payment outcomes</strong>
            <p>Submit terminal Fiber payment events to keep the incident feed current.</p>
          </div>
          <div>
            <ShieldCheck size={18} />
            <strong>Preserve provenance</strong>
            <p>Label fields as live, inferred, fixture, or mock so operators can trust the evidence.</p>
          </div>
          <div>
            <RefreshCcw size={18} />
            <strong>Close the loop</strong>
            <p>Send retry success events or patch status when an operator resolves an incident.</p>
          </div>
        </div>
      </article>
    </section>
  );
}

function BarList({ title, items, total }: { title: string; items: Array<[string, number]>; total: number }) {
  return (
    <article className="analytics-panel">
      <div className="section-heading">
        <strong>{title}</strong>
        <span>{total} total</span>
      </div>
      <div className="bar-list">
        {items.map(([label, count]) => (
          <div className="bar-row" key={label}>
            <div>
              <span>{label}</span>
              <strong>{count}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${Math.max(6, Math.round((count / total) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </article>
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
    response = await fetch(apiUrl(path), {
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
  const path = `/v1/incidents/${encodeURIComponent(id)}`;
  const response = await fetch(apiUrl(path), {
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

async function postJson(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();

  if (!response.ok) {
    throw new ApiResponseError(`${path} returned HTTP ${response.status}.`, response.status);
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

function normalizePeerDemoResult(value: unknown): PeerDemoResult {
  const record = asRecord(value);
  if (!record) throw new ApiResponseError("Demo endpoint returned an invalid response.");

  const nodes = asRecord(record.nodes);
  const nodeA = normalizePeerDemoNode(asRecord(nodes?.a), "node-a");
  const nodeB = normalizePeerDemoNode(asRecord(nodes?.b), "node-b");
  const channel = asRecord(record.channel);
  const invoice = asRecord(record.invoice);
  const payment = asRecord(record.payment);
  const fiberIr = asRecord(record.fiberIr);
  const rawResults = Array.isArray(fiberIr?.results) ? fiberIr.results : [];
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];

  return {
    mode: textValue(record.mode, "verified_replay") === "live_probe" ? "live_probe" : "verified_replay",
    runId: textValue(record.runId, ""),
    nodes: {
      a: nodeA,
      b: nodeB
    },
    channel: {
      channelId: textValue(channel?.channelId, ""),
      outpoint: textValue(channel?.outpoint, ""),
      state: textValue(channel?.state, "")
    },
    invoice: {
      asset: textValue(invoice?.asset, "Fibt"),
      amount: textValue(invoice?.amount, "1000000")
    },
    payment: {
      hash: textValue(payment?.hash, ""),
      status: textValue(payment?.status, "Unknown"),
      fee: textValue(payment?.fee, "0x0")
    },
    steps: rawSteps.map(normalizePeerDemoStep).filter(Boolean),
    fiberIr: {
      failureEventId: textValue(fiberIr?.failureEventId, ""),
      successEventId: textValue(fiberIr?.successEventId, ""),
      eventEndpoint: textValue(fiberIr?.eventEndpoint, "/v1/events"),
      results: rawResults.map((item) => {
        const result = asRecord(item);
        return {
          eventId: textValue(result?.eventId, ""),
          action: textValue(result?.action, "stored"),
          incidentId: textValue(result?.incidentId, "")
        };
      })
    }
  };
}

function normalizePeerDemoNode(record: Record<string, unknown> | null, fallbackName: string): PeerDemoNode {
  return {
    name: textValue(record?.name, fallbackName),
    rpcUrl: textValue(record?.rpcUrl, ""),
    pubkey: textValue(record?.pubkey, ""),
    address: textValue(record?.address, "")
  };
}

function normalizePeerDemoStep(value: unknown): PeerDemoStep {
  const record = asRecord(value);
  const status = textValue(record?.status, "complete");
  return {
    id: textValue(record?.id, "step"),
    title: textValue(record?.title, "Step"),
    detail: textValue(record?.detail, ""),
    status: status === "recorded" || status === "verified" ? status : "complete"
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

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function sortedCounts(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function shortHash(value: string): string {
  if (!value) return "pending";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
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

function initialDashboardSection(): DashboardSection {
  const section = new URLSearchParams(window.location.search).get("section");
  return section === "trends" || section === "settings" || section === "demo" ? section : "incidents";
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function cssToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

createRoot(document.getElementById("root")!).render(<App />);

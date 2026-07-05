CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL DEFAULT 'default',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payment_id TEXT,
  invoice_id TEXT,
  sender_node TEXT NOT NULL,
  destination_node TEXT,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  fiber_payment_status TEXT,
  incident_status TEXT NOT NULL DEFAULT 'OPEN',
  normalized_class TEXT NOT NULL,
  classifier_confidence REAL NOT NULL,
  severity TEXT NOT NULL,
  remediation_code TEXT NOT NULL,
  remediation_title TEXT NOT NULL,
  remediation_detail TEXT NOT NULL,
  raw_error_json TEXT,
  redacted_payload_json TEXT,
  provenance_json TEXT NOT NULL,
  retry_of_incident_id TEXT,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT,
  event_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  received_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_project_time ON incidents(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_class ON incidents(project_id, normalized_class);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(project_id, incident_status);
CREATE INDEX IF NOT EXISTS idx_incidents_payment ON incidents(project_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_incidents_invoice ON incidents(project_id, invoice_id);


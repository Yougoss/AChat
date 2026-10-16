CREATE TABLE trace_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  mapping_id TEXT NOT NULL REFERENCES pi_session_mappings(id) ON DELETE CASCADE,
  call_id TEXT,
  type TEXT NOT NULL CHECK (
    type IN ('provider_request', 'provider_event', 'final_message', 'pi_event', 'achat_event')
  ),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX trace_records_mapping_order
ON trace_records(mapping_id, sequence);
CREATE INDEX trace_records_call
ON trace_records(mapping_id, call_id, sequence);

CREATE TRIGGER trace_records_no_update
BEFORE UPDATE ON trace_records
BEGIN
  SELECT RAISE(ABORT, 'trace records are append-only');
END;

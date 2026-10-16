CREATE TABLE achat_event_cursors (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE
);

INSERT INTO achat_event_cursors (event_id)
SELECT id FROM events ORDER BY created_at, id;

CREATE TRIGGER achat_event_cursors_no_update
BEFORE UPDATE ON achat_event_cursors
BEGIN
  SELECT RAISE(ABORT, 'AChat event cursors are append-only');
END;

CREATE TRIGGER achat_event_cursors_no_delete
BEFORE DELETE ON achat_event_cursors
BEGIN
  SELECT RAISE(ABORT, 'AChat event cursors are append-only');
END;

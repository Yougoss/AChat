CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (length(status) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, group_id)
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_id, contact_id)
);

CREATE TABLE task_members (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_id, contact_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'private')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (kind = 'task' AND group_id IS NOT NULL AND task_id IS NOT NULL) OR
    (kind = 'private' AND group_id IS NULL AND task_id IS NULL)
  ),
  FOREIGN KEY (task_id, group_id) REFERENCES tasks(id, group_id) ON DELETE CASCADE,
  UNIQUE (id, task_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (length(role) > 0),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, conversation_id)
);
CREATE INDEX messages_conversation_order ON messages(conversation_id, created_at, id);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (length(status) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, task_id)
);
CREATE INDEX work_items_task ON work_items(task_id, created_at, id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (status = 'running' AND completed_at IS NULL) OR
    (status != 'running' AND completed_at IS NOT NULL)
  ),
  FOREIGN KEY (work_item_id, task_id) REFERENCES work_items(id, task_id) ON DELETE CASCADE,
  UNIQUE (work_item_id, attempt),
  UNIQUE (id, task_id)
);
CREATE INDEX runs_task ON runs(task_id, started_at, id);
CREATE TRIGGER runs_identity_immutable
BEFORE UPDATE OF id, task_id, work_item_id, contact_id, attempt, started_at ON runs
BEGIN
  SELECT RAISE(ABORT, 'run identity is immutable');
END;
CREATE TRIGGER runs_status_transition
BEFORE UPDATE OF status ON runs
WHEN OLD.status != 'running' OR NEW.status = 'running'
BEGIN
  SELECT RAISE(ABORT, 'run status transition is invalid');
END;

CREATE TABLE pi_session_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  task_id TEXT,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('private', 'task')),
  pi_session_id TEXT NOT NULL UNIQUE,
  session_file TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (conversation_id, task_id) REFERENCES conversations(id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CHECK (
    (kind = 'task' AND task_id IS NOT NULL) OR
    (kind = 'private' AND task_id IS NULL)
  ),
  UNIQUE (pi_session_id, task_id)
);
CREATE TRIGGER pi_session_mapping_scope
BEFORE INSERT ON pi_session_mappings
WHEN NOT EXISTS (
  SELECT 1 FROM conversations
  WHERE conversations.id = NEW.conversation_id
    AND conversations.kind = NEW.kind
    AND conversations.task_id IS NEW.task_id
)
BEGIN
  SELECT RAISE(ABORT, 'Pi session mapping scope does not match its conversation');
END;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  pi_session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (work_item_id, task_id) REFERENCES work_items(id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (pi_session_id, task_id) REFERENCES pi_session_mappings(pi_session_id, task_id) ON DELETE CASCADE,
  CHECK ((status = 'pending' AND decided_at IS NULL) OR (status != 'pending' AND decided_at IS NOT NULL)),
  UNIQUE (task_id, work_item_id, pi_session_id, tool_call_id)
);
CREATE INDEX approvals_pending ON approvals(status, created_at);
CREATE TRIGGER approvals_scope_immutable
BEFORE UPDATE OF id, task_id, work_item_id, pi_session_id, tool_call_id, action_json, created_at
ON approvals
BEGIN
  SELECT RAISE(ABORT, 'approval identity and scope are immutable');
END;
CREATE TRIGGER approvals_status_transition
BEFORE UPDATE OF status ON approvals
WHEN OLD.status != 'pending' OR NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'approval status transition is invalid');
END;

CREATE TABLE task_events (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, idempotency_key)
);
CREATE INDEX task_events_order ON task_events(task_id, created_at, id);
CREATE TRIGGER task_events_no_update
BEFORE UPDATE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task events are append-only');
END;
CREATE TRIGGER task_events_no_delete
BEFORE DELETE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task events are append-only');
END;

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (entity_type, entity_id, idempotency_key)
);
CREATE INDEX events_entity_order ON events(entity_type, entity_id, created_at, id);
CREATE TRIGGER events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;
CREATE TRIGGER events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TABLE unread_cursors (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_read_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (contact_id, conversation_id),
  FOREIGN KEY (last_read_message_id, conversation_id)
    REFERENCES messages(id, conversation_id)
);

CREATE TABLE handoffs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  to_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  from_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  FOREIGN KEY (from_run_id, task_id) REFERENCES runs(id, task_id)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (work_item_id, task_id) REFERENCES work_items(id, task_id),
  FOREIGN KEY (run_id, task_id) REFERENCES runs(id, task_id)
);
CREATE INDEX artifacts_task ON artifacts(task_id, created_at, id);

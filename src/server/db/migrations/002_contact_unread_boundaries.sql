ALTER TABLE conversations ADD COLUMN contact_id TEXT REFERENCES contacts(id) ON DELETE RESTRICT;

UPDATE conversations
SET contact_id = (
  SELECT pi_session_mappings.contact_id
  FROM pi_session_mappings
  WHERE pi_session_mappings.conversation_id = conversations.id
    AND pi_session_mappings.kind = 'private'
  LIMIT 1
)
WHERE kind = 'private';

CREATE TRIGGER conversations_owner_insert
BEFORE INSERT ON conversations
WHEN
  (NEW.kind = 'private' AND NEW.contact_id IS NULL) OR
  (NEW.kind = 'task' AND NEW.contact_id IS NOT NULL) OR
  (
    NEW.kind = 'private'
    AND EXISTS (
      SELECT 1 FROM pi_session_mappings
      WHERE pi_session_mappings.conversation_id = NEW.id
        AND pi_session_mappings.contact_id != NEW.contact_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'conversation owner does not match its kind');
END;

CREATE TRIGGER conversations_owner_update
BEFORE UPDATE OF kind, contact_id ON conversations
WHEN
  (NEW.kind = 'private' AND NEW.contact_id IS NULL) OR
  (NEW.kind = 'task' AND NEW.contact_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'conversation owner does not match its kind');
END;

CREATE TRIGGER private_conversation_owner_immutable
BEFORE UPDATE OF contact_id ON conversations
WHEN OLD.kind = 'private' AND NEW.contact_id IS NOT OLD.contact_id
BEGIN
  SELECT RAISE(ABORT, 'private conversation owner is immutable');
END;

DROP TRIGGER pi_session_mapping_scope;
CREATE TRIGGER pi_session_mapping_scope
BEFORE INSERT ON pi_session_mappings
WHEN NOT EXISTS (
  SELECT 1 FROM conversations
  WHERE conversations.id = NEW.conversation_id
    AND conversations.kind = NEW.kind
    AND conversations.task_id IS NEW.task_id
    AND (
      (NEW.kind = 'private' AND conversations.contact_id = NEW.contact_id) OR
      (
        NEW.kind = 'task'
        AND conversations.contact_id IS NULL
        AND EXISTS (
          SELECT 1 FROM task_members
          WHERE task_members.task_id = NEW.task_id
            AND task_members.contact_id = NEW.contact_id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Pi session mapping owner or membership does not match its scope');
END;

CREATE UNIQUE INDEX pi_session_mapping_task_contact
ON pi_session_mappings(task_id, contact_id)
WHERE task_id IS NOT NULL;

CREATE TRIGGER pi_session_mapping_identity_immutable
BEFORE UPDATE OF id, contact_id, task_id, conversation_id, kind, pi_session_id
ON pi_session_mappings
BEGIN
  SELECT RAISE(ABORT, 'Pi session mapping identity is immutable');
END;

CREATE TRIGGER task_member_session_protected
BEFORE DELETE ON task_members
WHEN EXISTS (
  SELECT 1 FROM pi_session_mappings
  WHERE pi_session_mappings.task_id = OLD.task_id
    AND pi_session_mappings.contact_id = OLD.contact_id
)
BEGIN
  SELECT RAISE(ABORT, 'task member has a persisted session mapping');
END;

CREATE TRIGGER task_member_session_identity_immutable
BEFORE UPDATE OF task_id, contact_id ON task_members
BEGIN
  SELECT RAISE(ABORT, 'task member identity is immutable');
END;

CREATE TRIGGER runs_contact_scope
BEFORE INSERT ON runs
WHEN NOT EXISTS (
  SELECT 1 FROM work_items
  WHERE work_items.id = NEW.work_item_id
    AND work_items.task_id = NEW.task_id
    AND work_items.contact_id = NEW.contact_id
)
BEGIN
  SELECT RAISE(ABORT, 'run contact does not match its work item');
END;

CREATE TRIGGER work_item_contact_scope_immutable
BEFORE UPDATE OF contact_id ON work_items
WHEN NEW.contact_id IS NOT OLD.contact_id AND (
  EXISTS (
    SELECT 1 FROM runs
    WHERE runs.work_item_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM approvals
    WHERE approvals.work_item_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'work item contact is immutable after runs or approvals exist');
END;

CREATE TRIGGER runs_start_running_only
BEFORE INSERT ON runs
WHEN NEW.status != 'running'
BEGIN
  SELECT RAISE(ABORT, 'runs must start in running status');
END;

CREATE TRIGGER approvals_contact_scope
BEFORE INSERT ON approvals
WHEN NOT EXISTS (
  SELECT 1
  FROM work_items
  JOIN pi_session_mappings
    ON pi_session_mappings.task_id = work_items.task_id
   AND pi_session_mappings.contact_id = work_items.contact_id
  WHERE work_items.id = NEW.work_item_id
    AND work_items.task_id = NEW.task_id
    AND pi_session_mappings.pi_session_id = NEW.pi_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'approval contact does not match its work item and session');
END;

CREATE UNIQUE INDEX approvals_composite_identity
ON approvals(id, task_id, work_item_id);

CREATE TABLE run_completions (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (run_id, task_id) REFERENCES runs(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id, group_id) REFERENCES tasks(id, group_id) ON DELETE RESTRICT
);
CREATE INDEX run_completions_group_cursor ON run_completions(group_id, cursor);

CREATE TRIGGER run_completions_completed_only
BEFORE INSERT ON run_completions
WHEN NOT EXISTS (
  SELECT 1
  FROM runs
  JOIN tasks ON tasks.id = runs.task_id
  WHERE runs.id = NEW.run_id
    AND runs.task_id = NEW.task_id
    AND runs.status = 'completed'
    AND runs.completed_at = NEW.completed_at
    AND tasks.group_id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'run completion must match a completed run');
END;

CREATE TRIGGER runs_create_completion
AFTER UPDATE OF status ON runs
WHEN OLD.status = 'running' AND NEW.status = 'completed'
BEGIN
  INSERT INTO run_completions (run_id, task_id, group_id, completed_at)
  SELECT NEW.id, NEW.task_id, tasks.group_id, NEW.completed_at
  FROM tasks
  WHERE tasks.id = NEW.task_id;
END;

CREATE TRIGGER run_completions_no_update
BEFORE UPDATE ON run_completions
BEGIN
  SELECT RAISE(ABORT, 'run completions are append-only');
END;
CREATE TRIGGER run_completions_no_delete
BEFORE DELETE ON run_completions
BEGIN
  SELECT RAISE(ABORT, 'run completions are append-only');
END;

INSERT INTO run_completions (run_id, task_id, group_id, completed_at)
SELECT runs.id, runs.task_id, tasks.group_id, runs.completed_at
FROM runs JOIN tasks ON tasks.id = runs.task_id
WHERE runs.status = 'completed'
ORDER BY runs.completed_at, runs.id;

CREATE TABLE group_run_read_cursors (
  group_id TEXT PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER group_run_cursor_scope_insert
BEFORE INSERT ON group_run_read_cursors
WHEN NEW.cursor != 0 AND NOT EXISTS (
  SELECT 1 FROM run_completions
  WHERE run_completions.cursor = NEW.cursor
    AND run_completions.group_id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'run read cursor must belong to its group');
END;

CREATE TRIGGER group_run_cursor_scope_update
BEFORE UPDATE OF cursor ON group_run_read_cursors
WHEN
  NEW.cursor < OLD.cursor OR
  (NEW.cursor != 0 AND NOT EXISTS (
    SELECT 1 FROM run_completions
    WHERE run_completions.cursor = NEW.cursor
      AND run_completions.group_id = NEW.group_id
  ))
BEGIN
  SELECT RAISE(ABORT, 'run read cursor must advance within its group');
END;

CREATE TABLE attention_requests (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  run_id TEXT,
  approval_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('approval', 'input')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  FOREIGN KEY (work_item_id, task_id) REFERENCES work_items(id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, task_id) REFERENCES runs(id, task_id),
  FOREIGN KEY (approval_id, task_id, work_item_id)
    REFERENCES approvals(id, task_id, work_item_id) ON DELETE CASCADE,
  CHECK (
    (kind = 'approval' AND approval_id IS NOT NULL) OR
    (kind = 'input' AND approval_id IS NULL)
  ),
  CHECK (
    (status = 'open' AND resolved_at IS NULL) OR
    (status IN ('resolved', 'cancelled') AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX attention_requests_task_status
ON attention_requests(task_id, status, created_at, id);

CREATE TRIGGER attention_request_identity_immutable
BEFORE UPDATE OF id, task_id, work_item_id, run_id, approval_id, kind, created_at
ON attention_requests
BEGIN
  SELECT RAISE(ABORT, 'attention request identity is immutable');
END;

CREATE TRIGGER attention_request_status_transition
BEFORE UPDATE OF status ON attention_requests
WHEN OLD.status != 'open' OR NEW.status = 'open'
BEGIN
  SELECT RAISE(ABORT, 'attention request status transition is invalid');
END;

ALTER TABLE work_items ADD COLUMN handoff_depth INTEGER NOT NULL DEFAULT 0
  CHECK (handoff_depth BETWEEN 0 AND 8);
ALTER TABLE work_items ADD COLUMN source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE handoffs ADD COLUMN from_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT;
ALTER TABLE handoffs ADD COLUMN to_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT;
ALTER TABLE handoffs ADD COLUMN source_pi_session_id TEXT;
ALTER TABLE handoffs ADD COLUMN tool_call_id TEXT;
ALTER TABLE handoffs ADD COLUMN instruction TEXT NOT NULL DEFAULT '';
ALTER TABLE handoffs ADD COLUMN expected_output TEXT;
ALTER TABLE handoffs ADD COLUMN handoff_depth INTEGER NOT NULL DEFAULT 0
  CHECK (handoff_depth BETWEEN 0 AND 8);
ALTER TABLE handoffs ADD COLUMN message_id TEXT REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE handoffs ADD COLUMN work_item_id TEXT REFERENCES work_items(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX handoffs_source_tool_call
ON handoffs(source_pi_session_id, tool_call_id)
WHERE source_pi_session_id IS NOT NULL AND tool_call_id IS NOT NULL;

CREATE TRIGGER handoff_source_scope
BEFORE INSERT ON handoffs
WHEN NEW.source_pi_session_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pi_session_mappings
  WHERE pi_session_mappings.pi_session_id = NEW.source_pi_session_id
    AND pi_session_mappings.contact_id = NEW.from_contact_id
    AND pi_session_mappings.task_id = NEW.task_id
    AND pi_session_mappings.kind = 'task'
)
BEGIN
  SELECT RAISE(ABORT, 'handoff source session does not match its contact and task');
END;

CREATE TRIGGER handoff_recipient_scope
BEFORE INSERT ON handoffs
WHEN NEW.to_agent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM contacts
  JOIN task_members ON task_members.contact_id = contacts.id
  WHERE contacts.agent_id = NEW.to_agent_id
    AND task_members.task_id = NEW.task_id
    AND contacts.id = NEW.to_contact_id
)
BEGIN
  SELECT RAISE(ABORT, 'handoff recipient is not a task member');
END;

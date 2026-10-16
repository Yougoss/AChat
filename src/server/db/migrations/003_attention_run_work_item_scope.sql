CREATE TRIGGER attention_request_run_work_item_scope_insert
BEFORE INSERT ON attention_requests
WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM runs
  WHERE runs.id = NEW.run_id
    AND runs.task_id = NEW.task_id
    AND runs.work_item_id = NEW.work_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'attention request run must belong to its work item');
END;

CREATE TRIGGER attention_request_run_work_item_scope_update
BEFORE UPDATE OF run_id, task_id, work_item_id ON attention_requests
WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM runs
  WHERE runs.id = NEW.run_id
    AND runs.task_id = NEW.task_id
    AND runs.work_item_id = NEW.work_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'attention request run must belong to its work item');
END;

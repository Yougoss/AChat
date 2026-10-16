CREATE TABLE search_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL CHECK (document_type IN ('contact', 'task', 'message')),
  entity_id TEXT NOT NULL,
  contact_id TEXT,
  group_id TEXT,
  task_id TEXT,
  message_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  UNIQUE (document_type, entity_id)
);

CREATE INDEX search_documents_contact ON search_documents(contact_id, document_type);
CREATE INDEX search_documents_group ON search_documents(group_id, document_type);
CREATE INDEX search_documents_task ON search_documents(task_id, document_type);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  name,
  description,
  content,
  content='search_documents',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER search_documents_fts_insert
AFTER INSERT ON search_documents
BEGIN
  INSERT INTO search_documents_fts(rowid, name, description, content)
  VALUES (NEW.id, NEW.name, NEW.description, NEW.content);
END;

CREATE TRIGGER search_documents_fts_delete
AFTER DELETE ON search_documents
BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, name, description, content)
  VALUES ('delete', OLD.id, OLD.name, OLD.description, OLD.content);
END;

CREATE TRIGGER search_documents_fts_update
AFTER UPDATE ON search_documents
BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, name, description, content)
  VALUES ('delete', OLD.id, OLD.name, OLD.description, OLD.content);
  INSERT INTO search_documents_fts(rowid, name, description, content)
  VALUES (NEW.id, NEW.name, NEW.description, NEW.content);
END;

CREATE TRIGGER contacts_search_insert
AFTER INSERT ON contacts
BEGIN
  INSERT INTO search_documents (document_type, entity_id, contact_id, name, description)
  VALUES ('contact', NEW.id, NEW.id, NEW.name, NEW.description);
END;

CREATE TRIGGER contacts_search_update
AFTER UPDATE OF name, description ON contacts
BEGIN
  INSERT INTO search_documents (document_type, entity_id, contact_id, name, description)
  VALUES ('contact', NEW.id, NEW.id, NEW.name, NEW.description)
  ON CONFLICT (document_type, entity_id) DO UPDATE SET
    contact_id = excluded.contact_id,
    name = excluded.name,
    description = excluded.description;
END;

CREATE TRIGGER contacts_search_delete
AFTER DELETE ON contacts
BEGIN
  DELETE FROM search_documents
  WHERE document_type = 'contact' AND entity_id = OLD.id;
END;

CREATE TRIGGER tasks_search_insert
AFTER INSERT ON tasks
BEGIN
  INSERT INTO search_documents (
    document_type, entity_id, group_id, task_id, name, description
  )
  SELECT 'task', NEW.id, groups.id, NEW.id, groups.name,
         trim(groups.description || ' ' || NEW.description)
  FROM groups
  WHERE groups.id = NEW.group_id;
END;

CREATE TRIGGER tasks_search_update
AFTER UPDATE OF group_id, description ON tasks
BEGIN
  INSERT INTO search_documents (
    document_type, entity_id, group_id, task_id, name, description
  )
  SELECT 'task', NEW.id, groups.id, NEW.id, groups.name,
         trim(groups.description || ' ' || NEW.description)
  FROM groups
  WHERE groups.id = NEW.group_id
  ON CONFLICT (document_type, entity_id) DO UPDATE SET
    group_id = excluded.group_id,
    task_id = excluded.task_id,
    name = excluded.name,
    description = excluded.description;
END;

CREATE TRIGGER tasks_search_delete
AFTER DELETE ON tasks
BEGIN
  DELETE FROM search_documents
  WHERE document_type = 'task' AND entity_id = OLD.id;
END;

CREATE TRIGGER groups_search_update
AFTER UPDATE OF name, description ON groups
BEGIN
  UPDATE search_documents
  SET name = NEW.name,
      description = trim(
        NEW.description || ' ' ||
        coalesce((SELECT tasks.description FROM tasks WHERE tasks.group_id = NEW.id), '')
      )
  WHERE document_type = 'task' AND group_id = NEW.id;
END;

CREATE TRIGGER messages_search_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO search_documents (
    document_type, entity_id, contact_id, group_id, task_id, message_id, content, created_at
  )
  SELECT 'message', NEW.id, conversations.contact_id, conversations.group_id,
         conversations.task_id, NEW.id, NEW.content, NEW.created_at
  FROM conversations
  WHERE conversations.id = NEW.conversation_id;
END;

CREATE TRIGGER messages_search_update
AFTER UPDATE OF conversation_id, content, created_at ON messages
BEGIN
  INSERT INTO search_documents (
    document_type, entity_id, contact_id, group_id, task_id, message_id, content, created_at
  )
  SELECT 'message', NEW.id, conversations.contact_id, conversations.group_id,
         conversations.task_id, NEW.id, NEW.content, NEW.created_at
  FROM conversations
  WHERE conversations.id = NEW.conversation_id
  ON CONFLICT (document_type, entity_id) DO UPDATE SET
    contact_id = excluded.contact_id,
    group_id = excluded.group_id,
    task_id = excluded.task_id,
    message_id = excluded.message_id,
    content = excluded.content,
    created_at = excluded.created_at;
END;

CREATE TRIGGER messages_search_delete
AFTER DELETE ON messages
BEGIN
  DELETE FROM search_documents
  WHERE document_type = 'message' AND entity_id = OLD.id;
END;

INSERT INTO search_documents (document_type, entity_id, contact_id, name, description)
SELECT 'contact', id, id, name, description
FROM contacts;

INSERT INTO search_documents (
  document_type, entity_id, group_id, task_id, name, description
)
SELECT 'task', tasks.id, groups.id, tasks.id, groups.name,
       trim(groups.description || ' ' || tasks.description)
FROM tasks JOIN groups ON groups.id = tasks.group_id;

INSERT INTO search_documents (
  document_type, entity_id, contact_id, group_id, task_id, message_id, content, created_at
)
SELECT 'message', messages.id, conversations.contact_id, conversations.group_id,
       conversations.task_id, messages.id, messages.content, messages.created_at
FROM messages JOIN conversations ON conversations.id = messages.conversation_id;

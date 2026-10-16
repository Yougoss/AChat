import type Database from "better-sqlite3";

export interface PersistedEventNotice {
  id: string;
  cursor: number;
  entityType: string;
  entityId: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
}

type EventListener = (event: PersistedEventNotice) => void;

const listenersByDatabase = new WeakMap<Database.Database, Set<EventListener>>();

export function subscribePersistedEvents(
  db: Database.Database,
  listener: EventListener,
): () => void {
  let listeners = listenersByDatabase.get(db);
  if (!listeners) {
    listeners = new Set();
    listenersByDatabase.set(db, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

export function publishPersistedEvent(
  db: Database.Database,
  event: PersistedEventNotice,
): void {
  for (const listener of listenersByDatabase.get(db) ?? []) listener(event);
}

import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface SessionRegistryKey {
  contactId: string;
  sessionKind: "contact_chat" | "task";
  taskId?: string;
  modelId: string;
}

function keyOf(key: SessionRegistryKey): string {
  return JSON.stringify([
    key.contactId,
    key.sessionKind,
    key.sessionKind === "task" ? key.taskId : null,
    key.modelId,
  ]);
}

export function createSessionRegistry() {
  const sessions = new Map<string, { key: SessionRegistryKey; session: AgentSession }>();
  return {
    get(key: SessionRegistryKey): AgentSession | undefined {
      const entry = sessions.get(keyOf(key));
      return entry?.key.modelId === key.modelId ? entry.session : undefined;
    },
    set(key: SessionRegistryKey, session: AgentSession): void {
      for (const [storedKey, entry] of sessions) {
        if (
          entry.key.contactId === key.contactId
          && entry.key.sessionKind === key.sessionKind
          && entry.key.taskId === key.taskId
          && storedKey !== keyOf(key)
        ) {
          entry.session.dispose();
          sessions.delete(storedKey);
        }
      }
      const storedKey = keyOf(key);
      const previous = sessions.get(storedKey);
      if (previous && previous.session !== session) previous.session.dispose();
      sessions.set(storedKey, { key: { ...key }, session });
    },
    delete(key: SessionRegistryKey): boolean {
      const entry = sessions.get(keyOf(key));
      if (!entry) return false;
      sessions.delete(keyOf(key));
      entry.session.dispose();
      return true;
    },
    disposeAll(): void {
      for (const { session } of sessions.values()) session.dispose();
      sessions.clear();
    },
    size(): number {
      return sessions.size;
    },
  };
}

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;

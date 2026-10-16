import type Database from "better-sqlite3";
import type { AppEvent } from "../db/repositories/event-repository.ts";
import { createEventRepository } from "../db/repositories/event-repository.ts";
import { subscribePersistedEvents } from "../db/repositories/event-pubsub.ts";

export type EventCursor = number;
export type AChatEvent = AppEvent;

export function appendAchatEvent(
  db: Database.Database,
  event: Parameters<ReturnType<typeof createEventRepository>["appendEvent"]>[0],
): EventCursor {
  return createEventRepository(db).appendEvent(event).cursor;
}

export async function* subscribeEvents(
  db: Database.Database,
  afterCursor: EventCursor,
  signal?: AbortSignal,
): AsyncGenerator<AChatEvent> {
  if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) {
    throw new Error("Event cursor must be a non-negative integer");
  }

  const events = createEventRepository(db);
  let notified = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    notified = true;
    wake?.();
  };
  const unsubscribe = subscribePersistedEvents(db, notify);

  function waitForNotification(): Promise<void> {
    if (notified) {
      notified = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        wake = undefined;
        notified = false;
        resolve();
      };
      wake = finish;
      timer = setTimeout(finish, 1000);
      signal?.addEventListener("abort", finish, { once: true });
      if (signal?.aborted) finish();
    });
  }

  let cursor = afterCursor;
  try {
    while (!signal?.aborted) {
      const replay = events.listEventsAfterCursor(cursor);
      if (replay.length) {
        for (const event of replay) {
          cursor = event.cursor;
          yield event;
        }
        continue;
      }
      await waitForNotification();
    }
  } finally {
    unsubscribe();
    wake?.();
  }
}

export function createEventStreamService(db: Database.Database) {
  return {
    appendAchatEvent(
      event: Parameters<ReturnType<typeof createEventRepository>["appendEvent"]>[0],
    ): EventCursor {
      return appendAchatEvent(db, event);
    },
    subscribeEvents(afterCursor: EventCursor, signal?: AbortSignal): AsyncIterable<AChatEvent> {
      return subscribeEvents(db, afterCursor, signal);
    },
    getCurrentCursor(): EventCursor {
      return createEventRepository(db).getCurrentCursor();
    },
  };
}

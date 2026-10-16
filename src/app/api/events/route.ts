import { subscribeEvents } from "../../../server/services/event-stream.ts";
import { getAchatDatabase, startAchatRuntime } from "../../../server/runtime-bootstrap.ts";

export const dynamic = "force-dynamic";

function parseCursor(value: string | null): number | undefined {
  if (value === null || value === "") return 0;
  if (!/^\d+$/.test(value)) return undefined;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const cursorValue = request.headers.get("last-event-id")
    ?? new URL(request.url).searchParams.get("after");
  const afterCursor = parseCursor(cursorValue);
  if (afterCursor === undefined) {
    return Response.json({ error: "A valid event cursor is required" }, { status: 400 });
  }
  try {
    await startAchatRuntime();
    const db = getAchatDatabase();
    const controller = new AbortController();
    const onRequestAbort = () => controller.abort();
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    const iterator = subscribeEvents(db, afterCursor, controller.signal)[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(": connected\n\n"));
        void (async () => {
          try {
            while (!controller.signal.aborted) {
              const next = await iterator.next();
              if (next.done) break;
              streamController.enqueue(encoder.encode(
                `id: ${next.value.cursor}\ndata: ${JSON.stringify(next.value)}\n\n`,
              ));
            }
            streamController.close();
          } catch (error) {
            streamController.error(error);
          } finally {
            request.signal.removeEventListener("abort", onRequestAbort);
            await iterator.return?.(undefined);
          }
        })();
      },
      async cancel() {
        controller.abort();
        request.signal.removeEventListener("abort", onRequestAbort);
        await iterator.return?.(undefined);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to subscribe to AChat events";
    return Response.json({ error: message }, { status: 500 });
  }
}

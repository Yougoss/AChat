import {
  loginProvider,
  submitProviderLoginInput,
} from "../../../../../server/pi/model-runtime.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { provider } = await params;
  if (provider !== "github-copilot") {
    return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON login response is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("token" in body)
    || typeof body.token !== "string"
    || !("input" in body || "code" in body)
  ) {
    return Response.json({ error: "token and input are required" }, { status: 400 });
  }
  const input = "input" in body ? body.input : body.code;
  if (typeof input !== "string") {
    return Response.json({ error: "input must be a string" }, { status: 400 });
  }
  if (!submitProviderLoginInput(provider, body.token, input)) {
    return Response.json({ error: "No pending login prompt for this token" }, { status: 404 });
  }
  return Response.json({ ok: true, provider });
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { provider } = await params;
  if (provider !== "github-copilot") {
    return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  const abort = new AbortController();
  const abortLogin = () => abort.abort(request.signal.reason);
  request.signal.addEventListener("abort", abortLogin, { once: true });
  if (request.signal.aborted) abortLogin();
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of loginProvider(provider, undefined, abort.signal)) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        if (!cancelled) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          })}\n\n`));
        }
      } finally {
        request.signal.removeEventListener("abort", abortLogin);
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

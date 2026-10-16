import { createTraceQueryService } from "../../../../../server/services/trace-query-service.ts";
import { resolveDataDir } from "../../../../../server/app-runtime.ts";
import { migrate, openDatabase } from "../../../../../server/db/client.ts";
import { createAgentRepository } from "../../../../../server/db/repositories/agent-repository.ts";
import path from "node:path";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId } = await params;
  const query = new URL(request.url).searchParams;
  const limitValue = query.get("limit");
  const limit = limitValue === null ? undefined : Number(limitValue);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return Response.json({ error: "limit must be an integer between 1 and 100" }, { status: 400 });
  }
  const db = openDatabase(path.join(resolveDataDir(), "achat.sqlite"));
  try {
    migrate(db);
    if (!createAgentRepository(db).getContact(contactId)) {
      return Response.json({ error: `Contact not found: ${contactId}` }, { status: 404 });
    }
    return Response.json(await createTraceQueryService(db).listContactTasks(contactId, {
      cursor: query.get("cursor") ?? undefined,
      limit,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load session results";
    return Response.json({ error: message }, { status: /not found|not authorized/i.test(message) ? 404 : 400 });
  } finally {
    db.close();
  }
}

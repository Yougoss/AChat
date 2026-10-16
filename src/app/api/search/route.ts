import { searchVisibleMessages } from "../../../server/services/search-service.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  if (!query.trim()) return Response.json({ results: [] });

  const contactId = params.get("contactId")?.trim() || undefined;
  const limitValue = params.get("limit");
  const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
  if (limitValue && (!Number.isInteger(limit) || limit! < 1)) {
    return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  try {
    return Response.json({
      results: await searchVisibleMessages(query, contactId, limit),
    });
  } catch {
    return Response.json({ error: "Unable to search visible messages" }, { status: 500 });
  }
}

import { listConversationItems } from "../../../server/services/conversation-list-service.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ items: await listConversationItems() });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to load conversations",
    }, { status: 500 });
  }
}

import { proposeLongTask } from "../../../../../server/services/contact-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON task-draft source is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("sourceMessage" in body)
    || typeof body.sourceMessage !== "string"
  ) {
    return Response.json({ error: "sourceMessage must be a string" }, { status: 400 });
  }
  try {
    return Response.json({ draft: await proposeLongTask(contactId, body.sourceMessage) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to draft a task";
    return Response.json({ error: message }, {
      status: message.startsWith("Contact not found:")
        ? 404
        : /required/i.test(message) ? 400 : 500,
    });
  }
}

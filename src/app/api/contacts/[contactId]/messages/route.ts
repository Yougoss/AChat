import {
  listContactMessages,
  sendContactMessage,
} from "../../../../../server/services/message-service.ts";
import { getContact } from "../../../../../server/services/contact-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId } = await params;
  try {
    await getContact(contactId);
    return Response.json({ messages: await listContactMessages(contactId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load conversation";
    return Response.json({ error: message }, {
      status: message.startsWith("Contact not found:") ? 404 : 500,
    });
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON message body is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("content" in body)
    || typeof body.content !== "string"
  ) {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  try {
    return Response.json({
      exchange: await sendContactMessage(contactId, { content: body.content }),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send contact message";
    return Response.json({ error: message }, {
      status: message.startsWith("Contact not found:")
        ? 404
        : /cannot be empty|required/i.test(message) ? 400 : 500,
    });
  }
}

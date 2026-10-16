import { getContact } from "../../../../server/services/contact-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId } = await params;
  try {
    return Response.json({ contact: await getContact(contactId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load contact";
    return Response.json({ error: message }, {
      status: message.startsWith("Contact not found:") ? 404 : 500,
    });
  }
}

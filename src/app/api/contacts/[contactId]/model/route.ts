import {
  getContactModel,
  setContactModel,
} from "../../../../../server/services/model-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

function statusFor(error: unknown): number {
  if (error instanceof Error && error.message.startsWith("Contact not found:")) return 404;
  if (error instanceof Error && /currently available/.test(error.message)) return 400;
  return 500;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { contactId } = await params;
    return Response.json({ contact: await getContactModel(contactId) });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to load contact model",
    }, { status: statusFor(error) });
  }
}

export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { contactId } = await params;
    const body: unknown = await request.json();
    if (
      typeof body !== "object"
      || body === null
      || !("modelId" in body)
      || typeof body.modelId !== "string"
      || !body.modelId.trim()
    ) {
      return Response.json({ error: "modelId is required" }, { status: 400 });
    }
    return Response.json({
      contact: await setContactModel(contactId, body.modelId),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to save contact model",
    }, { status: statusFor(error) });
  }
}

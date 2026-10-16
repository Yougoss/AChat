import { createContact, listContacts } from "../../../server/services/contact-service.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ contacts: await listContacts() });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to load contacts",
    }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON contact profile is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("name" in body)
    || typeof body.name !== "string"
    || !("description" in body)
    || typeof body.description !== "string"
    || !("modelProvider" in body)
    || typeof body.modelProvider !== "string"
    || !("modelId" in body)
    || typeof body.modelId !== "string"
  ) {
    return Response.json({
      error: "name, description, modelProvider, and modelId are required",
    }, { status: 400 });
  }
  try {
    return Response.json({
      contact: await createContact({
        name: body.name,
        description: body.description,
        modelProvider: body.modelProvider,
        modelId: body.modelId,
      }),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create contact";
    return Response.json({ error: message }, {
      status: /required|supports only|currently available/i.test(message) ? 400 : 500,
    });
  }
}

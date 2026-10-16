import { createGroupAndTask } from "../../../server/services/workspace-service.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON group/task request is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("name" in body)
    || typeof body.name !== "string"
    || !("projectId" in body)
    || typeof body.projectId !== "string"
    || !("contactIds" in body)
    || !Array.isArray(body.contactIds)
    || !body.contactIds.every((contactId) => typeof contactId === "string")
    || ("description" in body && typeof body.description !== "string")
  ) {
    return Response.json({
      error: "name, projectId, contactIds, and an optional description are required",
    }, { status: 400 });
  }
  try {
    return Response.json({
      ...await createGroupAndTask({
        name: body.name,
        projectId: body.projectId,
        contactIds: body.contactIds,
        description: "description" in body && typeof body.description === "string"
          ? body.description
          : "",
      }),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create group and task";
    return Response.json({ error: message }, {
      status: /required|registered project|select at least|contact not found/i.test(message) ? 400 : 500,
    });
  }
}

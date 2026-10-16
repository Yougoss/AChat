import { createProject, listProjects } from "../../../server/services/workspace-service.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ projects: await listProjects() });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to load projects",
    }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON project profile is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("name" in body)
    || typeof body.name !== "string"
    || !("rootPath" in body)
    || typeof body.rootPath !== "string"
  ) {
    return Response.json({ error: "name and rootPath are required" }, { status: 400 });
  }
  try {
    return Response.json({
      project: await createProject({ name: body.name, rootPath: body.rootPath }),
    }, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to register project",
    }, { status: 400 });
  }
}

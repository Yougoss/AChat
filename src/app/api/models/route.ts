import { listCopilotModels } from "../../../server/pi/model-runtime.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ models: await listCopilotModels() });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to list models",
    }, { status: 500 });
  }
}

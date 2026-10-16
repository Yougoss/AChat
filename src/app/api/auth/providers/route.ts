import { listAuthProviders } from "../../../../server/pi/model-runtime.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ providers: await listAuthProviders() });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to load auth providers",
    }, { status: 500 });
  }
}

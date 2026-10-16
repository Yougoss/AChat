import { logoutProvider } from "../../../../../server/pi/model-runtime.ts";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (provider !== "github-copilot") {
    return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }
  try {
    await logoutProvider(provider);
    return Response.json({ ok: true, provider });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to log out provider",
    }, { status: 500 });
  }
}

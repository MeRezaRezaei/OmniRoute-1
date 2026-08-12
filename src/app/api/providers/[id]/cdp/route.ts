import { NextRequest, NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

export const dynamic = "force-dynamic";

/**
 * Per-provider CDP loopback endpoint.
 *
 * When a web-login browser is launched (`POST /api/providers/[id]/login`), the
 * server starts Chromium with `--remote-debugging-address=127.0.0.1` and an
 * auto-assigned port, then captures the `ws://127.0.0.1:<port>/devtools/browser/<id>`
 * endpoint from Chromium's stderr (see open-sse/services/inAppLoginService.ts).
 *
 * The endpoint is loopback-only by design. A remote installer cannot reach
 * 127.0.0.1 on the server machine directly, so this route lets the dashboard
 * (which is served by the server) read the endpoint over the normal
 * authenticated API and relay it to the remote client. The remote client then
 * opens the CDP WebSocket through the server's WS bridge (documented next step),
 * never by dialing the private address itself.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;

  const { id } = await params;
  try {
    const svc = await import("@omniroute/open-sse/services/inAppLoginService.ts");
    const endpoint = svc.getCdpEndpoint(id);
    return NextResponse.json({ providerId: id, endpoint: endpoint ?? null });
  } catch (err) {
    const message = sanitizeErrorMessage((err as Error)?.message ?? String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;

  const { id } = await params;
  try {
    const svc = await import("@omniroute/open-sse/services/inAppLoginService.ts");
    svc.clearCdpEndpoint(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = sanitizeErrorMessage((err as Error)?.message ?? String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

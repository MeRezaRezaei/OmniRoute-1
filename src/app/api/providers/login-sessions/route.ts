import { NextRequest, NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
export const dynamic = "force-dynamic";

/**
 * GET /api/providers/login-sessions
 *
 * Runtime registry of active + recent CDP login sessions, keyed by the
 * requestId the client supplied when it started the login. Lets the dashboard
 * correlate "this login request" ↔ "the tab opened in the user's Chrome
 * profile" and observe status (starting → detecting → verifying → complete).
 *
 * LOCAL-ONLY: this reflects state on the machine where the user's Chrome
 * lives. The route is classified with isLocalOnlyPath() (see
 * src/server/authz/routeGuard.ts).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  try {
    const { cdpLoginOrchestrator } = await import(
      "@omniroute/open-sse/services/cdpLoginOrchestrator.ts"
    );
    return NextResponse.json({ sessions: cdpLoginOrchestrator.listSessions() });
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/providers/login-sessions?requestId=<id>
 * Close a session's tab (optionally the CDP Chrome with closeChrome=true).
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
  const closeChrome = req.nextUrl.searchParams.get("closeChrome") === "true";
  if (!requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }
  try {
    const { cdpLoginOrchestrator } = await import(
      "@omniroute/open-sse/services/cdpLoginOrchestrator.ts"
    );
    const ok = await cdpLoginOrchestrator.closeSession(requestId, { closeChrome });
    return NextResponse.json({ ok });
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
/**
 * POST /api/providers/cdp-profile-scan
 *
 * Scan a Chrome profile (or all profiles) and report which web-provider session
 * cookies it holds, powering the dashboard profile→provider availability matrix.
 *
 * LOCAL-ONLY route (classified in src/server/authz/routeGuard.ts): launching /
 * attaching the operator's real Chrome and reading its cookies is a
 * local-machine operation. Loopback enforcement happens before auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      profileDir?: unknown;
      userDataDir?: unknown;
      all?: unknown;
      keepAlive?: unknown;
    };
    const { scanProfile, scanAllProfiles } = await import(
      "@omniroute/open-sse/services/cdpProfileScan.ts"
    );

    const userDataDir = typeof body.userDataDir === "string" ? body.userDataDir : undefined;
    const keepAlive = body.keepAlive === true;
    const all = body.all === true;

    if (all) {
      const results = await scanAllProfiles({ userDataDir, keepAlive });
      return NextResponse.json({ success: true, results });
    }

    const profileDir = typeof body.profileDir === "string" ? body.profileDir : undefined;
    if (!profileDir) {
      return NextResponse.json(
        { success: false, error: "profileDir is required (or pass all: true)" },
        { status: 400 }
      );
    }

    const result = await scanProfile({ profileDir, userDataDir, keepAlive });
    return NextResponse.json({ success: !result.error, result });
  } catch (err) {
    const msg = sanitizeErrorMessage(err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
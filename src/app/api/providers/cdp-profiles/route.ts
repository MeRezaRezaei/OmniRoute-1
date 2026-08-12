import { NextRequest, NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
import { listChromeProfiles } from "@omniroute/open-sse/services/chromeProfiles";

export const dynamic = "force-dynamic";

/**
 * List the user's Chrome profiles (name + account email) so the dashboard can let
 * them pick which profile to open for web-provider login. Local-only / management
 * auth required (exposes local filesystem + account info).
 */
export async function GET(req: NextRequest) {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;
  try {
    const profiles = listChromeProfiles();
    return NextResponse.json({ profiles });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}

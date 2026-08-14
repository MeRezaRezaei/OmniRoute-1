/**
 * POST /api/providers/cdp-bind
 *
 * Persist the chosen CDP profile mapping for a web provider so execution
 * binding (Pillar 3) and login always target the correct Chrome profile.
 * Writes providerSpecificData.cdpProfileDir on the provider connection.
 * Local-only: this maps to a Chrome profile on the server host.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireManagementAuth(req);
  if (auth) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    providerId?: unknown;
    profileDir?: unknown;
    unbind?: unknown;
  };

  const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
  const profileDir = typeof body.profileDir === "string" ? body.profileDir.trim() : "";
  const unbind = body.unbind === true;

  if (!providerId) {
    return NextResponse.json({ success: false, error: "providerId is required" }, { status: 400 });
  }
  if (!unbind && !profileDir) {
    return NextResponse.json({ success: false, error: "profileDir is required" }, { status: 400 });
  }

  try {
    const connection = await getCachedProviderConnectionById(providerId);
    if (!connection) {
      return NextResponse.json({ success: false, error: "Provider not found" }, { status: 404 });
    }

    const current = (connection.providerSpecificData ?? {}) as Record<string, unknown>;
    const providerSpecificData = unbind
      ? { ...current, cdpProfileDir: undefined }
      : { ...current, cdpProfileDir: profileDir };

    await updateProviderConnection(providerId, { providerSpecificData });

    return NextResponse.json({
      success: true,
      providerId,
      cdpProfileDir: unbind ? null : profileDir,
    });
  } catch (err) {
    const msg = sanitizeErrorMessage(err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

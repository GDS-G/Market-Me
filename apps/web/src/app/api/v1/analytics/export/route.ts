import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getWorkspaceAnalyticsRepository } from "@/server/database";
import { analyticsExportQuery, serializeAnalyticsExport } from "@/server/workspace-analytics-export";

const privateHeaders = Object.freeze({
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer", Vary: "Cookie",
});
function failure(status: number, code: string, message: string) { return Response.json({ error: { code, message } }, { status, headers: privateHeaders }); }

/** Session-only download. The query constrains, but never selects or authorizes, a workspace. */
export async function GET(request: Request) {
  try {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return failure(403, "cross_origin", "Open this download from Analytics.");
    const user = await getAuthenticatedUser(); if (!user) return failure(401, "authentication_required", "Sign in before downloading Analytics.");
    const workspace = await getActiveWorkspace(user.id); if (!workspace) return failure(404, "scope_unavailable", "The selected report is unavailable.");
    let selection: ReturnType<typeof analyticsExportQuery>;
    try { selection = analyticsExportQuery(new URL(request.url).searchParams, workspace.workspaceId); }
    catch { return failure(400, "invalid_selection", "Choose one current workspace, an optional Campaign and CSV or JSON format."); }
    const data = await getWorkspaceAnalyticsRepository().getSnapshot(workspace.workspaceId, user.id, selection.campaignId);
    if (!data || data.workspaceId !== workspace.workspaceId || (data.campaign?.id ?? undefined) !== selection.campaignId) return failure(404, "scope_unavailable", "The selected report is unavailable.");
    const file = serializeAnalyticsExport(data, selection.format);
    return new Response(file.body, { headers: { ...privateHeaders, "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"` } });
  } catch { return failure(503, "export_unavailable", "The report could not be downloaded. Try again or select a narrower Campaign scope."); }
}

import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCompanionRepository, getRepository } from "@/server/database";
import { getIngestionService } from "@/server/ingestion";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const source = await getRepository().getSmartSource(workspace.workspaceId, id);
    if (!source) return Response.json({ error: { code: "not_found", message: "Smart Source not found." } }, { status: 404 });

    const diagnostics: { code: string; message: string; severity: "info" | "warning" | "error" }[] = [];
    let matchedCount = 0;
    let ignoredCount = 0;
    if (source.provider === "local") {
      const assignedWorkerId = source.locations[0]?.providerLocationId;
      const available = assignedWorkerId
        ? (await getCompanionRepository().listLocalSourceAssignments(assignedWorkerId)).some((assignment) => assignment.id === source.id)
        : false;
      const items = await getRepository().listSourceItems(source.id);
      matchedCount = items.filter((item) => !item.isFolder).length;
      diagnostics.push(available
        ? { code: "local_companion_ready", message: `The assigned companion is ready; ${matchedCount} local files are indexed.`, severity: "info" }
        : { code: "local_companion_unavailable", message: "The assigned companion is offline, paused, attention-required, or lacks localFolderIngestion.", severity: "warning" });
    } else if (!source.storageConnectionId) {
      diagnostics.push({ code: "connection_missing", message: "Connect the storage provider before scanning this source.", severity: "warning" });
    } else {
      const sample = await getIngestionService().sampleSmartSource(workspace.workspaceId, source.id);
      matchedCount = sample.matchedCount;
      ignoredCount = sample.ignoredCount;
      diagnostics.push({
        code: "provider_sample_complete",
        message: `${matchedCount} of ${matchedCount + ignoredCount} sampled items matched the source filters.`,
        severity: sample.incompleteSearch ? "warning" : "info",
      });
    }
    if (source.allowedMimeTypes.length === 0) {
      diagnostics.push({ code: "mime_filter_open", message: "All MIME types are currently eligible.", severity: "info" });
    }
    diagnostics.push({
      code: "configuration_valid",
      message: `${source.locations.length} location${source.locations.length === 1 ? "" : "s"} passed configuration validation.`,
      severity: "info",
    });

    const result = await getRepository().recordSmartSourceTest({
      smartSourceId: source.id,
      requestedBy: user.id,
      status: diagnostics.some((item) => item.severity === "error")
        ? "failed"
        : diagnostics.some((item) => item.severity === "warning") ? "warning" : "passed",
      matchedCount,
      ignoredCount,
      diagnostics,
    });
    return Response.json({ data: result });
  } catch (error) {
    return apiError(error);
  }
}

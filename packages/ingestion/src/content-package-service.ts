import { createHash, randomUUID } from "node:crypto";
import { evaluateReadiness, resolveContextFacts, type EvidenceItem } from "@market-me/domain";
import type {
  ContextPackVersion,
  ContextAuthorityRule,
  ContextFactCandidate,
} from "@market-me/domain";
import type { MarketMeRepository, SourceItemRecord, StoredSmartSource } from "@market-me/database";
import type { StorageIngestionService } from "./service";
import type { MediaProcessor, ObjectStore, ProcessedMediaAsset } from "@market-me/media";

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/sql",
]);

export interface ContentPackageServiceOptions {
  repository: MarketMeRepository;
  ingestion: StorageIngestionService;
  maxDownloadBytes?: number;
  batchSize?: number;
  maxAttempts?: number;
  now?: () => Date;
  mediaProcessor?: MediaProcessor;
  objectStore?: ObjectStore;
}

function isTextContent(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType) || mimeType.startsWith("application/vnd.google-apps.");
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").trim() || name;
}

function extractionNeedsReview(asset: ProcessedMediaAsset): boolean {
  const documentExtraction = asset.metadata.documentExtraction;
  const documentState = documentExtraction && typeof documentExtraction === "object"
    ? (documentExtraction as Record<string, unknown>).state
    : undefined;
  const textExtraction = asset.metadata.textExtraction;
  const textState = textExtraction && typeof textExtraction === "object"
    ? (textExtraction as Record<string, unknown>).state
    : undefined;
  return documentState === "truncated" || documentState === "requires_ocr" || documentState === "failed"
    || textState === "truncated";
}

function contextEvidence(
  versions: readonly ContextPackVersion[],
): { evidence: EvidenceItem[]; conflicts: { factKey: string; candidateEvidenceIds: string[] }[]; unresolved: string[] } {
  const candidates: ContextFactCandidate[] = [];
  const candidateFacts = new Map<string, { fact: ContextPackVersion["facts"][number]; version: ContextPackVersion }>();
  const rules: ContextAuthorityRule[] = [];
  for (const version of versions) {
    rules.push(...version.authorityRules);
    for (const fact of version.facts.filter((item) => item.status !== "unresolved" && item.sourceId)) {
      candidates.push({ id: fact.id, factKey: fact.factKey, value: fact.value, sourceId: fact.sourceId! });
      candidateFacts.set(fact.id, { fact, version });
    }
  }
  const keys = [...new Set([...candidates.map((candidate) => candidate.factKey), ...rules.map((rule) => rule.factKey)])];
  const resolutions = resolveContextFacts(keys, candidates, rules);
  const evidence: EvidenceItem[] = [];
  const conflicts: { factKey: string; candidateEvidenceIds: string[] }[] = [];
  const unresolved: string[] = [];
  for (const resolution of resolutions) {
    if (resolution.status === "unresolved") {
      unresolved.push(resolution.factKey);
      evidence.push({
        id: randomUUID(), factKey: resolution.factKey,
        claim: `Unresolved context fact: ${resolution.factKey}`,
        provenance: "unresolved", sourceReferences: [],
      });
      continue;
    }
    const sourceCandidateIds = resolution.status === "resolved"
      ? resolution.selectedCandidateIds
      : resolution.conflictingCandidateIds;
    const evidenceIds: string[] = [];
    for (const candidateId of sourceCandidateIds) {
      const entry = candidateFacts.get(candidateId);
      if (!entry) continue;
      const evidenceId = randomUUID();
      evidenceIds.push(evidenceId);
      evidence.push({
        id: evidenceId,
        factKey: resolution.factKey,
        claim: `${resolution.factKey}: ${JSON.stringify(entry.fact.value)}`,
        provenance: "authoritative_context",
        sourceReferences: [`context-pack-version:${entry.version.id}`, `context-source:${entry.fact.sourceId}`],
        confidence: entry.fact.confidence,
        contextPackVersionId: entry.version.id,
      });
    }
    if (resolution.status === "conflicted") conflicts.push({ factKey: resolution.factKey, candidateEvidenceIds: evidenceIds });
  }
  return { evidence, conflicts, unresolved };
}

export class ContentPackageService {
  private readonly repository: MarketMeRepository;
  private readonly ingestion: StorageIngestionService;
  private readonly maxDownloadBytes: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly mediaProcessor?: MediaProcessor;
  private readonly objectStore?: ObjectStore;

  constructor(options: ContentPackageServiceOptions) {
    this.repository = options.repository;
    this.ingestion = options.ingestion;
    this.maxDownloadBytes = options.maxDownloadBytes ?? 10 * 1024 * 1024;
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.now = options.now ?? (() => new Date());
    this.mediaProcessor = options.mediaProcessor;
    this.objectStore = options.objectStore;
  }

  async processReadyEvents(): Promise<{ processed: number; deferred: number; ignored: number; failed: number }> {
    const events = await this.repository.claimIngestionEvents(this.batchSize);
    const result = { processed: 0, deferred: 0, ignored: 0, failed: 0 };
    for (const event of events) {
      try {
        if (event.eventKind === "deleted") {
          await this.repository.finishIngestionEvent({ eventId: event.id, status: "ignored" });
          result.ignored += 1;
          continue;
        }
        const source = await this.repository.getSmartSource(event.workspaceId, event.smartSourceId);
        const item = await this.repository.getSourceItemByProviderId(event.smartSourceId, event.providerItemId);
        if (!source || !item || item.deletedAt || item.isFolder) {
          await this.repository.finishIngestionEvent({ eventId: event.id, status: "ignored" });
          result.ignored += 1;
          continue;
        }
        const readiness = await this.readiness(source, item);
        if (!readiness.ready && source.readinessMode !== "ai_recommended") {
          const delaySeconds = Math.max(15, source.stabilizationWindowSeconds - readiness.stableForSeconds);
          await this.repository.deferIngestionEvent(
            event.id,
            new Date(this.now().getTime() + delaySeconds * 1000),
            readiness.reason,
          );
          result.deferred += 1;
          continue;
        }
        await this.buildPackage(source, item, !readiness.ready ? readiness.reason : undefined);
        await this.repository.finishIngestionEvent({ eventId: event.id, status: "processed" });
        result.processed += 1;
      } catch (error) {
        const finalAttempt = event.attemptCount >= this.maxAttempts;
        await this.repository.finishIngestionEvent({
          eventId: event.id,
          status: finalAttempt ? "ignored" : "failed",
          error: error instanceof Error ? error.message : "Unknown content package error",
          retryAt: new Date(this.now().getTime() + Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, event.attemptCount - 1))),
        });
        result.failed += 1;
      }
    }
    return result;
  }

  private async readiness(source: StoredSmartSource, item: SourceItemRecord) {
    const timestamp = item.modifiedAt ?? item.lastSeenAt;
    const stableForSeconds = Math.max(0, Math.floor((this.now().getTime() - new Date(timestamp).getTime()) / 1000));
    const siblings = (await this.repository.listSourceItems(source.id)).filter(
      (candidate) => !candidate.isFolder && candidate.providerParentId === item.providerParentId,
    );
    const markers = siblings.map((candidate) => candidate.name);
    const decision = evaluateReadiness(source, {
      stableForSeconds,
      relatedFileCount: siblings.length,
      markers,
    });
    return { ...decision, stableForSeconds };
  }

  private async buildPackage(source: StoredSmartSource, item: SourceItemRecord, readinessIssue?: string) {
    const packs = (await this.repository.listContextPacks(source.workspaceId))
      .filter((pack) => source.contextPackIds.includes(pack.id) && pack.currentVersion)
      .map((pack) => pack.currentVersion!);
    const grounded = contextEvidence(packs);
    const observed: EvidenceItem[] = [{
      id: randomUUID(),
      claim: `Observed source item ${item.name} at ${item.displayPath}.`,
      provenance: "observed",
      sourceReferences: [`source-item:${item.id}`],
      confidence: 1,
    }];
    let extractedText: string | undefined;
    let extractionStatus: "completed" | "skipped" | "failed" = "skipped";
    let extractionError: string | undefined;
    let contentHash = item.contentHash ?? sha256(`${item.providerItemId}:${item.providerEtag ?? item.modifiedAt ?? "unknown"}`);
    let processedAssets: readonly ProcessedMediaAsset[] | undefined;

    if ((this.mediaProcessor || isTextContent(item.mimeType)) && (source.provider === "local" || source.storageConnectionId)) {
      try {
        let bytes: Uint8Array;
        let declaredMimeType = item.mimeType;
        if (source.provider === "local") {
          if (!this.objectStore || !item.objectKey) throw new Error("Local source bytes have not been uploaded by the assigned companion");
          bytes = await this.objectStore.read(item.objectKey);
          if (bytes.byteLength > this.maxDownloadBytes) throw new Error(`Local source exceeds ${this.maxDownloadBytes} bytes`);
          if (item.contentHash && sha256(bytes) !== item.contentHash) throw new Error("Stored local source bytes do not match the manifest hash");
        } else {
          const credentials = await this.ingestion.getConnectionAccessToken(source.workspaceId, source.storageConnectionId!);
          const downloaded = await credentials.connector.downloadContent({
            accessToken: credentials.accessToken,
            providerItemId: item.providerItemId,
            providerLocationId: source.locations[0]?.providerLocationId,
            mimeType: item.mimeType,
            maxBytes: this.maxDownloadBytes,
          });
          bytes = downloaded.bytes;
          declaredMimeType = downloaded.mimeType || item.mimeType;
        }
        contentHash = sha256(bytes);
        if (this.mediaProcessor) {
          processedAssets = await this.mediaProcessor.process({
            fileName: item.name,
            declaredMimeType,
            bytes,
          });
          const processedOriginal = processedAssets.find((asset) => asset.role === "original");
          contentHash = processedOriginal?.contentHash ?? contentHash;
          extractedText = processedOriginal?.extractedText;
          extractionStatus = processedOriginal?.extractionStatus ?? "skipped";
          extractionError = processedOriginal?.extractionError;
        } else {
          extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replaceAll("\u0000", "").trim();
          extractionStatus = "completed";
        }
        if (extractedText) observed.push({
          id: randomUUID(),
          claim: extractedText.slice(0, 500),
          provenance: "observed",
          sourceReferences: [`source-item:${item.id}`, `content-hash:${contentHash}`],
          confidence: 1,
        });
      } catch (error) {
        extractionStatus = "failed";
        extractionError = error instanceof Error ? error.message : "Content extraction failed";
      }
    }
    if (readinessIssue) observed.push({
      id: randomUUID(),
      factKey: "readiness.ai_recommendation",
      claim: readinessIssue,
      provenance: "unresolved",
      sourceReferences: [`smart-source:${source.id}`],
    });
    const evidence = [...observed, ...grounded.evidence];
    const accessibilityReviewRequired = processedAssets?.some((asset) => asset.altTextStatus === "needs_review") ?? false;
    const mediaReviewRequired = processedAssets?.some((asset) => asset.scanStatus !== "clean" || asset.mediaStatus === "unsupported") ?? false;
    const extractionReviewRequired = processedAssets?.some(extractionNeedsReview) ?? false;
    const reviewRequired = grounded.conflicts.length > 0 || grounded.unresolved.length > 0 || Boolean(readinessIssue)
      || extractionStatus === "failed" || accessibilityReviewRequired || mediaReviewRequired || extractionReviewRequired;
    const confidenceValues = evidence.flatMap((entry) => entry.confidence === undefined ? [] : [entry.confidence]);
    await this.repository.saveContentPackage({
      workspaceId: source.workspaceId,
      smartSourceId: source.id,
      rootSourceItemId: item.id,
      title: titleFromName(item.name),
      status: reviewRequired ? "needs_review" : "ready",
      confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : undefined,
      contextPackVersionIds: packs.map((pack) => pack.id),
      assets: processedAssets?.map((asset) => ({
        ...asset,
        sourceItemId: asset.role === "original" ? item.id : undefined,
        rightsStatus: "unchecked" as const,
        metadata: {
          ...asset.metadata,
          displayPath: item.displayPath,
          providerItemId: item.providerItemId,
          webUrl: item.webUrl,
        },
      })) ?? [{
          clientKey: "original",
          sourceItemId: item.id,
          role: "original" as const,
          fileName: item.name,
          mimeType: item.mimeType,
          contentHash,
          extractedText,
          extractionStatus,
          extractionError,
          metadata: { displayPath: item.displayPath, providerItemId: item.providerItemId, webUrl: item.webUrl },
        }],
      evidence,
      conflicts: grounded.conflicts,
    });
  }
}

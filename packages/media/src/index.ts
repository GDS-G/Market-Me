import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  DOCUMENT_PROCESSING_VERSION,
  DEFAULT_DOCUMENT_EXTRACTION_LIMITS,
  DocumentExtractionError,
  type DocumentExtractionLimits,
  documentKindForMimeType,
  extractDocument,
  UNSUPPORTED_OFFICE_MIME_TYPES,
} from "./document-extraction";
import type { ObjectStore } from "./object-store";

export * from "./document-extraction";
export * from "./object-store";

export const MEDIA_PROCESSING_VERSION = "image-v1";
export const IMAGE_DERIVATIVE_RECIPES = [
  { name: "thumbnail", width: 320, height: 320, fit: "cover", quality: 80 },
  { name: "web_preview", width: 1200, height: 1200, fit: "inside", quality: 82 },
  { name: "square_preview", width: 1080, height: 1080, fit: "contain", quality: 82 },
] as const;

export type MediaStatus = "stored" | "processed" | "unsupported" | "failed";
export type MalwareScanStatus = "clean" | "infected" | "not_configured" | "failed";
export type AltTextStatus = "not_applicable" | "needs_review" | "approved" | "decorative";

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<{ status: MalwareScanStatus; engine?: string; detail?: string }>;
}

export class UnconfiguredMalwareScanner implements MalwareScanner {
  async scan(): Promise<{ status: "not_configured"; detail: string }> {
    return { status: "not_configured", detail: "No malware scanner is configured for this environment." };
  }
}

export interface ClamAvInstreamScannerOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  chunkBytes?: number;
}

export class ClamAvInstreamScanner implements MalwareScanner {
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly chunkBytes: number;

  constructor(private readonly options: ClamAvInstreamScannerOptions) {
    if (!options.host.trim()) throw new Error("ClamAV host is required");
    this.port = options.port ?? 3310;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.chunkBytes = options.chunkBytes ?? 64 * 1024;
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) throw new Error("ClamAV port must be an integer from 1 through 65535");
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) throw new Error("ClamAV timeout must be an integer from 100 through 120000 milliseconds");
    if (!Number.isInteger(this.chunkBytes) || this.chunkBytes < 1_024 || this.chunkBytes > 1024 * 1024) throw new Error("ClamAV chunk size must be an integer from 1024 through 1048576 bytes");
  }

  async scan(bytes: Uint8Array): Promise<{ status: MalwareScanStatus; engine?: string; detail?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let response = Buffer.alloc(0);
      const socket = createConnection({ host: this.options.host, port: this.port });
      const finish = (result: { status: MalwareScanStatus; engine?: string; detail?: string }) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      const fail = (detail: string) => finish({ status: "failed", engine: "clamd", detail });
      socket.setTimeout(this.timeoutMs, () => fail(`ClamAV scan timed out after ${this.timeoutMs} milliseconds.`));
      socket.on("error", (error) => fail(`ClamAV connection failed: ${error.message}`));
      socket.on("data", (chunk: Buffer) => {
        if (response.byteLength + chunk.byteLength > 16 * 1024) return fail("ClamAV returned an oversized response.");
        response = Buffer.concat([response, chunk]);
        const terminator = response.indexOf(0);
        if (terminator >= 0) finish(parseClamAvResponse(response.subarray(0, terminator).toString("utf8")));
      });
      socket.on("end", () => {
        if (!settled) finish(parseClamAvResponse(response.toString("utf8").trim()));
      });
      socket.on("connect", () => void this.writeStream(socket, bytes).catch((error) => fail(error instanceof Error ? error.message : "ClamAV stream write failed.")));
    });
  }

  private async writeStream(socket: Socket, bytes: Uint8Array): Promise<void> {
    await writeSocket(socket, Buffer.from("zINSTREAM\0", "utf8"));
    for (let offset = 0; offset < bytes.byteLength; offset += this.chunkBytes) {
      const chunk = Buffer.from(bytes.buffer, bytes.byteOffset + offset, Math.min(this.chunkBytes, bytes.byteLength - offset));
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.byteLength);
      await writeSocket(socket, length);
      await writeSocket(socket, chunk);
    }
    await writeSocket(socket, Buffer.alloc(4));
  }
}

function writeSocket(socket: Socket, value: Buffer): Promise<void> {
  return new Promise((resolve, reject) => socket.write(value, (error) => error ? reject(error) : resolve()));
}

function parseClamAvResponse(value: string): { status: MalwareScanStatus; engine: string; detail?: string } {
  const response = value.trim();
  if (/^stream: OK$/i.test(response)) return { status: "clean", engine: "clamd" };
  const infected = /^stream: (.+) FOUND$/i.exec(response);
  if (infected) return { status: "infected", engine: "clamd", detail: infected[1] };
  return { status: "failed", engine: "clamd", detail: response || "ClamAV closed the connection without a verdict." };
}

export interface ProcessedMediaAsset {
  clientKey: string;
  sourceAssetClientKey?: string;
  role: "original" | "derivative";
  fileName: string;
  mimeType: string;
  contentHash: string;
  objectKey: string;
  byteSize: number;
  processingVersion: string;
  recipe: Record<string, unknown>;
  mediaStatus: MediaStatus;
  scanStatus: MalwareScanStatus;
  scanEngine?: string;
  scanScannedAt?: string;
  scanRevision: number;
  altText?: string;
  altTextStatus: AltTextStatus;
  accessibilityNotes?: string;
  extractedText?: string;
  extractionStatus: "completed" | "skipped" | "failed";
  extractionError?: string;
  metadata: Record<string, unknown>;
}

export interface MediaProcessorOptions {
  objectStore: ObjectStore;
  malwareScanner?: MalwareScanner;
  maxSourceBytes?: number;
  processingVersion?: string;
  documentExtractionLimits?: Partial<DocumentExtractionLimits>;
}

const TEXT_MIME_TYPES = new Set([
  "application/json", "application/ld+json", "application/xml", "application/yaml",
  "application/x-yaml", "application/javascript", "application/sql",
]);

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType);
}

function compatibleMimeType(declared: string, detected: string): boolean {
  if (declared === detected) return true;
  if (declared === "image/jpg" && detected === "image/jpeg") return true;
  if (documentKindForMimeType(declared) && detected === "application/zip") return true;
  return declared === "application/octet-stream";
}

function cleanFileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim() || "Untitled image";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function inspectImageDimensions(
  bytes: Uint8Array,
  maxPixels = 100_000_000,
): Promise<{ width: number; height: number; pixels: number }> {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > 100_000_000)
    throw new MediaValidationError("Image pixel limit must be from 1 through 100000000");
  const metadata = await sharp(bytes, { failOn: "warning", limitInputPixels: maxPixels }).metadata();
  if (!metadata.width || !metadata.height || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height))
    throw new MediaValidationError("Image dimensions could not be verified");
  const pixels = metadata.width * metadata.height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) throw new MediaValidationError("Image exceeds the approved pixel limit");
  return { width: metadata.width, height: metadata.height, pixels };
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export class MediaProcessor {
  private readonly scanner: MalwareScanner;
  private readonly maxSourceBytes: number;
  private readonly version: string;

  constructor(private readonly options: MediaProcessorOptions) {
    this.scanner = options.malwareScanner ?? new UnconfiguredMalwareScanner();
    this.maxSourceBytes = options.maxSourceBytes ?? 50 * 1024 * 1024;
    this.version = options.processingVersion ?? MEDIA_PROCESSING_VERSION;
  }

  async process(input: { fileName: string; declaredMimeType: string; bytes: Uint8Array }): Promise<readonly ProcessedMediaAsset[]> {
    if (input.bytes.byteLength === 0) throw new MediaValidationError("Source asset is empty");
    if (input.bytes.byteLength > this.maxSourceBytes) throw new MediaValidationError(`Source asset exceeds ${this.maxSourceBytes} bytes`);
    const detected = await fileTypeFromBuffer(input.bytes);
    const declaredMimeType = input.declaredMimeType.toLowerCase();
    const mimeType = detected?.mime === "application/zip" && documentKindForMimeType(declaredMimeType)
      ? declaredMimeType
      : detected?.mime ?? declaredMimeType;
    if (detected && !compatibleMimeType(declaredMimeType, detected.mime)) {
      throw new MediaValidationError(`Declared MIME type ${input.declaredMimeType} does not match detected ${detected.mime}`);
    }
    if (!detected && !isTextMimeType(mimeType)) {
      throw new MediaValidationError(`Unable to verify binary MIME type ${input.declaredMimeType}`);
    }

    const digest = sha256Hex(input.bytes);
    const contentHash = `sha256:${digest}`;
    const originalKey = `originals/${digest}/source`;
    const scan = await this.scanner.scan(input.bytes);
    const scanScannedAt = new Date().toISOString();
    if (scan.status === "infected") throw new MediaValidationError("Malware scanner rejected the source asset");
    await this.options.objectStore.putImmutable(originalKey, input.bytes);

    const original: ProcessedMediaAsset = {
      clientKey: "original",
      role: "original",
      fileName: input.fileName,
      mimeType,
      contentHash,
      objectKey: originalKey,
      byteSize: input.bytes.byteLength,
      processingVersion: this.version,
      recipe: { operation: "immutable_original" },
      mediaStatus: "stored",
      scanStatus: scan.status,
      scanEngine: scan.engine,
      scanScannedAt,
      scanRevision: scan.status === "clean" ? 1 : 0,
      altTextStatus: mimeType.startsWith("image/") ? "needs_review" : "not_applicable",
      accessibilityNotes: scan.detail,
      extractionStatus: "skipped",
      metadata: {
        declaredMimeType: input.declaredMimeType,
        detectedMimeType: detected?.mime,
        detectedExtension: detected?.ext,
        scanEngine: scan.engine,
      },
    };

    if (isTextMimeType(mimeType)) {
      const maxTextCharacters = this.options.documentExtractionLimits?.maxTextCharacters
        ?? DEFAULT_DOCUMENT_EXTRACTION_LIMITS.maxTextCharacters;
      const decoded = new TextDecoder("utf-8", { fatal: false })
        .decode(input.bytes.slice(0, maxTextCharacters * 4))
        .replaceAll("\u0000", "")
        .trim();
      original.extractedText = decoded.slice(0, maxTextCharacters);
      original.extractionStatus = "completed";
      if (decoded.length > maxTextCharacters || input.bytes.byteLength > maxTextCharacters * 4) {
        original.extractionError = "Text extraction reached the configured character limit.";
        original.metadata = { ...original.metadata, textExtraction: { state: "truncated", maxTextCharacters } };
      }
      original.mediaStatus = "processed";
      return [original];
    }
    const documentKind = documentKindForMimeType(mimeType);
    if (documentKind) {
      try {
        const extracted = await extractDocument({
          mimeType,
          bytes: input.bytes,
          limits: this.options.documentExtractionLimits,
        });
        original.extractedText = extracted.text;
        original.extractionStatus = extracted.state === "requires_ocr" ? "failed" : "completed";
        original.extractionError = extracted.state === "requires_ocr"
          ? "No extractable text was found; OCR review is required."
          : extracted.state === "truncated" ? "Text extraction reached a configured resource limit." : undefined;
        original.mediaStatus = "processed";
        original.processingVersion = DOCUMENT_PROCESSING_VERSION;
        original.recipe = { operation: "bounded_document_text_extraction", kind: extracted.kind };
        original.metadata = {
          ...original.metadata,
          documentExtraction: {
            state: extracted.state,
            parser: extracted.parser,
            parserVersion: extracted.parserVersion,
            ...extracted.metadata,
          },
        };
      } catch (error) {
        const extraction = error instanceof DocumentExtractionError
          ? error
          : new DocumentExtractionError("malformed", error instanceof Error ? error.message : "Document extraction failed");
        original.mediaStatus = "failed";
        original.extractionStatus = "failed";
        original.extractionError = extraction.message;
        original.processingVersion = DOCUMENT_PROCESSING_VERSION;
        original.metadata = {
          ...original.metadata,
          documentExtraction: { state: "failed", errorCode: extraction.code },
        };
      }
      return [original];
    }
    if (UNSUPPORTED_OFFICE_MIME_TYPES.has(mimeType)) {
      original.mediaStatus = "unsupported";
      original.extractionError = "Legacy binary and macro-enabled Office documents are intentionally unsupported.";
      return [original];
    }
    if (!mimeType.startsWith("image/")) {
      original.mediaStatus = "unsupported";
      original.extractionError = "Processing for this verified media type is not implemented by the current media profile.";
      return [original];
    }

    const metadata = await sharp(input.bytes, { failOn: "warning", limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new MediaValidationError("Image dimensions could not be verified");
    original.mediaStatus = "processed";
    original.altText = `${cleanFileStem(input.fileName)} (${metadata.width} by ${metadata.height} image)`;
    original.metadata = {
      ...original.metadata,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      colorSpace: metadata.space,
      orientation: metadata.orientation,
      hasAlpha: metadata.hasAlpha,
      pages: metadata.pages,
    };

    const derivatives: ProcessedMediaAsset[] = [];
    for (const recipe of IMAGE_DERIVATIVE_RECIPES) {
      const recipeValue = { ...recipe, format: "webp", autoOrient: true, background: "#ffffff" };
      const recipeHash = sha256Hex(canonicalJson(recipeValue));
      const pipeline = sharp(input.bytes, { failOn: "warning", limitInputPixels: 100_000_000 })
        .autoOrient()
        .resize({
          width: recipe.width,
          height: recipe.height,
          fit: recipe.fit,
          withoutEnlargement: recipe.fit === "inside",
          background: "#ffffff",
        })
        .webp({ quality: recipe.quality });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      const derivativeDigest = sha256Hex(data);
      const objectKey = `derivatives/${digest}/${this.version}/${recipeHash}.webp`;
      await this.options.objectStore.putImmutable(objectKey, data);
      derivatives.push({
        clientKey: `derivative:${recipe.name}`,
        sourceAssetClientKey: "original",
        role: "derivative",
        fileName: `${cleanFileStem(input.fileName).replaceAll(" ", "-").toLowerCase()}-${recipe.name}.webp`,
        mimeType: "image/webp",
        contentHash: `sha256:${derivativeDigest}`,
        objectKey,
        byteSize: data.byteLength,
        processingVersion: this.version,
        recipe: recipeValue,
        mediaStatus: "processed",
        scanStatus: scan.status,
        scanEngine: scan.engine,
        scanScannedAt,
        scanRevision: scan.status === "clean" ? 1 : 0,
        altTextStatus: "not_applicable",
        extractionStatus: "skipped",
        metadata: { width: info.width, height: info.height, format: info.format, sourceContentHash: contentHash },
      });
    }
    return [original, ...derivatives];
  }
}

export function createAssetAccessSignature(signingKey: string, assetId: string, expiresEpochSeconds: number): string {
  if (Buffer.byteLength(signingKey, "utf8") < 32) throw new Error("MEDIA_ACCESS_SIGNING_KEY must contain at least 32 bytes");
  return createHmac("sha256", signingKey).update(`${assetId}.${expiresEpochSeconds}`).digest("base64url");
}

export function verifyAssetAccessSignature(input: {
  signingKey: string;
  assetId: string;
  expiresEpochSeconds: number;
  signature: string;
  nowEpochSeconds?: number;
  maxFutureSeconds?: number;
}): boolean {
  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const maxFuture = input.maxFutureSeconds ?? 300;
  if (!Number.isInteger(input.expiresEpochSeconds) || input.expiresEpochSeconds < now || input.expiresEpochSeconds > now + maxFuture) return false;
  const expected = createAssetAccessSignature(input.signingKey, input.assetId, input.expiresEpochSeconds);
  const actualBytes = Buffer.from(input.signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

import { getDocument, version as pdfJsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as yauzl from "yauzl";

export const DOCUMENT_PROCESSING_VERSION = "document-v1";

export const SUPPORTED_DOCUMENT_MIME_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const;

export const UNSUPPORTED_OFFICE_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export type DocumentKind = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[keyof typeof SUPPORTED_DOCUMENT_MIME_TYPES];
export type DocumentExtractionState = "completed" | "truncated" | "requires_ocr";
export type DocumentExtractionErrorCode = "encrypted" | "malformed" | "resource_limit" | "timeout";

export interface DocumentExtractionLimits {
  maxPages: number;
  maxTextCharacters: number;
  maxArchiveEntries: number;
  maxArchiveUncompressedBytes: number;
  maxXmlPartBytes: number;
  maxCompressionRatio: number;
  maxDurationMs: number;
}

export const DEFAULT_DOCUMENT_EXTRACTION_LIMITS: Readonly<DocumentExtractionLimits> = {
  maxPages: 250,
  maxTextCharacters: 250_000,
  maxArchiveEntries: 1_000,
  maxArchiveUncompressedBytes: 64 * 1024 * 1024,
  maxXmlPartBytes: 8 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxDurationMs: 30_000,
};

export interface DocumentExtractionResult {
  kind: DocumentKind;
  state: DocumentExtractionState;
  text?: string;
  parser: string;
  parserVersion: string;
  metadata: Record<string, unknown>;
}

export class DocumentExtractionError extends Error {
  constructor(readonly code: DocumentExtractionErrorCode, message: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

interface TextAccumulator {
  append(value: string): void;
  value(): string;
  truncated(): boolean;
}

function textAccumulator(maxCharacters: number): TextAccumulator {
  let text = "";
  let wasTruncated = false;
  return {
    append(value) {
      const normalized = value.replaceAll("\u0000", "").replaceAll(/[ \t]+\n/g, "\n").trim();
      if (!normalized || wasTruncated) return;
      const separator = text ? "\n\n" : "";
      const remaining = maxCharacters - text.length - separator.length;
      if (remaining <= 0) {
        wasTruncated = true;
        return;
      }
      text += separator + normalized.slice(0, remaining);
      if (normalized.length > remaining) wasTruncated = true;
    },
    value: () => text.trim(),
    truncated: () => wasTruncated,
  };
}

function limitsWithDefaults(overrides?: Partial<DocumentExtractionLimits>): DocumentExtractionLimits {
  const limits = { ...DEFAULT_DOCUMENT_EXTRACTION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
  }
  return limits;
}

function checkDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new DocumentExtractionError("timeout", "Document extraction exceeded its time limit");
}

function friendlyParserError(error: unknown): DocumentExtractionError {
  if (error instanceof DocumentExtractionError) return error;
  const message = error instanceof Error ? error.message : "Unknown parser failure";
  if (/password|encrypted/i.test(message)) return new DocumentExtractionError("encrypted", "Encrypted documents are not supported");
  return new DocumentExtractionError("malformed", `Document parser rejected the input: ${message}`);
}

function xmlText(value: string): string {
  return value
    .replaceAll(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replaceAll(/<w:br\b[^>]*\/?\s*>/gi, "\n")
    .replaceAll(/<a:br\b[^>]*\/?\s*>/gi, "\n")
    .replaceAll(/<\/w:p\s*>/gi, "\n")
    .replaceAll(/<\/a:p\s*>/gi, "\n")
    .replaceAll(/<\/row\s*>/gi, "\n")
    .replaceAll(/<\/c\s*>/gi, "\t")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replaceAll(/&#x([a-f0-9]+);/gi, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(bytes: Uint8Array, limits: DocumentExtractionLimits): Promise<DocumentExtractionResult> {
  const deadline = Date.now() + limits.maxDurationMs;
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: false,
    useWasm: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1) throw new DocumentExtractionError("malformed", "PDF contains no pages");
    const accumulator = textAccumulator(limits.maxTextCharacters);
    const extractedPageCount = Math.min(document.numPages, limits.maxPages);
    for (let pageNumber = 1; pageNumber <= extractedPageCount; pageNumber += 1) {
      checkDeadline(deadline);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const pageText = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .replaceAll(/[ \t]+\n/g, "\n")
        .trim();
      accumulator.append(pageText);
      page.cleanup();
      if (accumulator.truncated()) break;
    }
    const text = accumulator.value();
    const truncated = accumulator.truncated() || document.numPages > extractedPageCount;
    return {
      kind: "pdf",
      state: text ? (truncated ? "truncated" : "completed") : "requires_ocr",
      text: text || undefined,
      parser: "pdf.js",
      parserVersion: pdfJsVersion,
      metadata: {
        pageCount: document.numPages,
        extractedPageCount,
        textCharacterCount: text.length,
        maxPages: limits.maxPages,
        maxTextCharacters: limits.maxTextCharacters,
      },
    };
  } catch (error) {
    throw friendlyParserError(error);
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

function openZip(bytes: Uint8Array): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zipFile) => error ? reject(error) : resolve(zipFile));
  });
}

function listEntries(zipFile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    const onEntry = (entry: yauzl.Entry) => {
      entries.push(entry);
      zipFile.readEntry();
    };
    const cleanup = () => {
      zipFile.off("entry", onEntry);
      zipFile.off("error", onError);
      zipFile.off("end", onEnd);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onEnd = () => { cleanup(); resolve(entries); };
    zipFile.on("entry", onEntry);
    zipFile.once("error", onError);
    zipFile.once("end", onEnd);
    zipFile.readEntry();
  });
}

function readEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<string> {
  if (entry.uncompressedSize > maxBytes) {
    throw new DocumentExtractionError("resource_limit", `Archive part ${entry.fileName} exceeds ${maxBytes} bytes`);
  }
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      void (async () => {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk as Uint8Array);
          total += buffer.length;
          if (total > maxBytes) {
            stream.destroy();
            throw new DocumentExtractionError("resource_limit", `Archive part ${entry.fileName} exceeded ${maxBytes} bytes while inflating`);
          }
          chunks.push(buffer);
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      })().catch(reject);
    });
  });
}

function numericPartOrder(value: string): number {
  return Number(value.match(/(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function validateArchive(entries: readonly yauzl.Entry[], limits: DocumentExtractionLimits): void {
  if (entries.length > limits.maxArchiveEntries) {
    throw new DocumentExtractionError("resource_limit", `Office archive contains more than ${limits.maxArchiveEntries} entries`);
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.isEncrypted()) throw new DocumentExtractionError("encrypted", "Encrypted Office documents are not supported");
    total += entry.uncompressedSize;
    if (total > limits.maxArchiveUncompressedBytes) {
      throw new DocumentExtractionError("resource_limit", `Office archive expands beyond ${limits.maxArchiveUncompressedBytes} bytes`);
    }
    if (entry.uncompressedSize > 0 && entry.compressedSize === 0) {
      throw new DocumentExtractionError("malformed", `Archive part ${entry.fileName} has an invalid compressed size`);
    }
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
      throw new DocumentExtractionError("resource_limit", `Archive part ${entry.fileName} exceeds the compression-ratio limit`);
    }
  }
}

function officeParts(kind: Exclude<DocumentKind, "pdf">, entries: readonly yauzl.Entry[]): yauzl.Entry[] {
  const files = entries.filter((entry) => !entry.fileName.endsWith("/"));
  if (!files.some((entry) => entry.fileName === "[Content_Types].xml")) {
    throw new DocumentExtractionError("malformed", "Office archive is missing [Content_Types].xml");
  }
  if (kind === "docx") {
    if (!files.some((entry) => entry.fileName === "word/document.xml")) {
      throw new DocumentExtractionError("malformed", "Word document is missing word/document.xml");
    }
    return files.filter((entry) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(entry.fileName));
  }
  if (kind === "pptx") {
    const slides = files.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.fileName));
    if (!slides.length) throw new DocumentExtractionError("malformed", "PowerPoint document contains no slides");
    return slides.sort((a, b) => numericPartOrder(a.fileName) - numericPartOrder(b.fileName));
  }
  const sheets = files.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.fileName));
  if (!sheets.length) throw new DocumentExtractionError("malformed", "Excel workbook contains no worksheets");
  const sharedStrings = files.filter((entry) => entry.fileName === "xl/sharedStrings.xml");
  return [...sharedStrings, ...sheets.sort((a, b) => numericPartOrder(a.fileName) - numericPartOrder(b.fileName))];
}

function validateOfficeContentType(kind: Exclude<DocumentKind, "pdf">, contentTypesXml: string): void {
  const expected = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  }[kind];
  if (!contentTypesXml.toLowerCase().includes(expected)) {
    throw new DocumentExtractionError("malformed", `Office archive content type does not match declared ${kind}`);
  }
}

function extractSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlText(match[1]));
}

function extractWorksheet(xml: string, sharedStrings: readonly string[]): string {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
    return [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)].map((cellMatch) => {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const type = attributes.match(/\bt="([^"]+)"/i)?.[1];
      if (type === "inlineStr") return xmlText(body);
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      if (type === "s") return sharedStrings[Number(raw)] ?? "";
      if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
      return xmlText(raw);
    }).filter(Boolean).join("\t");
  }).filter(Boolean).join("\n");
}

async function extractOffice(
  kind: Exclude<DocumentKind, "pdf">,
  bytes: Uint8Array,
  limits: DocumentExtractionLimits,
): Promise<DocumentExtractionResult> {
  const deadline = Date.now() + limits.maxDurationMs;
  try {
    const zipFile = await openZip(bytes);
    const entries = await listEntries(zipFile);
    validateArchive(entries, limits);
    const contentTypesEntry = entries.find((entry) => entry.fileName === "[Content_Types].xml");
    if (!contentTypesEntry) throw new DocumentExtractionError("malformed", "Office archive is missing [Content_Types].xml");
    validateOfficeContentType(kind, await readEntry(zipFile, contentTypesEntry, limits.maxXmlPartBytes));
    const parts = officeParts(kind, entries);
    const accumulator = textAccumulator(limits.maxTextCharacters);
    let sharedStrings: string[] = [];
    let extractedPartCount = 0;
    for (const entry of parts) {
      checkDeadline(deadline);
      const xml = await readEntry(zipFile, entry, limits.maxXmlPartBytes);
      if (entry.fileName === "xl/sharedStrings.xml") {
        sharedStrings = extractSharedStrings(xml);
        continue;
      }
      accumulator.append(kind === "xlsx" ? extractWorksheet(xml, sharedStrings) : xmlText(xml));
      extractedPartCount += 1;
      if (accumulator.truncated()) break;
    }
    const text = accumulator.value();
    return {
      kind,
      state: accumulator.truncated() ? "truncated" : "completed",
      text: text || undefined,
      parser: "yauzl-ooxml",
      parserVersion: "1",
      metadata: {
        archiveEntryCount: entries.length,
        selectedPartCount: parts.filter((entry) => entry.fileName !== "xl/sharedStrings.xml").length,
        extractedPartCount,
        textCharacterCount: text.length,
        maxArchiveEntries: limits.maxArchiveEntries,
        maxArchiveUncompressedBytes: limits.maxArchiveUncompressedBytes,
        maxXmlPartBytes: limits.maxXmlPartBytes,
        maxTextCharacters: limits.maxTextCharacters,
      },
    };
  } catch (error) {
    throw friendlyParserError(error);
  }
}

export function documentKindForMimeType(mimeType: string): DocumentKind | undefined {
  return SUPPORTED_DOCUMENT_MIME_TYPES[mimeType.toLowerCase() as keyof typeof SUPPORTED_DOCUMENT_MIME_TYPES];
}

export async function extractDocument(input: {
  mimeType: string;
  bytes: Uint8Array;
  limits?: Partial<DocumentExtractionLimits>;
}): Promise<DocumentExtractionResult> {
  const kind = documentKindForMimeType(input.mimeType);
  if (!kind) throw new Error(`No document extractor is registered for ${input.mimeType}`);
  const limits = limitsWithDefaults(input.limits);
  return kind === "pdf" ? extractPdf(input.bytes, limits) : extractOffice(kind, input.bytes, limits);
}

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:net";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssetAccessSignature,
  ClamAvInstreamScanner,
  extractDocument,
  FileSystemObjectStore,
  MediaProcessor,
  MediaValidationError,
  verifyAssetAccessSignature,
} from "./index";

const temporaryRoots: string[] = [];
const testServers: Server[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(testServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function clamServer(reply: string, observe?: (bytes: Uint8Array) => void): Promise<number> {
  const server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      const commandEnd = received.indexOf(0);
      if (commandEnd < 0 || received.subarray(0, commandEnd).toString("utf8") !== "zINSTREAM") return;
      let offset = commandEnd + 1;
      const payload: Buffer[] = [];
      while (offset + 4 <= received.byteLength) {
        const length = received.readUInt32BE(offset);
        if (offset + 4 + length > received.byteLength) return;
        offset += 4;
        if (length === 0) {
          observe?.(Buffer.concat(payload));
          socket.end(Buffer.from(`${reply}\0`, "utf8"));
          return;
        }
        payload.push(received.subarray(offset, offset + length));
        offset += length;
      }
    });
  });
  testServers.push(server);
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test ClamAV server did not bind a TCP port");
  return address.port;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "market-me-media-"));
  temporaryRoots.push(root);
  return { root, store: new FileSystemObjectStore(root) };
}

async function pdfFixture(text?: string, pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = text ? await document.embedFont(StandardFonts.Helvetica) : undefined;
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([612, 792]);
    if (text && font) page.drawText(pageCount === 1 ? text : `${text} ${index + 1}`, { x: 72, y: 720, size: 18, font });
  }
  return document.save({ useObjectStreams: false });
}

function officeFixture(parts: Record<string, string | undefined>, level: 0 | 6 = 6): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => [name, strToU8(value)])), { level });
}

function contentTypes(kind: "docx" | "pptx" | "xlsx"): string {
  const contentType = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  }[kind];
  return `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override ContentType="${contentType}"/></Types>`;
}

describe("media processing", () => {
  it("streams bytes through the framed ClamAV INSTREAM protocol", async () => {
    const bytes = new TextEncoder().encode("bounded clean fixture");
    let observed: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const port = await clamServer("stream: OK", (value) => { observed = value; });
    await expect(new ClamAvInstreamScanner({ host: "127.0.0.1", port }).scan(bytes)).resolves.toEqual({ status: "clean", engine: "clamd" });
    expect(Array.from(observed)).toEqual(Array.from(bytes));
  });

  it("maps a ClamAV signature verdict to infected and stores no source object", async () => {
    const { store } = await fixture();
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    const port = await clamServer("stream: Eicar-Signature FOUND");
    const processor = new MediaProcessor({ objectStore: store, malwareScanner: new ClamAvInstreamScanner({ host: "127.0.0.1", port }) });
    await expect(processor.process({ fileName: "infected.png", declaredMimeType: "image/png", bytes })).rejects.toBeInstanceOf(MediaValidationError);
    await expect(store.read(`originals/${createHash("sha256").update(bytes).digest("hex")}/source`)).rejects.toBeTruthy();
  });

  it("fails closed on an unrecognized ClamAV response", async () => {
    const port = await clamServer("stream: scanner unavailable ERROR");
    await expect(new ClamAvInstreamScanner({ host: "127.0.0.1", port }).scan(new Uint8Array([1, 2, 3]))).resolves.toEqual({ status: "failed", engine: "clamd", detail: "stream: scanner unavailable ERROR" });
  });

  it("stores an immutable original and deterministic image derivatives", async () => {
    const { store } = await fixture();
    const bytes = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#2463eb" } }).png().toBuffer();
    const processor = new MediaProcessor({ objectStore: store });
    const first = await processor.process({ fileName: "Launch Hero.png", declaredMimeType: "image/png", bytes });
    const second = await processor.process({ fileName: "Launch Hero.png", declaredMimeType: "image/png", bytes });
    expect(first).toHaveLength(4);
    expect(second.map((asset) => asset.objectKey)).toEqual(first.map((asset) => asset.objectKey));
    expect(first[0]).toMatchObject({ role: "original", mediaStatus: "processed", altTextStatus: "needs_review" });
    expect(first.slice(1).map((asset) => asset.metadata.width)).toEqual([320, 640, 1080]);
    expect((await store.read(first[1].objectKey)).byteLength).toBeGreaterThan(0);
  });

  it("rejects a declared MIME type that disagrees with the binary signature", async () => {
    const { store } = await fixture();
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    await expect(new MediaProcessor({ objectStore: store }).process({ fileName: "bad.jpg", declaredMimeType: "image/jpeg", bytes }))
      .rejects.toBeInstanceOf(MediaValidationError);
  });

  it("extracts bounded text while keeping the source object immutable", async () => {
    const { store } = await fixture();
    const assets = await new MediaProcessor({ objectStore: store }).process({
      fileName: "notes.txt", declaredMimeType: "text/plain", bytes: new TextEncoder().encode("Approved notes"),
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ extractedText: "Approved notes", extractionStatus: "completed", mediaStatus: "processed" });
  });

  it("bounds plain-text extraction and records truncation", async () => {
    const { store } = await fixture();
    const [asset] = await new MediaProcessor({ objectStore: store, documentExtractionLimits: { maxTextCharacters: 8 } }).process({
      fileName: "notes.txt", declaredMimeType: "text/plain", bytes: new TextEncoder().encode("Approved launch notes"),
    });
    expect(asset.extractedText).toBe("Approved");
    expect(asset.metadata).toMatchObject({ textExtraction: { state: "truncated", maxTextCharacters: 8 } });
  });

  it("extracts text and page metadata from a real PDF", async () => {
    const { store } = await fixture();
    const [asset] = await new MediaProcessor({ objectStore: store }).process({
      fileName: "brief.pdf", declaredMimeType: "application/pdf", bytes: await pdfFixture("Market Me launch brief"),
    });
    expect(asset).toMatchObject({
      mediaStatus: "processed",
      extractionStatus: "completed",
      extractedText: "Market Me launch brief",
      processingVersion: "document-v1",
      metadata: { documentExtraction: { state: "completed", pageCount: 1, extractedPageCount: 1 } },
    });
  });

  it("marks image-only PDFs for OCR review without discarding the original", async () => {
    const { store } = await fixture();
    const [asset] = await new MediaProcessor({ objectStore: store }).process({
      fileName: "scan.pdf", declaredMimeType: "application/pdf", bytes: await pdfFixture(),
    });
    expect(asset).toMatchObject({
      mediaStatus: "processed",
      extractionStatus: "failed",
      metadata: { documentExtraction: { state: "requires_ocr" } },
    });
    expect(await store.read(asset.objectKey)).toBeInstanceOf(Uint8Array);
  });

  it("stops PDF extraction at the page limit and reports truncation", async () => {
    const result = await extractDocument({
      mimeType: "application/pdf",
      bytes: await pdfFixture("Page", 2),
      limits: { maxPages: 1 },
    });
    expect(result).toMatchObject({
      state: "truncated",
      text: "Page 1",
      metadata: { pageCount: 2, extractedPageCount: 1, maxPages: 1 },
    });
  });

  it("returns a stable malformed code for invalid PDF bytes", async () => {
    await expect(extractDocument({
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-not-a-document"),
    })).rejects.toMatchObject({ code: "malformed" });
  });

  it.each([
    {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "brief.docx",
      expected: "Word launch details",
      parts: {
        "[Content_Types].xml": contentTypes("docx"),
        "word/document.xml": `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Word launch details</w:t></w:r></w:p></w:body></w:document>`,
      },
      kind: "docx",
    },
    {
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      fileName: "brief.pptx",
      expected: "Presentation launch details",
      parts: {
        "[Content_Types].xml": contentTypes("pptx"),
        "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Presentation launch details</a:t></a:r></a:p></p:sld>`,
      },
      kind: "pptx",
    },
    {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: "brief.xlsx",
      expected: "Spreadsheet launch details\t42\tTRUE",
      parts: {
        "[Content_Types].xml": contentTypes("xlsx"),
        "xl/sharedStrings.xml": `<sst><si><t>Spreadsheet launch details</t></si></sst>`,
        "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c><c t="b"><v>1</v></c></row></sheetData></worksheet>`,
      },
      kind: "xlsx",
    },
  ])("extracts bounded text from real $kind OOXML fixtures", async ({ mimeType, fileName, expected, parts, kind }) => {
    const { store } = await fixture();
    const [asset] = await new MediaProcessor({ objectStore: store }).process({
      fileName, declaredMimeType: mimeType, bytes: officeFixture(parts),
    });
    expect(asset).toMatchObject({
      mediaStatus: "processed",
      extractionStatus: "completed",
      extractedText: expected,
      metadata: { documentExtraction: { state: "completed" } },
    });
  });

  it("rejects OOXML zip bombs before inflating selected parts", async () => {
    const bytes = officeFixture({
      "[Content_Types].xml": contentTypes("docx"),
      "word/document.xml": `<w:document><w:body><w:p><w:t>${"A".repeat(50_000)}</w:t></w:p></w:body></w:document>`,
    });
    await expect(extractDocument({
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
      limits: { maxCompressionRatio: 5 },
    })).rejects.toMatchObject({ code: "resource_limit" });
  });

  it("records malformed OOXML as an explicit failed parser state", async () => {
    const { store } = await fixture();
    const [asset] = await new MediaProcessor({ objectStore: store }).process({
      fileName: "broken.docx",
      declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: officeFixture({ "[Content_Types].xml": contentTypes("docx") }),
    });
    expect(asset).toMatchObject({
      mediaStatus: "failed",
      extractionStatus: "failed",
      metadata: { documentExtraction: { state: "failed", errorCode: "malformed" } },
    });
  });

  it("rejects an OOXML package whose internal type disagrees with the declaration", async () => {
    await expect(extractDocument({
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: officeFixture({
        "[Content_Types].xml": contentTypes("pptx"),
        "word/document.xml": "<w:document/>",
      }),
    })).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("signed asset access", () => {
  it("accepts only an unexpired, bounded signature for the exact asset", () => {
    const key = "0123456789abcdef0123456789abcdef";
    const signature = createAssetAccessSignature(key, "asset-1", 1_100);
    expect(verifyAssetAccessSignature({ signingKey: key, assetId: "asset-1", expiresEpochSeconds: 1_100, signature, nowEpochSeconds: 1_000 })).toBe(true);
    expect(verifyAssetAccessSignature({ signingKey: key, assetId: "asset-2", expiresEpochSeconds: 1_100, signature, nowEpochSeconds: 1_000 })).toBe(false);
    expect(verifyAssetAccessSignature({ signingKey: key, assetId: "asset-1", expiresEpochSeconds: 1_100, signature, nowEpochSeconds: 1_101 })).toBe(false);
  });
});

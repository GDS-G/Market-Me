import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const DEFAULT_MAX_READ_BYTES = 50 * 1024 * 1024;
const OBJECT_KEY_PATTERN = /^(originals|derivatives)\/[a-f0-9]{64}\/[a-zA-Z0-9._/-]+$/u;

export interface ObjectStore {
  putImmutable(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
}

export interface S3CommandClient {
  send(command: PutObjectCommand | GetObjectCommand): Promise<Record<string, unknown>>;
}

export interface S3ObjectStoreOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  maxReadBytes?: number;
  client?: S3CommandClient;
}

export type ObjectStoreConfiguration =
  | { kind: "filesystem"; root: string }
  | Omit<S3ObjectStoreOptions, "client"> & { kind: "s3" };

export function validateObjectKey(key: string): string {
  if (!OBJECT_KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Invalid media object key");
  }
  return key;
}

function safeObjectPath(root: string, key: string): string {
  validateObjectKey(key);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...key.split("/"));
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Media object escaped storage root");
  return target;
}

export class FileSystemObjectStore implements ObjectStore {
  constructor(readonly root: string) {
    if (!root.trim()) throw new Error("MEDIA_STORAGE_ROOT is required for filesystem storage");
  }

  async putImmutable(key: string, bytes: Uint8Array): Promise<void> {
    const target = safeObjectPath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const handle = await open(target, "wx");
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await readFile(target);
      if (sha256(existing, "hex") !== sha256(bytes, "hex")) throw new Error("Immutable object key collision");
    }
  }

  async read(key: string): Promise<Uint8Array> {
    return readFile(safeObjectPath(this.root, key));
  }
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3CommandClient;
  private readonly prefix: string;
  private readonly maxReadBytes: number;

  constructor(private readonly options: S3ObjectStoreOptions) {
    validateS3Options(options);
    this.prefix = normalizePrefix(options.prefix);
    this.maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
    if (options.client) {
      this.client = options.client;
      return;
    }
    const clientConfig: S3ClientConfig = {
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      maxAttempts: 2,
    };
    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
      };
    }
    this.client = new S3Client(clientConfig) as S3CommandClient;
  }

  async putImmutable(key: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > this.maxReadBytes) throw new Error("Media object exceeds configured object limit");
    const objectKey = this.objectKey(key);
    const checksumHex = sha256(bytes, "hex");
    const command = () => new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ChecksumSHA256: sha256(bytes, "base64"),
      IfNoneMatch: "*",
      Metadata: { "market-me-sha256": checksumHex },
    });
    try {
      await this.client.send(command());
      return;
    } catch (error) {
      const status = httpStatus(error);
      if (status === 409) {
        try {
          await this.verifyExistingObject(objectKey, checksumHex, bytes.byteLength);
          return;
        } catch (readError) {
          if (!isNotFound(readError)) throw readError;
          try {
            await this.client.send(command());
            return;
          } catch (retryError) {
            if (httpStatus(retryError) !== 412) throw retryError;
          }
          await this.verifyExistingObject(objectKey, checksumHex, bytes.byteLength);
          return;
        }
      }
      if (status !== 412) throw error;
    }
    await this.verifyExistingObject(objectKey, checksumHex, bytes.byteLength);
  }

  async read(key: string): Promise<Uint8Array> {
    return this.readObject(this.objectKey(key), this.maxReadBytes);
  }

  private objectKey(key: string): string {
    return `${this.prefix}${validateObjectKey(key)}`;
  }

  private async verifyExistingObject(objectKey: string, checksumHex: string, byteLength: number): Promise<void> {
    const existing = await this.readObject(objectKey, this.maxReadBytes);
    if (existing.byteLength !== byteLength || sha256(existing, "hex") !== checksumHex) {
      throw new Error("Immutable object key collision");
    }
  }

  private async readObject(objectKey: string, limit: number): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      ChecksumMode: "ENABLED",
    }));
    const contentLength = numberValue(response.ContentLength);
    if (contentLength !== undefined && contentLength > limit) throw new Error("Media object exceeds configured read limit");
    const bytes = await boundedBody(response.Body, limit);
    const checksum = typeof response.ChecksumSHA256 === "string" ? response.ChecksumSHA256 : undefined;
    const metadata = isRecord(response.Metadata) ? response.Metadata : undefined;
    const metadataChecksum = typeof metadata?.["market-me-sha256"] === "string"
      ? metadata["market-me-sha256"]
      : undefined;
    if (checksum && checksum !== sha256(bytes, "base64")) throw new Error("Media object checksum verification failed");
    if (metadataChecksum && metadataChecksum !== sha256(bytes, "hex")) throw new Error("Media object checksum verification failed");
    return bytes;
  }
}

export function objectStoreConfigurationFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ObjectStoreConfiguration {
  const kind = (environment.MEDIA_OBJECT_STORE ?? "filesystem").trim().toLowerCase();
  if (kind === "filesystem") {
    if (environment.NODE_ENV === "production") {
      throw new Error("Production requires MEDIA_OBJECT_STORE=s3");
    }
    return { kind, root: environment.MEDIA_STORAGE_ROOT ?? "../../.market-me/media" };
  }
  if (kind !== "s3") throw new Error("MEDIA_OBJECT_STORE must be filesystem or s3");
  const bucket = required(environment.MEDIA_S3_BUCKET, "MEDIA_S3_BUCKET");
  const region = required(environment.MEDIA_S3_REGION, "MEDIA_S3_REGION");
  const endpoint = environment.MEDIA_S3_ENDPOINT?.trim() || undefined;
  if (endpoint) validateEndpoint(endpoint, environment.NODE_ENV === "production");
  const accessKeyId = environment.MEDIA_S3_ACCESS_KEY_ID?.trim() || undefined;
  const secretAccessKey = environment.MEDIA_S3_SECRET_ACCESS_KEY?.trim() || undefined;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY must be configured together");
  }
  if (environment.MEDIA_S3_SESSION_TOKEN?.trim() && !accessKeyId) {
    throw new Error("MEDIA_S3_SESSION_TOKEN requires configured S3 access credentials");
  }
  const maxReadBytes = integerInRange(
    environment.MEDIA_OBJECT_MAX_READ_BYTES ?? String(DEFAULT_MAX_READ_BYTES),
    1024,
    DEFAULT_MAX_READ_BYTES,
    "MEDIA_OBJECT_MAX_READ_BYTES",
  );
  return {
    kind,
    bucket,
    region,
    endpoint,
    forcePathStyle: booleanValue(environment.MEDIA_S3_FORCE_PATH_STYLE),
    prefix: environment.MEDIA_S3_PREFIX,
    accessKeyId,
    secretAccessKey,
    sessionToken: environment.MEDIA_S3_SESSION_TOKEN?.trim() || undefined,
    maxReadBytes,
  };
}

export function createObjectStoreFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ObjectStore {
  const configuration = objectStoreConfigurationFromEnvironment(environment);
  return configuration.kind === "filesystem"
    ? new FileSystemObjectStore(configuration.root)
    : new S3ObjectStore(configuration);
}

function validateS3Options(options: S3ObjectStoreOptions): void {
  if (!options.bucket.trim() || options.bucket.length > 255 || /[\u0000-\u001f\u007f]/u.test(options.bucket)) {
    throw new Error("S3 bucket is invalid");
  }
  if (!options.region.trim() || options.region.length > 100) throw new Error("S3 region is invalid");
  if (Boolean(options.accessKeyId) !== Boolean(options.secretAccessKey)) {
    throw new Error("S3 access key ID and secret access key must be configured together");
  }
  if (options.sessionToken && !options.accessKeyId) throw new Error("S3 session token requires configured access credentials");
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
  if (!Number.isInteger(maxReadBytes) || maxReadBytes < 1024 || maxReadBytes > DEFAULT_MAX_READ_BYTES) {
    throw new Error("S3 max read bytes must be an integer from 1024 through 52428800");
  }
}

function normalizePrefix(value: string | undefined): string {
  const prefix = value?.trim().replace(/^\/+|\/+$/gu, "") ?? "";
  if (!prefix) return "";
  if (prefix.length > 512 || !/^[a-zA-Z0-9._/-]+$/u.test(prefix) || prefix.includes("..") || prefix.includes("//")) {
    throw new Error("S3 object prefix is invalid");
  }
  return `${prefix}/`;
}

async function boundedBody(body: unknown, limit: number): Promise<Uint8Array> {
  if (!body) throw new Error("Media object response did not contain a body");
  if (body instanceof Uint8Array) {
    if (body.byteLength > limit) throw new Error("Media object exceeds configured read limit");
    return body;
  }
  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const value of body) {
      const chunk = value instanceof Uint8Array ? value : Buffer.from(value as ArrayBuffer);
      length += chunk.byteLength;
      if (length > limit) throw new Error("Media object exceeds configured read limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  }
  if (isRecord(body) && typeof body.transformToByteArray === "function") {
    const bytes = await (body.transformToByteArray as () => Promise<Uint8Array>)();
    if (bytes.byteLength > limit) throw new Error("Media object exceeds configured read limit");
    return bytes;
  }
  throw new Error("Media object response body is unsupported");
}

function sha256(value: Uint8Array, encoding: "hex" | "base64"): string {
  return createHash("sha256").update(value).digest(encoding);
}

function httpStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.$metadata)) return undefined;
  return numberValue(error.$metadata.httpStatusCode);
}

function isNotFound(error: unknown): boolean {
  return httpStatus(error) === 404 || (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return isRecord(value) && Symbol.asyncIterator in value;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for S3 storage`);
  return normalized;
}

function booleanValue(value: string | undefined): boolean {
  if (!value) return false;
  if (!["true", "false"].includes(value.trim().toLowerCase())) throw new Error("Boolean media storage values must be true or false");
  return value.trim().toLowerCase() === "true";
}

function integerInRange(value: string, minimum: number, maximum: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function validateEndpoint(value: string, production: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MEDIA_S3_ENDPOINT must be an absolute URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("MEDIA_S3_ENDPOINT must not contain credentials, query, or fragment");
  }
  if (production && url.protocol !== "https:") throw new Error("Production MEDIA_S3_ENDPOINT must use HTTPS");
  if (!production && !["http:", "https:"].includes(url.protocol)) throw new Error("MEDIA_S3_ENDPOINT must use HTTP or HTTPS");
}

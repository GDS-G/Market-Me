import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  objectStoreConfigurationFromEnvironment,
  S3ObjectStore,
  type S3CommandClient,
} from "./object-store";

const KEY = `originals/${"a".repeat(64)}/source`;
const BYTES = Buffer.from("immutable media", "utf8");

function checksum(value: Uint8Array, encoding: "hex" | "base64"): string {
  return createHash("sha256").update(value).digest(encoding);
}

function httpError(status: number, name = "S3Error"): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

function store(send: S3CommandClient["send"]): S3ObjectStore {
  return new S3ObjectStore({
    bucket: "market-me-test",
    region: "us-east-1",
    prefix: "tenant-media",
    maxReadBytes: 1024,
    client: { send },
  });
}

describe("object store configuration", () => {
  it("allows filesystem storage for development but fails closed in production", () => {
    expect(objectStoreConfigurationFromEnvironment({ NODE_ENV: "development" })).toEqual({
      kind: "filesystem",
      root: "../../.market-me/media",
    });
    expect(() => objectStoreConfigurationFromEnvironment({ NODE_ENV: "production" }))
      .toThrow("Production requires MEDIA_OBJECT_STORE=s3");
  });

  it("parses explicit S3 configuration without placing credentials in the endpoint", () => {
    expect(objectStoreConfigurationFromEnvironment({
      NODE_ENV: "production",
      MEDIA_OBJECT_STORE: "s3",
      MEDIA_S3_BUCKET: "market-me-production",
      MEDIA_S3_REGION: "us-central-1",
      MEDIA_S3_ENDPOINT: "https://objects.example.test",
      MEDIA_S3_FORCE_PATH_STYLE: "true",
      MEDIA_S3_PREFIX: "production/media",
      MEDIA_S3_ACCESS_KEY_ID: "access",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
      MEDIA_S3_SESSION_TOKEN: "session",
      MEDIA_OBJECT_MAX_READ_BYTES: "1048576",
    })).toMatchObject({
      kind: "s3",
      bucket: "market-me-production",
      region: "us-central-1",
      endpoint: "https://objects.example.test",
      forcePathStyle: true,
      prefix: "production/media",
      maxReadBytes: 1048576,
    });
    expect(() => objectStoreConfigurationFromEnvironment({
      NODE_ENV: "production",
      MEDIA_OBJECT_STORE: "s3",
      MEDIA_S3_BUCKET: "bucket",
      MEDIA_S3_REGION: "region",
      MEDIA_S3_ENDPOINT: "http://objects.example.test",
    })).toThrow("must use HTTPS");
    expect(() => objectStoreConfigurationFromEnvironment({
      MEDIA_OBJECT_STORE: "s3",
      MEDIA_S3_BUCKET: "bucket",
      MEDIA_S3_REGION: "region",
      MEDIA_S3_SESSION_TOKEN: "orphaned",
    })).toThrow("requires configured S3 access credentials");
  });
});

describe("S3ObjectStore", () => {
  it("creates objects with an atomic conditional write and two checksums", async () => {
    const send = vi.fn<S3CommandClient["send"]>().mockResolvedValue({});
    await store(send).putImmutable(KEY, BYTES);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "market-me-test",
      Key: `tenant-media/${KEY}`,
      IfNoneMatch: "*",
      ContentLength: BYTES.byteLength,
      ChecksumSHA256: checksum(BYTES, "base64"),
      Metadata: { "market-me-sha256": checksum(BYTES, "hex") },
    });
  });

  it("treats a precondition failure as success only when existing bytes match", async () => {
    const matching = vi.fn<S3CommandClient["send"]>()
      .mockRejectedValueOnce(httpError(412))
      .mockResolvedValueOnce({
        ContentLength: BYTES.byteLength,
        Body: BYTES,
        ChecksumSHA256: checksum(BYTES, "base64"),
      });
    await expect(store(matching).putImmutable(KEY, BYTES)).resolves.toBeUndefined();
    expect(matching.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);

    const different = Buffer.from("different bytes", "utf8");
    const collision = vi.fn<S3CommandClient["send"]>()
      .mockRejectedValueOnce(httpError(412))
      .mockResolvedValueOnce({ ContentLength: different.byteLength, Body: different });
    await expect(store(collision).putImmutable(KEY, BYTES)).rejects.toThrow("Immutable object key collision");
  });

  it("retries one conflict when the object is not yet visible", async () => {
    const send = vi.fn<S3CommandClient["send"]>()
      .mockRejectedValueOnce(httpError(409))
      .mockRejectedValueOnce(httpError(404, "NoSuchKey"))
      .mockResolvedValueOnce({});
    await expect(store(send).putImmutable(KEY, BYTES)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(PutObjectCommand);
  });

  it("bounds streamed reads and verifies server checksums", async () => {
    async function* body() {
      yield BYTES.subarray(0, 5);
      yield BYTES.subarray(5);
    }
    const send = vi.fn<S3CommandClient["send"]>().mockResolvedValue({
      ContentLength: BYTES.byteLength,
      Body: body(),
      ChecksumSHA256: checksum(BYTES, "base64"),
      Metadata: { "market-me-sha256": checksum(BYTES, "hex") },
    });
    await expect(store(send).read(KEY)).resolves.toEqual(BYTES);

    const corrupted = vi.fn<S3CommandClient["send"]>().mockResolvedValue({
      ContentLength: BYTES.byteLength,
      Body: BYTES,
      ChecksumSHA256: checksum(Buffer.from("other"), "base64"),
    });
    await expect(store(corrupted).read(KEY)).rejects.toThrow("checksum verification failed");

    const oversized = vi.fn<S3CommandClient["send"]>().mockResolvedValue({ ContentLength: 1025, Body: BYTES });
    await expect(store(oversized).read(KEY)).rejects.toThrow("exceeds configured read limit");
  });
});

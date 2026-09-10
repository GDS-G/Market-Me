import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createObjectStoreFromEnvironment } from "@market-me/media";

async function main(): Promise<void> {
  const endpoint = process.env.MEDIA_S3_ENDPOINT ?? "http://127.0.0.1:3102";
  const environment = {
    NODE_ENV: "development",
    MEDIA_OBJECT_STORE: "s3",
    MEDIA_S3_BUCKET: "market-me-qa",
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_ENDPOINT: endpoint,
    MEDIA_S3_FORCE_PATH_STYLE: "true",
    MEDIA_S3_PREFIX: "release-1-1",
    MEDIA_S3_ACCESS_KEY_ID: "qa-access-key",
    MEDIA_S3_SECRET_ACCESS_KEY: "qa-secret-key",
    MEDIA_OBJECT_MAX_READ_BYTES: String(1024 * 1024),
  } as const;
  const store = createObjectStoreFromEnvironment(environment);
  const original = Buffer.from("Market Me immutable S3 acceptance object", "utf8");
  const digest = createHash("sha256").update(original).digest("hex");
  const key = `originals/${digest}/source`;

  await store.putImmutable(key, original);
  await store.putImmutable(key, original);
  assert.deepEqual(await store.read(key), original);
  await assert.rejects(
    store.putImmutable(key, Buffer.from("different bytes", "utf8")),
    /Immutable object key collision/u,
  );

  console.log(JSON.stringify({
    event: "qa.s3.accepted",
    endpoint,
    bucket: environment.MEDIA_S3_BUCKET,
    key: `${environment.MEDIA_S3_PREFIX}/${key}`,
    byteLength: original.byteLength,
    checksumSha256: digest,
    checks: ["conditional-create", "idempotent-replay", "checksum-read", "collision-rejection"],
  }));
}

void main();

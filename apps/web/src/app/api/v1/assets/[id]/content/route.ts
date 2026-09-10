import { verifyAssetAccessSignature } from "@market-me/media";
import { getServerConfiguration } from "@/server/config";
import { getRepository } from "@/server/database";
import { getMediaObjectStore } from "@/server/media";

const INLINE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  const signingKey = getServerConfiguration().mediaAccessSigningKey;
  if (!signingKey || !verifyAssetAccessSignature({ signingKey, assetId: id, expiresEpochSeconds: expires, signature })) {
    return Response.json({ error: { code: "invalid_asset_access", message: "This asset link is invalid or expired." } }, { status: 403 });
  }
  const asset = await getRepository().getContentAssetForAccess(id);
  if (!asset) return Response.json({ error: { code: "not_found", message: "Asset not found." } }, { status: 404 });
  try {
    const bytes = await getMediaObjectStore().read(asset.objectKey);
    const inline = INLINE_MEDIA_TYPES.has(asset.mimeType);
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        "content-type": inline ? asset.mimeType : "application/octet-stream",
        "content-length": String(bytes.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "cache-control": "private, max-age=300, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return Response.json({ error: { code: "object_missing", message: "The asset object is unavailable." } }, { status: 404 });
    }
    throw error;
  }
}

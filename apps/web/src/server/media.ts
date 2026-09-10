import "server-only";
import { createAssetAccessSignature, createObjectStoreFromEnvironment, type ObjectStore } from "@market-me/media";
import { getServerConfiguration } from "./config";

const mediaGlobal = globalThis as typeof globalThis & { marketMeMediaStore?: ObjectStore };

export function getMediaObjectStore(): ObjectStore {
  if (mediaGlobal.marketMeMediaStore) return mediaGlobal.marketMeMediaStore;
  const store = createObjectStoreFromEnvironment();
  if (process.env.NODE_ENV !== "production") mediaGlobal.marketMeMediaStore = store;
  return store;
}

export function createAssetPreviewUrl(assetId: string, now = new Date()): string | undefined {
  const signingKey = getServerConfiguration().mediaAccessSigningKey;
  if (!signingKey) return undefined;
  const expires = Math.floor(now.getTime() / 1000) + 300;
  const signature = createAssetAccessSignature(signingKey, assetId, expires);
  return `/api/v1/assets/${assetId}/content?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

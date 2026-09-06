import * as fs from 'node:fs';

interface StaticAssetCacheEntry {
  signature: string;
  content: Buffer;
}

const STATIC_ASSET_CACHE = new Map<string, StaticAssetCacheEntry>();

function readCachedStaticAsset(filePath: string): Buffer {
  const stat = fs.statSync(filePath);
  const signature = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  const cached = STATIC_ASSET_CACHE.get(filePath);
  if (cached?.signature === signature) return cached.content;
  const content = fs.readFileSync(filePath);
  STATIC_ASSET_CACHE.set(filePath, { signature, content });
  if (STATIC_ASSET_CACHE.size > 128) {
    const oldest = STATIC_ASSET_CACHE.keys().next().value;
    if (oldest !== undefined) STATIC_ASSET_CACHE.delete(oldest);
  }
  return content;
}

export { readCachedStaticAsset };

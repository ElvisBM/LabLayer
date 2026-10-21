// Opaque references remain usable across hostname changes; access always requires tenant auth.
export const assetId = (reference: string) => /^asset:([a-f0-9]{64})$/.exec(reference)?.[1] ?? null;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export function albumImageUrl(asset: string | undefined, base: string): string | null {
  if (!asset) return null;
  try {
    const origin = new URL(base);
    const url = new URL(asset, origin);
    return ["http:", "https:"].includes(url.protocol) && url.origin === origin.origin ? url.href : null;
  } catch { return null; }
}

export function containedImageSize(width: number, height: number, frameWidth: number, frameHeight: number): [number, number] {
  if (![width, height, frameWidth, frameHeight].every((value) => Number.isFinite(value) && value > 0)) return [frameWidth, frameHeight];
  const scale = Math.min(frameWidth / width, frameHeight / height);
  return [width * scale, height * scale];
}

export function albumTextureSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

import { useEffect, useState } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { albumImageUrl, albumTextureSize } from "../data/albumImage.js";

export function useAlbumTexture(asset: string | undefined): CanvasTexture | null {
  const [loaded, setLoaded] = useState<{ asset: string; texture: CanvasTexture } | null>(null);
  useEffect(() => {
    const url = albumImageUrl(asset, document.baseURI);
    if (!url || !asset) return;
    const image = new Image();
    let texture: CanvasTexture | null = null;
    let cancelled = false;
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = albumTextureSize(image.naturalWidth, image.naturalHeight);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      setLoaded({ asset, texture });
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    };
    image.onerror = () => { if (!cancelled) setLoaded(null); };
    image.src = url;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      texture?.dispose();
    };
  }, [asset]);
  return loaded && loaded.asset === asset ? loaded.texture : null;
}

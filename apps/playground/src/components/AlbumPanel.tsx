import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { albumScrollOffset, type AlbumPanelPicture } from "../data/albumEntries";
import { albumImageUrl } from "../data/albumImage";
export type { AlbumPanelPicture } from "../data/albumEntries";

/** One album entry for the side panel: a placed picture knows its
 * neighboring scenes; an unplaced picture (anchor sentence in no scene
 * yet) is still listed in the album, just not drawn on the orbit. */
interface Props {
  pictures: AlbumPanelPicture[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Canvas face mirroring the 3D picture card (same gradient, gold frame,
 * kind + id). Used until a real image asset is served for the picture. */
function PictureFace({ label, shortId, small }: { label: string; shortId: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 512, 384);
    gradient.addColorStop(0, "#1d3a52");
    gradient.addColorStop(0.55, "#0f2236");
    gradient.addColorStop(1, "#1a2f45");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 384);
    context.strokeStyle = "#ffd166";
    context.lineWidth = 6;
    context.strokeRect(14, 14, 484, 356);
    context.strokeStyle = "#ffd16655";
    context.lineWidth = 2;
    context.strokeRect(34, 34, 444, 200);
    context.fillStyle = "#ffd166";
    context.font = "700 44px sans-serif";
    context.textAlign = "center";
    context.fillText(label.toUpperCase(), 256, 300);
    context.fillStyle = "#d8ecff";
    context.font = "400 30px sans-serif";
    context.fillText(shortId, 256, 344);
  }, [label, shortId]);
  return (
    <canvas
      ref={ref}
      width={512}
      height={384}
      style={{ width: "100%", display: "block", border: small ? "1px solid #ffd166" : "2px solid #ffd166" }}
      aria-label={`${label} ${shortId}`}
    />
  );
}

/** The picture itself: the served image when its asset resolves, else the
 * canvas face matching the 3D card. The image stays hidden until it loads,
 * so an unserved asset never flashes a broken icon. */
function PictureArt({ picture, small }: { picture: AlbumPanelPicture; small?: boolean }) {
  const [loadedAsset, setLoadedAsset] = useState<string | null>(null);
  const asset = albumImageUrl(picture.asset, window.location.href);
  const loaded = loadedAsset === asset && asset !== null;
  return (
    <div className="glass-frame" style={{ aspectRatio: "4 / 3", position: "relative" }}>
      {asset && (
        <img
          key={asset}
          src={asset}
          alt={`${picture.label} ${picture.id}`}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedAsset(asset)}
          onError={() => setLoadedAsset(null)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: loaded ? "block" : "none", border: small ? "1px solid #ffd166" : "2px solid #ffd166" }}
        />
      )}
      {!loaded && <PictureFace label={picture.label} shortId={picture.id} small={small} />}
    </div>
  );
}

function placementText(picture: AlbumPanelPicture): string {
  if (!picture.placed) return "Not yet on the orbit — its anchor sentence is in no scene yet.";
  if (picture.nextSceneLabel) return `Between ${picture.prevSceneLabel ?? "the previous scene"} and ${picture.nextSceneLabel}.`;
  return `After ${picture.prevSceneLabel ?? "the last scene"}.`;
}

export function AlbumPanel({ pictures, selectedId, onSelect }: Props) {
  const [localId, setLocalId] = useState<string | null>(selectedId);
  const selectedEntry = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selectedId) setLocalId(selectedId);
  }, [selectedId]);
  const ordered = [...pictures].sort((first, second) => Number(second.placed) - Number(first.placed) || (first.chrono ?? 0) - (second.chrono ?? 0));
  const selected = pictures.find((picture) => picture.id === localId) ?? ordered[0];
  useLayoutEffect(() => {
    const entry = selectedEntry.current;
    const container = entry?.closest<HTMLElement>(".inspector-body");
    if (!entry || !container) return;
    const itemTop = entry.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = albumScrollOffset(container.scrollTop, container.clientHeight, itemTop, entry.offsetHeight);
  }, [selected?.id]);
  if (!selected) return <p className="empty-state">No pictures in this album yet.</p>;
  const choose = (picture: AlbumPanelPicture) => {
    setLocalId(picture.id);
    if (picture.placed) onSelect(picture.id);
  };
  return (
    <div className="album-panel">
      <div className="panel-intro">
        <span className="eyebrow">ALBUM</span>
        <h2>Illustrations</h2>
        <p>Earlier → later. Select a picture to find it on the timeline.</p>
      </div>
      {ordered.map(picture => <section key={picture.id} ref={picture.id === selected.id ? selectedEntry : undefined} className={`album-entry${picture.id === selected.id ? " is-selected" : ""}`} data-album-id={picture.id} aria-label={`${picture.label} ${picture.id}`}>
        <button onClick={() => choose(picture)} aria-pressed={picture.id === selected.id} className="album-image-button">
          <span>{picture.label} · {picture.id}</span>
          <PictureArt picture={picture} />
        </button>
        <p>{placementText(picture)}</p>
      </section>)}
    </div>
  );
}

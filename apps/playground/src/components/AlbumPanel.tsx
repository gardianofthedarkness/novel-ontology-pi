import { useEffect, useRef, useState } from "react";

/** One album entry for the side panel: a placed picture knows its
 * neighboring scenes; an unplaced picture (anchor sentence in no scene
 * yet) is still listed in the album, just not drawn on the orbit. */
export interface AlbumPanelPicture {
  id: string;
  asset: string;
  kind: string;
  label: string;
  placed: boolean;
  prevSceneLabel: string | null;
  nextSceneLabel: string | null;
  chrono: number | null;
}

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
  const [loaded, setLoaded] = useState(false);
  const servable = picture.asset.includes("/") || picture.asset.startsWith("http");
  return (
    <div style={{ position: "relative" }}>
      {servable && (
        <img
          src={picture.asset}
          alt={`${picture.label} ${picture.id}`}
          onLoad={() => setLoaded(true)}
          style={{ width: "100%", display: loaded ? "block" : "none", border: small ? "1px solid #ffd166" : "2px solid #ffd166" }}
        />
      )}
      {(!servable || !loaded) && <PictureFace label={picture.label} shortId={picture.id} small={small} />}
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
  useEffect(() => {
    if (selectedId && pictures.some((picture) => picture.id === selectedId)) setLocalId(selectedId);
  }, [selectedId, pictures]);
  if (!pictures.length) return <p className="empty-state">No pictures in this album yet.</p>;
  const placed = pictures.filter((picture) => picture.placed);
  const unplaced = pictures.filter((picture) => !picture.placed);
  const selected = pictures.find((picture) => picture.id === localId) ?? placed[0] ?? pictures[0];
  const choose = (picture: AlbumPanelPicture) => {
    setLocalId(picture.id);
    if (picture.placed) onSelect(picture.id);
  };
  return (
    <div className="album-panel">
      <div className="panel-intro">
        <span className="eyebrow">ALBUM</span>
        <h2>{selected.label}</h2>
        <p>{placementText(selected)}</p>
      </div>
      <PictureArt picture={selected} />
      <dl className="record-facts">
        <div><dt>Picture ID</dt><dd>{selected.id}</dd></div>
        <div><dt>Asset</dt><dd>{selected.asset}</dd></div>
        <div><dt>Kind</dt><dd>{selected.kind}</dd></div>
        {selected.chrono !== null && <div><dt>Sequence</dt><dd>{selected.chrono}</dd></div>}
      </dl>
      {!!placed.length && (
        <section aria-label="Pictures on the timeline">
          <h3>On the timeline · earlier → later</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {placed.map((picture) => (
              <button
                key={picture.id}
                onClick={() => choose(picture)}
                aria-pressed={picture.id === selected.id}
                style={{ padding: 0, background: "none", border: picture.id === selected.id ? "2px solid #ffd166" : "1px solid transparent", cursor: "pointer", textAlign: "left" }}
              >
                <PictureArt picture={picture} small />
                <small style={{ display: "block", padding: "4px 2px" }}>{picture.label} · {picture.id}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {!!unplaced.length && (
        <section aria-label="Pictures not yet placed">
          <h3>Not yet on the orbit</h3>
          <p className="empty-state">These pictures are in the album but their anchor sentences belong to no scene yet, so they draw nowhere on the timeline.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {unplaced.map((picture) => (
              <button
                key={picture.id}
                onClick={() => choose(picture)}
                aria-pressed={picture.id === selected.id}
                style={{ padding: 0, background: "none", border: picture.id === selected.id ? "2px solid #ffd166" : "1px solid transparent", cursor: "pointer", textAlign: "left" }}
              >
                <PictureArt picture={picture} small />
                <small style={{ display: "block", padding: "4px 2px" }}>{picture.label} · {picture.id}</small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

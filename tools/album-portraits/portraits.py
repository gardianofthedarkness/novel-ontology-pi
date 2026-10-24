#!/usr/bin/env python3
"""Character portrait assignment for a novel workspace's album.

The production form of the Oct 2026 POC/benchmark pipeline
(RapidOCR + deepghs/imgutils head detection), with the benchmark
lessons folded in:

- names are matched against OCR captions in BOTH simplified and
  traditional space (OpenCC) — PP-OCR emits mixed scripts per
  character, which silently defeated whole-string matching in
  benchmark round 2 (断鋼神劍 matched neither script's form);
- assignment is one-to-one (a head can be claimed once) — round 1's
  only pairing errors were two names claiming the same head;
- a name keeps its FIRST portrait across illustrations.

Reads <novelDir>/ontology/illustrations.jsonl + assets/, takes names
from <novelDir>/ontology/entities.jsonl (kind=character) or a
--names-file, writes crops to <novelDir>/assets/portraits/ and
records to <novelDir>/ontology/portraits.jsonl.

Usage:
  portraits.py <novelDir> [--names-file names.txt] [--kinds plate,story]
                          [--min-conf 0.5]

Names file: one character per line, `Canonical Name` or
`Canonical Name | form1, form2`.
"""
import argparse, json, re, sys
from pathlib import Path

PUNCT = re.compile(r"[\s\-_.,'\"「」『』・:：/\\|、။]+")

def norm(s: str) -> str:
    return PUNCT.sub("", s).lower()

def load_names(novel_dir: Path, names_file: str | None):
    """Return [{entityId, name, forms[]}] — registry names first."""
    out = []
    if names_file:
        for line in Path(names_file).read_text(encoding="utf8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            forms = [parts[0]] + ([f.strip() for f in parts[1].split(",") if f.strip()] if len(parts) > 1 else [])
            out.append({"entityId": None, "name": parts[0], "forms": forms})
        return out
    entities_path = novel_dir / "ontology" / "entities.jsonl"
    if not entities_path.exists():
        raise SystemExit(f"no {entities_path} and no --names-file given")
    for line in entities_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if str(e.get("kind")).lower() != "character":
            continue
        forms = []
        for nf in e.get("names", []):
            if isinstance(nf, str):
                forms.append(nf)
            elif isinstance(nf, dict):
                t = nf.get("text") or nf.get("form") or nf.get("name")
                if t:
                    forms.append(t)
        if forms:
            out.append({"entityId": e.get("id"), "name": forms[0], "forms": forms})
    return out

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("novel_dir")
    ap.add_argument("--names-file")
    ap.add_argument("--kinds", default="", help="comma list; default = all non-cover illustrations")
    ap.add_argument("--min-conf", type=float, default=0.5)
    args = ap.parse_args()

    novel_dir = Path(args.novel_dir)
    ill_path = novel_dir / "ontology" / "illustrations.jsonl"
    if not ill_path.exists():
        raise SystemExit(f"no album in {novel_dir} — run `novel album import` first")
    illustrations = [json.loads(l) for l in ill_path.read_text(encoding="utf8").splitlines() if l.strip()]
    kinds = {k.strip() for k in args.kinds.split(",") if k.strip()}
    candidates = [i for i in illustrations if (i["kind"] in kinds if kinds else i["kind"] != "cover")]
    characters = load_names(novel_dir, args.names_file)
    if not characters:
        raise SystemExit("no character names to assign")

    from rapidocr_onnxruntime import RapidOCR
    from imgutils.detect import detect_heads
    from opencc import OpenCC
    from PIL import Image

    t2s, s2t = OpenCC("t2s"), OpenCC("s2t")
    def variants(form: str):
        base = norm(form)
        return {base, norm(t2s.convert(form)), norm(s2t.convert(form))} - {""}
    char_variants = [(c, {v for f in c["forms"] for v in variants(f) if len(v) >= 2}) for c in characters]

    ocr = RapidOCR()
    portraits_dir = novel_dir / "assets" / "portraits"
    portraits_dir.mkdir(parents=True, exist_ok=True)
    assigned: dict[str, dict] = {}
    records = []

    for ill in candidates:
        if len(assigned) == len(characters):
            break
        img_path = novel_dir / ill["asset"]
        img = Image.open(img_path).convert("RGB")
        W, H = img.size
        result, _ = ocr(str(img_path))
        lines = []
        if result:
            for box, text, conf in result:
                if float(conf) < args.min_conf:
                    continue
                cx = sum(p[0] for p in box) / 4
                cy = sum(p[1] for p in box) / 4
                lines.append({"text": text, "conf": float(conf), "cx": cx, "cy": cy,
                              "norms": {norm(text), norm(t2s.convert(text)), norm(s2t.convert(text))}})
        # Anchors in two passes. Pass 1: the name as a STANDALONE line —
        # a character's own caption column is headed by their name alone.
        # Pass 2 (substring) runs only for names still unassigned: a name
        # can appear inside ANOTHER character's caption ("dislikes
        # Mikoto" in Misaki's column), and anchoring there steals a
        # neighbouring head and cascades into a swap.
        def find_anchor(c, vset, exact: bool):
            hits = []
            for ln in lines:
                if exact:
                    ok = any(n in vset for n in ln["norms"])
                else:
                    ok = any(v in n for v in vset for n in ln["norms"])
                if ok:
                    hits.append(ln)
            if not hits:
                return None
            best = max(hits, key=lambda ln: ln["conf"])
            return {**best, "matchKind": "exact-line" if exact else "substring"}
        anchors = []
        for exact in (True, False):
            for c, vset in char_variants:
                if c["name"] in assigned or any(a[1]["name"] == c["name"] for a in anchors):
                    continue
                hit = find_anchor(c, vset, exact)
                if hit:
                    anchors.append((hit["conf"], c, hit))
        if not anchors:
            continue
        heads = []
        for box, _label, score in detect_heads(img):
            heads.append({"box": [round(v) for v in box], "score": float(score),
                          "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2})
        if not heads:
            continue
        claimed: set[int] = set()
        for _conf, c, ln in sorted(anchors, key=lambda a: -a[0]):
            best_i, best_d = None, None
            for i, h in enumerate(heads):
                if i in claimed:
                    continue
                d = ((h["cx"] - ln["cx"]) / W) ** 2 + ((h["cy"] - ln["cy"]) / H) ** 2
                if best_d is None or d < best_d:
                    best_i, best_d = i, d
            if best_i is None:
                continue
            claimed.add(best_i)
            h = heads[best_i]
            x0, y0, x1, y1 = h["box"]
            pw, ph = (x1 - x0) * 0.25, (y1 - y0) * 0.25
            crop_box = (max(0, int(x0 - pw)), max(0, int(y0 - ph)), min(W, int(x1 + pw)), min(H, int(y1 + ph)))
            slug = c["entityId"] or re.sub(r"[^\w]+", "_", c["name"])
            rel = f"assets/portraits/{slug}.png"
            img.crop(crop_box).save(novel_dir / rel)
            rec = {"entityId": c["entityId"], "name": c["name"], "portrait": rel,
                   "sourceIllustration": ill["id"], "sourceAsset": ill["asset"],
                   "ocrText": ln["text"], "ocrConfidence": round(ln["conf"], 3),
                   "matchKind": ln.get("matchKind", "substring"),
                   "headBox": h["box"], "headScore": round(h["score"], 3),
                   "imageSize": [W, H]}
            assigned[c["name"]] = rec
            records.append(rec)

    out_path = novel_dir / "ontology" / "portraits.jsonl"
    with out_path.open("w", encoding="utf8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    summary = {
        "novelDir": str(novel_dir),
        "characters": len(characters),
        "assigned": [{"name": r["name"], "portrait": r["portrait"], "from": r["sourceIllustration"],
                      "ocrConfidence": r["ocrConfidence"]} for r in records],
        "notFound": [c["name"] for c in characters if c["name"] not in assigned],
        "portraitsFile": "ontology/portraits.jsonl",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())

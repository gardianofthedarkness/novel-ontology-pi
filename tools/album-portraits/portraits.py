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
- exact, unambiguous caption matches only; existing assignments are preserved.

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
import argparse, hashlib, importlib.util, json, os, re, sys, tempfile
from pathlib import Path

PUNCT = re.compile(r"[\s\-_.,'\"「」『』・:：/\\|、။]+")

def norm(s: str) -> str:
    return PUNCT.sub("", s).lower()

def safe_path(novel_dir: Path, relative: str, folder: str) -> Path:
    root = novel_dir.resolve()
    base = root / folder
    target = root / relative
    if base.resolve() != base or not target.resolve().is_relative_to(base):
        raise ValueError(f"asset must stay inside {folder}")
    if target.is_symlink():
        raise ValueError("symlink assets are not supported")
    return target

def atomic_records(path: Path, records: list):
    if path.is_symlink():
        raise ValueError("metadata must not be a symlink")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            for record in records:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()

def unique_anchor(variant_sets: list, lines: list, index: int):
    hits = [line for line in lines if line["norms"] & variant_sets[index]]
    if not hits:
        return None
    best = max(hits, key=lambda line: line["conf"])
    owners = [candidate for candidate, variants in enumerate(variant_sets) if best["norms"] & variants]
    return {**best, "matchKind": "exact-line"} if owners == [index] else None

def nearest_head(heads: list, claimed: set, anchor: dict, width: int, height: int):
    ranked = sorted((((head["cx"] - anchor["cx"]) / width) ** 2 +
                     ((head["cy"] - anchor["cy"]) / height) ** 2, index)
                    for index, head in enumerate(heads))
    if not ranked or ranked[0][0] > 0.16 or ranked[0][1] in claimed:
        return None
    if len(ranked) > 1 and ranked[1][0] - ranked[0][0] < 0.01:
        return None
    return ranked[0][1]

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
    latest = {}
    for line in entities_path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        latest[e["id"]] = e
    for e in latest.values():
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
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--kinds", default="", help="comma list; default = all non-cover illustrations")
    ap.add_argument("--min-conf", type=float, default=0.8)
    args = ap.parse_args()

    modules = {"rapidocr_onnxruntime": "rapidocr-onnxruntime", "imgutils": "dghs-imgutils",
               "opencc": "opencc-python-reimplemented", "PIL": "pillow"}
    missing = [package for module, package in modules.items() if importlib.util.find_spec(module) is None]
    if args.check or missing:
        print(json.dumps({"ready": not missing, "missingPackages": missing,
                          "models": "OCR and anime-head weights must be cached or downloadable on first assignment"}))
        return 0 if args.check else 1
    if not 0.8 <= args.min_conf <= 1:
        raise ValueError("minimum OCR confidence must be between 0.8 and 1")
    novel_dir = Path(args.novel_dir).resolve()
    if (novel_dir / "ontology").resolve() != novel_dir / "ontology":
        raise ValueError("metadata directory must not be a symlink")
    ill_path = novel_dir / "ontology" / "illustrations.jsonl"
    if not ill_path.exists():
        raise SystemExit(f"no album in {novel_dir} — run `novel album import` first")
    illustrations = [json.loads(l) for l in ill_path.read_text(encoding="utf8").splitlines() if l.strip()]
    kinds = {k.strip() for k in args.kinds.split(",") if k.strip()}
    candidates = [i for i in illustrations if (i["kind"] in kinds if kinds else i["kind"] != "cover")]
    if len(candidates) > 100:
        raise ValueError("album exceeds the 100-image assignment budget")
    for illustration in candidates:
        image_path = safe_path(novel_dir, illustration["asset"], "assets")
        if not image_path.is_file() or image_path.stat().st_size > 15 * 1024 * 1024:
            raise ValueError("album image missing or exceeds 15 MiB")
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

    out_path = safe_path(novel_dir, "ontology/portraits.jsonl", "ontology")
    records = [json.loads(line) for line in out_path.read_text(encoding="utf8").splitlines() if line.strip()] if out_path.exists() else []
    for record in records:
        safe_path(novel_dir, record["portrait"], "assets")
    assigned = {record["entityId"] for record in records if record.get("entityId")}
    assigned_names = {norm(record["name"]) for record in records if record.get("entityId") is None and record.get("name")}
    already_assigned = lambda character: character["entityId"] in assigned if character["entityId"] else norm(character["name"]) in assigned_names
    initial_count = len(records)
    ocr = None
    portraits_dir = safe_path(novel_dir, "assets/portraits", "assets")

    for ill in candidates:
        if all(already_assigned(character) for character in characters):
            break
        img_path = safe_path(novel_dir, ill["asset"], "assets")
        if ocr is None:
            ocr = RapidOCR()
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
        anchors = []
        variant_sets = [variants for character, variants in char_variants]
        for index, (character, variants) in enumerate(char_variants):
            if already_assigned(character):
                continue
            hit = unique_anchor(variant_sets, lines, index)
            if hit:
                anchors.append((hit["conf"], character, hit))
        if not anchors:
            continue
        heads = []
        for box, _label, score in detect_heads(img):
            if float(score) < 0.6:
                continue
            heads.append({"box": [round(v) for v in box], "score": float(score),
                          "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2})
        if not heads:
            continue
        claimed: set[int] = set()
        for record in records:
            if record.get("sourceIllustration") == ill["id"]:
                claimed.update(index for index, head in enumerate(heads) if head["box"] == record.get("headBox"))
        for _conf, c, ln in sorted(anchors, key=lambda a: -a[0]):
            best_i = nearest_head(heads, claimed, ln, W, H)
            if best_i is None:
                continue
            claimed.add(best_i)
            h = heads[best_i]
            x0, y0, x1, y1 = h["box"]
            pw, ph = (x1 - x0) * 0.25, (y1 - y0) * 0.25
            crop_box = (max(0, int(x0 - pw)), max(0, int(y0 - ph)), min(W, int(x1 + pw)), min(H, int(y1 + ph)))
            slug = hashlib.sha256(json.dumps([ill["id"], h["box"], c["entityId"], c["name"]], ensure_ascii=False).encode()).hexdigest()
            rel = f"assets/portraits/{slug}.png"
            portraits_dir.mkdir(parents=True, exist_ok=True)
            target = safe_path(novel_dir, rel, "assets")
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=portraits_dir, suffix=".png", delete=False) as stream:
                    temporary = Path(stream.name)
                img.crop(crop_box).save(temporary)
                os.replace(temporary, target)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink()
            rec = {"entityId": c["entityId"], "name": c["name"], "portrait": rel,
                   "sourceIllustration": ill["id"], "sourceAsset": ill["asset"],
                   "ocrText": ln["text"], "ocrConfidence": round(ln["conf"], 3),
                   "matchKind": ln.get("matchKind", "substring"),
                   "headBox": h["box"], "headScore": round(h["score"], 3),
                   "imageSize": [W, H]}
            if c["entityId"]:
                assigned.add(c["entityId"])
            else:
                assigned_names.add(norm(c["name"]))
            records.append(rec)

    if len(records) > initial_count:
        atomic_records(out_path, records)
    summary = {
        "novelDir": str(novel_dir),
        "characters": len(characters),
        "created": len(records) - initial_count,
        "preserved": initial_count,
        "notFoundCount": sum(not already_assigned(character) for character in characters),
        "notFound": [character["name"] for character in characters if not already_assigned(character)][:20],
        "portraitsFile": "ontology/portraits.jsonl",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())

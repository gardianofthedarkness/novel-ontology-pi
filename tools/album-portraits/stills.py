#!/usr/bin/env python3
"""The stills cast's local preparation (docs/v2/stills.md; the user, 2026-11-05): for each of the book's pictures, its
faces (lettered A, B, C … on a copy for Jev) and its text (OCR, each line with its box); and one sheet of the book's
bound portraits, labelled P1, P2 …, for Jev to tell faces by. Panels are not cut (bright backgrounds read as gutters):
Jev says which moment each face is in. Nothing is decided here: the stills cast asks Jev with this and the text around the picture.

Reads <album>/ontology/illustrations.jsonl and <album>/assets; writes the lettered pictures to --sheets and prints one
JSON object: {pictures: [{id, kind, size, panels, faces, texts, sheet}]}, boxes as fractions of the picture.

Usage:
  stills.py <album-dir> --sheets <dir> [--kinds story,plate,paratext]
"""
import argparse, json, sys
from pathlib import Path

LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
SHEET_SIDE = 1024  # Jev takes square pictures (the director sends 1024 x 1024): each sheet fitted and padded to it


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("album_dir")
    ap.add_argument("--sheets", required=True)
    ap.add_argument("--kinds", default="story")
    ap.add_argument("--min-face", type=float, default=0.45)
    ap.add_argument("--min-text", type=float, default=0.6)
    args = ap.parse_args()
    album = Path(args.album_dir).resolve()
    sheets = Path(args.sheets).resolve(); sheets.mkdir(parents=True, exist_ok=True)
    kinds = {k.strip() for k in args.kinds.split(",") if k.strip()}
    pictures = [json.loads(l) for l in (album / "ontology" / "illustrations.jsonl").read_text(encoding="utf8").splitlines() if l.strip()]
    pictures = [p for p in pictures if p["kind"] in kinds]

    from PIL import Image, ImageDraw, ImageFont
    from imgutils.detect import detect_heads
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR()
    out = []
    for picture in pictures:
        path = (album / picture["asset"]).resolve()
        if album not in path.parents or not path.is_file():
            raise ValueError(f"picture outside the album: {picture['asset']}")
        img = Image.open(path).convert("RGB"); w, h = img.size
        frac = lambda x0, y0, x1, y1: {"left": round(x0 / w, 3), "top": round(y0 / h, 3), "right": round(x1 / w, 3), "bottom": round(y1 / h, 3)}
        heads = sorted([(box, float(score)) for box, _label, score in detect_heads(img) if float(score) >= args.min_face], key=lambda entry: (entry[0][0] + entry[0][2]) / 2)
        faces = [{"letter": LETTERS[k], "box": frac(*box), "score": round(score, 3)} for k, (box, score) in enumerate(heads[: len(LETTERS)])]
        result, _ = ocr(str(path))
        texts = []
        for box, text, conf in (result or []):
            if float(conf) < args.min_text or not text.strip():
                continue
            xs, ys = [p[0] for p in box], [p[1] for p in box]
            texts.append({"ref": f"t{len(texts) + 1}", "text": text, "conf": round(float(conf), 3), "box": frac(min(xs), min(ys), max(xs), max(ys))})
        # The lettered copy Jev sees: each face boxed and lettered, each text line boxed thin and numbered.
        scale = SHEET_SIDE / max(w, h)
        fitted = img.resize((round(w * scale), round(h * scale)))
        sheet = Image.new("RGB", (SHEET_SIDE, SHEET_SIDE), (255, 255, 255)); ox, oy = (SHEET_SIDE - fitted.width) // 2, (SHEET_SIDE - fitted.height) // 2
        sheet.paste(fitted, (ox, oy))
        draw = ImageDraw.Draw(sheet); sw, sh = fitted.size
        try: font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", max(18, sw // 40))
        except Exception: font = ImageFont.load_default()
        for face in faces:
            b = face["box"]; x0, y0, x1, y1 = ox + b["left"] * sw, oy + b["top"] * sh, ox + b["right"] * sw, oy + b["bottom"] * sh
            draw.rectangle([x0, y0, x1, y1], outline=(255, 40, 40), width=max(3, sw // 300))
            draw.rectangle([x0, max(0, y0 - font.size - 6), x0 + font.size + 8, y0], fill=(255, 40, 40))
            draw.text((x0 + 4, max(0, y0 - font.size - 5)), face["letter"], fill=(255, 255, 255), font=font)
        for text in texts:
            b = text["box"]; draw.rectangle([ox + b["left"] * sw, oy + b["top"] * sh, ox + b["right"] * sw, oy + b["bottom"] * sh], outline=(40, 120, 255), width=2)
            draw.text((ox + b["right"] * sw + 2, oy + b["top"] * sh), text["ref"], fill=(40, 120, 255), font=font)
        target = sheets / f"{picture['id']}.png"
        sheet.save(target)
        # Each face on its own (its head and a little round it, on a square), so a question can point at one face alone.
        for face in faces:
            b = face["box"]; fw, fh = (b["right"] - b["left"]) * w, (b["bottom"] - b["top"]) * h
            box = (max(0, int(b["left"] * w - 0.3 * fw)), max(0, int(b["top"] * h - 0.3 * fh)), min(w, int(b["right"] * w + 0.3 * fw)), min(h, int(b["bottom"] * h + 0.3 * fh)))
            crop = img.crop(box); crop.thumbnail((SHEET_SIDE // 2, SHEET_SIDE // 2))
            square = Image.new("RGB", (SHEET_SIDE // 2, SHEET_SIDE // 2), (255, 255, 255)); square.paste(crop, ((square.width - crop.width) // 2, (square.height - crop.height) // 2))
            face["crop"] = str(sheets / f"{picture['id']}-{face['letter']}.png"); square.save(face["crop"])
        out.append({"id": picture["id"], "kind": picture["kind"], "size": [w, h], "faces": faces, "texts": texts, "sheet": str(target)})
    # The gallery: each bound portrait (ontology/portraits.jsonl, the first of each person), labelled P1, P2 … in a row.
    gallery, records = [], []
    portraits_file = album / "ontology" / "portraits.jsonl"
    if portraits_file.exists():
        seen = set()
        for line in portraits_file.read_text(encoding="utf8").splitlines():
            if not line.strip(): continue
            record = json.loads(line)
            if not record.get("entityId") or record["entityId"] in seen: continue
            seen.add(record["entityId"]); records.append(record)
    if records:
        columns = 4 if len(records) > 9 else 3 if len(records) > 4 else 2
        side = SHEET_SIDE // columns
        sheet = Image.new("RGB", (SHEET_SIDE, SHEET_SIDE), (255, 255, 255)); draw = ImageDraw.Draw(sheet)
        try: font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 28)
        except Exception: font = ImageFont.load_default()
        for k, record in enumerate(records):
            if k >= columns * columns: break
            cx, cy = (k % columns) * side, (k // columns) * side
            face = Image.open((album / record["portrait"]).resolve()).convert("RGB"); face.thumbnail((side - 8, side - 44))
            sheet.paste(face, (cx + (side - face.width) // 2, cy + 40 + (side - 40 - face.height) // 2))
            draw.text((cx + 8, cy + 4), f"P{k + 1}", fill=(200, 30, 30), font=font)
            gallery.append({"label": f"P{k + 1}", "entityId": record["entityId"]})
        sheet.save(sheets / "gallery.png")
    print(json.dumps({"pictures": out, "gallery": gallery, "gallerySheet": str(sheets / "gallery.png") if gallery else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

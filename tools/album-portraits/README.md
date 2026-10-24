# Album portraits — OCR character-crop assignment

Assigns a small portrait picture to each character from the album's
illustrations: OCR the color plates' printed captions, match names
against the ontology registry, detect heads, crop.

This is the production form of the pipeline proven in the Oct 2026
POC and two web benchmarks (38 mixed-language cards: pair precision
93%; 34 fully-Chinese cards: pair precision 100%, name recall 68%,
with the misses classified — logo fonts, handwriting, glyph misreads,
and matcher script bugs this tool fixes via OpenCC normalization and
one-to-one head assignment).

## Setup (Python 3.10+, CPU-only, ~0.3–5 s per illustration)

```
pip install rapidocr-onnxruntime dghs-imgutils opencc-python-reimplemented pillow
```

Models download on first use (RapidOCR PP-OCR via ONNX; imgutils
YOLOv8 anime head detector from Hugging Face). Nothing is vendored
into this repo; check the model weights' licenses before any
redistribution. On macOS the same stack runs as-is; Apple Vision
(zh-Hans) is a viable zero-dependency OCR alternative.

## Usage

```
novel album import <novel-dir> <book.epub>          # first: the album
python3 tools/album-portraits/portraits.py <novel-dir>
```

Names come from `ontology/entities.jsonl` (kind=character, all name
forms). Before a novel is ingested, `--names-file names.txt` accepts
one character per line (`Name` or `Name | form1, form2`).

Output: crops in `assets/portraits/`, records in
`ontology/portraits.jsonl` (entity, portrait asset, source
illustration, OCR evidence + confidence, head box). Characters whose
name no caption carries are reported under `notFound` — no portrait
is invented for them.

Two hard-won assignment rules: heads are claimed **one-to-one** (a
head serves one character), and anchoring prefers a **standalone
name line** (a caption column is headed by its owner's name alone)
over substring mentions — a name can appear inside another
character's caption text ("dislikes Mikoto" in Misaki's column),
which otherwise steals a neighbouring head and cascades into a
swap. Each record carries its `matchKind` (`exact-line` /
`substring`) so the gate can weigh it. Verified on Genesis Testament
vols 1–2: 6/6 and 4/4 correct, the rest honestly not found.

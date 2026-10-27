# Album portraits — OCR character-crop assignment

Assigns a small portrait picture to each character from the album's
illustrations: OCR the color plates' printed captions, match names
against the ontology registry, detect heads, crop.

The post-extraction integration uses stricter matching than the earlier POC.
Historical POC results are not a fresh accuracy measurement of this version.

## Host setup

```
python3.12 -m venv /private/path/portrait-venv
/private/path/portrait-venv/bin/pip install -r tools/album-portraits/requirements.txt
export NOVEL_PORTRAIT_PYTHON=/private/path/portrait-venv/bin/python
```

Models download on first use (RapidOCR PP-OCR via ONNX; imgutils
YOLOv8 anime head detector from Hugging Face). Nothing is vendored
into this repo; check the model weights' licenses before any
redistribution. On macOS the same stack runs as-is; Apple Vision
(zh-Hans) is a viable zero-dependency OCR alternative.

## Agent workflow

Use the separate [`novel-portraits` skill](../../skills/novel-portraits/SKILL.md).
Import the matching EPUB album before extraction. After the whole volume has
completed extraction and shared review/application:

```sh
novel album assign <novel-dir> --check
novel album assign <novel-dir>
```

Preflight checks source binding, every block's approved packet/application audit,
the imported album, cast and Python packages without writes/model downloads.
`ready` means preconditions/packages exist, not that weights are cached. Missing
intake/dependencies or unfinished extraction returns a blocked/setup status.
Held individual facts remain held; never approve them just to obtain pictures.

Assignment uses a workspace lock, the fixed script and a five-minute timeout.
Existing crops/bindings are preserved; only new matches are added. Python receives
local runtime/cache environment, not the host's API keys. No Jev/LLM calls are
made; novel content stays local to this command. Public weights may download on
first assignment. The command finalizes EM/name bindings, not semantic proposals.
The live album/character projection displays bound portraits without rebuilding
the ontology. `bound` and `pendingCharacters` report coverage separately.

The scoped Pi runner preloads the skill, allows only the assigned workspace and
fixed flags, and checkpoints album mutations. Its current model is text-only:
unresolved pictures stay hidden, not guessed by a visual fallback. Restart a
previously running Pi host to load the new skill/command scope.

## Low-level operator use

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

Matching uses latest canonical Character records, unique **whole-line** captions
across simplified/traditional variants, and OCR confidence at least 0.8. There is
no automatic substring-mention binding. Head score must be at least 0.6, normalized
squared caption/head distance at most 0.16, with a 0.01 margin over the next head.
Claimed heads cannot be reassigned. These thresholds are heuristics, not accuracy
guarantees; ambiguous names, weak evidence and ambiguous heads stay unassigned.

At most 100 non-cover images, 15 MiB each. Assets cannot escape `assets/`;
metadata cannot traverse symlinks. Crop filenames are hashes, not character IDs
or names. Metadata replacement is atomic. `--names-file`, `--kinds` and threshold
overrides are operator-only, never exposed to the scoped agent. The existing
`novel album portraits` only finalizes already-created crops.

```sh
python3 -m unittest discover -s tools/album-portraits -p 'test_*.py'
```

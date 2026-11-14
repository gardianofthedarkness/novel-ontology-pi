"""Find a character's references in a book's colour plates (any character, any series), from the album portrait tool.
usage: python find_refs.py <album-root> <name> <out-dir> [--forms=a,b] [--top=3]
  <album-root>: folders in the album's shape (ontology/illustrations.jsonl, assets/), each already run through the
  album portrait tool (tools/album-portraits/portraits.py: OCR of the plates' printed captions, a name matched to the
  nearest head). That tool binds a name to the head nearest its caption, which is sometimes someone else's (two of
  Index's six were), so here:
    1. every portrait bound to <name> (or a --forms name) is collected;
    2. the ones that are not the same character as the rest are dropped (CCIP, deepghs's anime character identity model in
       imgutils; grouped by their differences, cut at the largest jump);
    3. in each kept head's plate the person around it is found (an anime person detector) and measured: how many heads
       tall the person box is (about 6 or more is a full figure) and how many pixels the head has;
    2b. the same character where no caption names her (covers above all): every head in every picture that CCIP calls the
       same character: as close to every verified head as those are to each other;
  4. ranked as setting pictures (most complete figure, fewest other people in its box, then most pixels) and as
     portraits (largest head), never a figure that is mostly bare skin below the head (swimwear); the top ones
       are cropped into <out-dir> with refs.json. Pass the best to make_figure.py (setting picture, --full, --portrait).
  Runs in the portrait tool's Python (dghs-imgutils, pillow)."""
import json, os, sys
import numpy as np
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
ROOT, NAME, OUT = args[:3]; TOP = int(flags.get('top', 3))
FORMS = {NAME, *[f.strip() for f in flags.get('forms', '').split(',') if f.strip()]}
os.makedirs(OUT, exist_ok=True)

found = []
for d in sorted(os.listdir(ROOT)):
    f = os.path.join(ROOT, d, 'ontology', 'portraits.jsonl')
    if not os.path.isfile(f): continue
    ills = {}
    ip = os.path.join(ROOT, d, 'ontology', 'illustrations.jsonl')
    for line in open(ip, encoding='utf-8'):
        if line.strip(): r = json.loads(line); ills[r['id']] = r
    for line in open(f, encoding='utf-8'):
        if not line.strip(): continue
        r = json.loads(line)
        if r.get('name') in FORMS:
            found.append({'album': d, 'plate': os.path.join(ROOT, d, ills[r['sourceIllustration']]['asset']), 'head': r['headBox'],
                          'crop': os.path.join(ROOT, d, r['portrait']), 'caption': r['ocrText'], 'conf': r['ocrConfidence'],
                          'source': ills[r['sourceIllustration']].get('source')})
print('FIG %d portraits bound to %s' % (len(found), NAME))
if not found: raise SystemExit('FIG nothing to choose from')

# identity by CCIP (deepghs's anime character identity model, in imgutils): each head with some of its shoulders, as the
# model expects; the default threshold says "same character". (A colour histogram was tried first: it told Index from a
# black-haired girl only narrowly and accepted 350 look-alike heads, more than there are pictures.)
from imgutils.metrics import ccip_batch_extract_features, ccip_batch_differences, ccip_default_threshold
TH = float(flags.get('threshold', ccip_default_threshold()))
def view_of(f):
    x0, y0, x1, y1 = f['head']; hh, hw = y1 - y0, x1 - x0; img = Image.open(f['plate']).convert('RGB'); W, H = img.size
    return img.crop((max(0, int(x0 - 0.5 * hw)), max(0, int(y0 - 0.2 * hh)), min(W, int(x1 + 0.5 * hw)), min(H, int(y1 + 1.0 * hh))))
feats = ccip_batch_extract_features([view_of(f) for f in found])
D = np.array(ccip_batch_differences(feats)) if len(found) > 1 else np.zeros((1, 1))
# the character's own group. CCIP's default threshold assumes clean crops; on small plate heads in changing outfits (a
# Santa hat, swimwear) Index against Index scored 0.31-0.33, above it, so the threshold only ranks: complete-linkage
# grouping over the differences, cut before the largest jump in merge distance, the largest group is the character
# (Index: her four at 0.31-0.33, a black-haired girl 0.37, a boy 0.40)
groups = [[i] for i in range(len(found))]; states, heights = [[list(g) for g in groups]], []
while len(groups) > 1:
    d, x, y = min((max(D[a][b] for a in g for b in h), x, y) for x, g in enumerate(groups) for y, h in enumerate(groups) if x < y)
    groups[x] = groups[x] + groups[y]; del groups[y]; heights.append(float(d)); states.append([list(g) for g in groups])
gaps = [heights[k + 1] - heights[k] for k in range(len(heights) - 1)]
k = int(np.argmax(gaps)) + 1 if gaps else len(heights)
core_ids = set(max(states[k], key=len)); RADIUS = max(heights[k - 1] if k else TH, TH)
for i, f in enumerate(found):
    f['kept'] = i in core_ids
    f['look_distance'] = round(float(np.median(np.delete(D[i], i))) if len(found) > 1 else 0.0, 3)
kept = [f for f in found if f['kept']]
print('FIG CCIP: median difference to the others', [(f['album'], f['look_distance']) for f in found], 'group radius', round(RADIUS, 3))
print('FIG kept %d of %d by look (dropped: %s)' % (len(kept), len(found), [(f['album'], f['look_distance']) for f in found if not f['kept']]))

from imgutils.detect import detect_person, detect_heads
_heads = {}
def heads_of(plate):
    if plate not in _heads:
        _heads[plate] = [[round(v) for v in b] for b, _l, sc in detect_heads(Image.open(plate).convert('RGB')) if sc >= 0.6]
    return _heads[plate]
# the same character where no caption names her (covers above all, where the best pictures are): every head in every
# picture of the albums that is as close in look to EACH verified head as those are to each other (the group's own spread)
if flags.get('search', '1') == '1' and kept:
    core = [feats[i] for i, f in enumerate(found) if f['kept']]
    known = {(f['plate'], tuple(f['head'])) for f in found}; cands = []
    for d in sorted(os.listdir(ROOT)):
        ip = os.path.join(ROOT, d, 'ontology', 'illustrations.jsonl')
        if not os.path.isfile(ip): continue
        for line in open(ip, encoding='utf-8'):
            if not line.strip(): continue
            ill = json.loads(line); plate = os.path.join(ROOT, d, ill['asset'])
            for box in heads_of(plate):
                if (plate, tuple(box)) not in known: cands.append({'album': d, 'plate': plate, 'head': box, 'source': ill.get('source'), 'caption': None, 'conf': None, 'by': 'look'})
    extra = []
    for k in range(0, len(cands), 32):
        chunk = cands[k:k + 32]; cf = ccip_batch_extract_features([view_of(g) for g in chunk])
        dd = np.array(ccip_batch_differences(list(cf) + core))[:len(chunk), len(chunk):]
        for g, row in zip(chunk, dd):
            # as close to every verified head as they are to each other (complete linkage, the group's own radius)
            if row.max() <= RADIUS: g['look_distance'] = round(float(np.median(row)), 3); g['kept'] = True; extra.append(g)
    print('FIG found by CCIP where no caption names her: %d of %d heads (%s)' % (len(extra), len(cands), sorted({e['source'] for e in extra})))
    kept = kept + extra
def skin_share(img, box, head):
    """how much of the figure below the head is bare skin (hue of skin, moderately saturated, bright)"""
    x0, y0, x1, y1 = box
    if y1 - head[3] < 10 or x1 - x0 < 10: return 0.0
    body = img.crop((int(x0), int(head[3]), int(x1), int(y1))).convert('HSV')
    a = np.asarray(body.resize((60, 120))).reshape(-1, 3).astype(int)
    if len(a) == 0: return 0.0
    skin = (a[:, 0] < 25) & (a[:, 1] > 35) & (a[:, 1] < 170) & (a[:, 2] > 120)
    return float(skin.mean())
for f in kept:
    img = Image.open(f['plate']).convert('RGB'); W, H = img.size
    x0, y0, x1, y1 = f['head']; hh = y1 - y0; hx, hy = (x0 + x1) / 2, (y0 + y1) / 2
    best = None
    for box, _l, score in detect_person(img):
        bx0, by0, bx1, by1 = box
        if bx0 <= hx <= bx1 and by0 <= hy <= by1 and score > 0.3 and (best is None or (by1 - by0) > (best[3] - best[1])): best = box
    if best is None: best = (max(0, x0 - 1.5 * hh), y0, min(W, x1 + 1.5 * hh), min(H, y0 + 7 * hh))
    f['person'] = [round(v) for v in best]; f['heads_tall'] = round((best[3] - best[1]) / max(1, hh), 1)
    f['head_px'] = int(hh); f['cut_at_bottom'] = bool(best[3] >= H - 3)
    others = [h for h in heads_of(f['plate']) if h != f['head'] and best[0] <= (h[0] + h[2]) / 2 <= best[2] and best[1] <= (h[1] + h[3]) / 2 <= best[3]]
    f['others_in_box'] = len(others); f['skin'] = round(skin_share(img, best, f['head']), 2)
    # a figure that is mostly bare skin below the head (swimwear) is never a setting picture: this pipeline makes no
    # swimwear figures, and characters may be minors
    f['revealing'] = f['skin'] > 0.30
    f['setting_score'] = round(min(f['heads_tall'], 7) * 100 + (best[3] - best[1]) / 10 - (150 if f['cut_at_bottom'] else 0) - 120 * len(others), 1)

def save(f, box, name, margin):
    img = Image.open(f['plate']).convert('RGB'); W, H = img.size; x0, y0, x1, y1 = box
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    img.crop((max(0, int(x0 - mx)), max(0, int(y0 - my)), min(W, int(x1 + mx)), min(H, int(y1 + my)))).save(os.path.join(OUT, name))
    return os.path.join(OUT, name)
settings = sorted([f for f in kept if not f['revealing']], key=lambda f: -f['setting_score'])[:TOP]
portraits = sorted([f for f in kept if not f['revealing']], key=lambda f: -f['head_px'])[:TOP]
print('FIG left out as revealing (mostly skin below the head): %d' % sum(f['revealing'] for f in kept))
out = {'name': NAME, 'found': found, 'setting': [], 'portrait': []}
for i, f in enumerate(settings): out['setting'].append({**{k: f.get(k) for k in ('album', 'source', 'by', 'heads_tall', 'head_px', 'cut_at_bottom', 'others_in_box', 'skin')}, 'file': save(f, f['person'], 'setting_%d.png' % i, 0.06)})
for i, f in enumerate(portraits):
    x0, y0, x1, y1 = f['head']; hh = y1 - y0
    out['portrait'].append({**{k: f.get(k) for k in ('album', 'source', 'by', 'head_px')}, 'file': save(f, (x0 - hh, y0 - 0.6 * hh, x1 + hh, y1 + 1.6 * hh), 'portrait_%d.png' % i, 0.0)})
json.dump(out, open(os.path.join(OUT, 'refs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for k in ('setting', 'portrait'):
    print('FIG %s: %s' % (k, [(r['source'], r.get('by') or 'caption', r.get('heads_tall'), r['head_px']) for r in out[k]]))

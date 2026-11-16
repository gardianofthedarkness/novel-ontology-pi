"""Cut a head-and-shoulders picture out of a full-body one, for the portrait redraw (any character, one picture is enough).
usage: python crop_head.py <picture.png> <out.png> [--size=1024] [--above-shoulders]
  The head is measured on the figure's own silhouette (prep_view's figure mask) around the face RTMW finds: going down from
  the chin, the silhouette's run through the face's middle narrows to the neck and then grows wider than the head (the
  shoulders, in a T-pose the arms too). The head is the silhouette above the neck's narrowest row that holds the face
  (hair and head wear included). The portrait prompt asks for the head at about half the picture's height, so the square
  crop is two head heights (never less than the head and shoulders it must hold), with the head-to-shoulders span in its
  middle; padded with white where it leaves the picture and scaled to --size. The shoulders end where the outline's width
  jumps most from one row to the next between the neck and the shoulder joints (a T-pose's arms join there);
  --above-shoulders whites out from that row (the arms at shoulder height would read as hands at the neck); the portrait
  redraw draws the rest.
  Numeric constants left: --size 1024, the COCO-WholeBody face layout (jaw = points 23-39)."""
import json, os, sys
import cv2
import numpy as np
from rtmlib import Wholebody
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prep_view import figure_mask
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
SRC, OUT = args[:2]; SIZE = int(flags.get('size', 1024))
img = cv2.imread(SRC); h, w = img.shape[:2]
kps, scores = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')(img)
if len(kps) == 0: raise SystemExit('FIG no person found in ' + SRC)
best = int(np.argmax(scores[:, 23:91].mean(1))); k = kps[best]
jaw = k[23:40]; chin = jaw[8]; nose = k[0]
fg, _ = figure_mask(img)
def run(y, x):
    """the silhouette's horizontal run in row y through column x (its ends), or None when x is off the figure there"""
    row = fg[y]; x = int(np.clip(round(x), 0, w - 1))
    if not row[x]: return None
    zl, zr = np.nonzero(row[:x] == 0)[0], np.nonzero(row[x:] == 0)[0]
    return (int(zl[-1]) + 1 if len(zl) else 0), (x + int(zr[0]) if len(zr) else w)
cx = float(chin[0]); cy = int(np.clip(round(chin[1]), 0, h - 1))
# the head's widest run at or above the chin (hair included)
above = [run(y, cx) for y in range(cy + 1)]; widths_above = [r - l for l, r in (a for a in above if a)]
head_wide = max(widths_above) if widths_above else 0
# going down from the chin: the body grows wider than the head at the shoulders; the neck is the narrowest row before
wide_y, neck_y, neck_w = h, cy, None
for y in range(cy, h):
    a = run(y, cx)
    if a is None: continue
    if a[1] - a[0] > head_wide: wide_y = y; break
    if neck_w is None or a[1] - a[0] <= neck_w: neck_y, neck_w = y, a[1] - a[0]
# the arms join the outline where its width jumps most from one row to the next, between the neck and the shoulder joints
# (in a T-pose the shoulders' slope first, then the arms' upper edge all at once): the shoulders end there
sho_j = int(np.clip(round(max(k[5][1], k[6][1])), 0, h - 1))
rows = np.arange(neck_y, max(sho_j, wide_y) + 1)
wid = np.array([(lambda a: a[1] - a[0] if a else 0)(run(y, cx)) for y in rows])
sho_y = int(rows[1 + int(np.argmax(np.diff(wid)))]) if len(rows) > 1 else wide_y
# the head: the silhouette above the neck that holds the face
n, cc = cv2.connectedComponents(fg[:neck_y + 1].copy())
lab = cc[int(np.clip(round(nose[1]), 0, neck_y)), int(np.clip(round(nose[0]), 0, w - 1))]
ys, xs = np.nonzero(cc == lab) if lab else (np.array([0, neck_y]), np.array([int(cx), int(cx)]))
hx0, hy0, hx1, hy1 = int(xs.min()), int(ys.min()), int(xs.max()), neck_y
head_h = hy1 - hy0
# the square: two head heights (the prompt's head at half the height), at least the head-to-shoulders span and the head's width
bottom = min(sho_y, h); side = int(max(2 * head_h, bottom - hy0, hx1 - hx0))
ccx, ccy = (hx0 + hx1) / 2, (hy0 + bottom) / 2
x0, y0 = int(round(ccx - side / 2)), int(round(ccy - side / 2)); x1, y1 = x0 + side, y0 + side
cut = sho_y if ('--above-shoulders' in sys.argv and sho_y < h) else None
pad = max(0, -x0, -y0, x1 - w, y1 - h)
big = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
if cut is not None: big[cut + pad:, :] = 255
crop = big[y0 + pad:y1 + pad, x0 + pad:x1 + pad]
crop = cv2.resize(crop, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC if crop.shape[0] < SIZE else cv2.INTER_AREA)
cv2.imwrite(OUT, crop)
# where the crop came from (picture pixels), so points found in it can be traced back to the picture (front mapping)
json.dump({'crop': [x0, y0, x1, y1], 'size': SIZE}, open(os.path.splitext(OUT)[0] + '.json', 'w'))
print('FIG head crop', json.dumps({'nose': [round(float(nose[0])), round(float(nose[1]))], 'head_box': [hx0, hy0, hx1, hy1], 'neck_y': neck_y,
                                   'shoulders_y': sho_y, 'crop': [x0, y0, x1, y1], 'scale': round(SIZE / (x1 - x0), 2)}))

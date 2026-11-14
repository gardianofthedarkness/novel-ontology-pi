"""Cut a head-and-shoulders picture out of a full-body one, for the portrait redraw (any character, one picture is enough).
usage: python crop_head.py <picture.png> <out.png> [--size=1024] [--above-shoulders]
  RTMPose (rtmlib) finds the nose, eyes, ears and shoulders; the crop is centred on the face, wide enough for the hair
  (about five head widths) with room above the hair, padded square with white and scaled to --size. --above-shoulders
  stops the crop just above the shoulders (for a T-pose, whose arms at shoulder height would read as hands at the neck);
  the rest is white, and the portrait redraw draws the shoulders."""
import json, sys
import cv2
import numpy as np
from rtmlib import Body
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
SRC, OUT = args[:2]; SIZE = int(flags.get('size', 1024))
img = cv2.imread(SRC); h, w = img.shape[:2]
kps, scores = Body(mode='balanced', backend='onnxruntime', device='cpu')(img)
if len(kps) == 0: raise SystemExit('FIG no person found in ' + SRC)
best = int(np.argmax(scores[:, :5].mean(1))); k, s = kps[best], scores[best]
nose, le, re_, lear, rear = k[0], k[1], k[2], k[3], k[4]
eye_d = float(np.linalg.norm(le - re_)); ear_d = float(np.linalg.norm(lear - rear)) if min(s[3], s[4]) > 0.3 else 0.0
head_w = max(ear_d, 2.4 * eye_d)
cx, cy = float(nose[0]), float(nose[1]) - 0.35 * head_w
half = 2.5 * head_w                      # the crop is five head widths: hair on both sides, shoulders below
x0, x1, y0, y1 = int(cx - half), int(cx + half), int(cy - 0.95 * half), int(cy + 1.05 * half)
cut = None
if 'above-shoulders' in sys.argv[-1] or '--above-shoulders' in sys.argv:
    sho_y = float(min(k[5][1], k[6][1])) if min(s[5], s[6]) > 0.3 else float(nose[1]) + 0.9 * head_w
    cut = int(sho_y - 0.12 * head_w)
pad = max(0, -x0, -y0, x1 - w, y1 - h)
big = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
if cut is not None: big[cut + pad:, :] = 255
crop = big[y0 + pad:y1 + pad, x0 + pad:x1 + pad]
crop = cv2.resize(crop, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC if crop.shape[0] < SIZE else cv2.INTER_AREA)
cv2.imwrite(OUT, crop)
print('FIG head crop', json.dumps({'nose': [round(float(nose[0])), round(float(nose[1]))], 'head_width_px': round(head_w), 'crop': [x0, y0, x1, y1], 'scale': round(SIZE / (x1 - x0), 2)}))

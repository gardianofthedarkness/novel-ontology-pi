"""Does a portrait show hands? The redraw sometimes adds hands at the shoulders or the picture's bottom edge (they become
lumps on the head's bust). RTMW (rtmlib's whole-body model, as face_marks.py uses) finds each hand's 21 points. What counts
as a confident point is read from the picture itself: the 133 scores of every person found split in two (Otsu: the points
the model sees, the face always among them, against the ones it guesses, the legs out of a portrait's frame); a hand counts
when most of its points (more than half, i.e. its median) are inside the picture and on the seen side. Portraits with no
hands put their hand points at 0.18-0.33 against a split of 0.55-0.65; portraits with hands put them at 0.77-0.93.
usage: python hands_check.py <portrait.png>   exit code 0: no hands; 3: hands"""
import json, sys
import cv2
import numpy as np
from rtmlib import Wholebody
args = [a for a in sys.argv[1:] if not a.startswith('--')]
img = cv2.imread(args[0]); h, w = img.shape[:2]
kps, scores = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')(img)
def otsu(v):
    """the split of a set of numbers into two groups with the most between-group variance (no parameter)"""
    v = np.sort(np.asarray(v, float).ravel()); n = len(v); c = np.cumsum(v); i = np.arange(1, n)
    m0, m1 = c[:-1] / i, (c[-1] - c[:-1]) / (n - i); between = i * (n - i) * (m0 - m1) ** 2
    k = int(np.argmax(between)); return (v[k] + v[k + 1]) / 2
found = []
if len(kps):
    split = otsu(scores)
    for k, s in zip(kps, scores):
        for name, (a, b) in (('left hand', (91, 112)), ('right hand', (112, 133))):   # COCO-WholeBody layout
            P, S = k[a:b], s[a:b]
            inside = (P[:, 0] >= 0) & (P[:, 0] < w) & (P[:, 1] >= 0) & (P[:, 1] < h)
            seen = inside & (S > split)
            if np.median(np.where(inside, S, 0)) > split:
                found.append({'hand': name, 'points': int(seen.sum()), 'median_score': round(float(np.median(S)), 2), 'split': round(float(split), 2),
                              'at': np.round(P[seen].mean(0)).astype(int).tolist()})
print('FIG hands in the portrait:', json.dumps(found) if found else 'none (split %.2f)' % otsu(scores) if len(kps) else 'none (no person)')
sys.exit(3 if found else 0)

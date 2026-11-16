"""The face's 68 points on the portrait picture (RTMW, rtmlib's whole-body model): python portrait_marks.py <portrait.png> <out-dir>
Writes <out-dir>/marks.json with 'portrait': the points (x, y, score) in the 300-W layout (0-16 jaw contour, 17-26 brows,
27-35 nose, 36-47 eyes, 48-67 mouth). hair_rig.py lays the portrait's colours on the head through them."""
import json, os, sys
import cv2, numpy as np
from rtmlib import Wholebody
src, out = sys.argv[1:3]; os.makedirs(out, exist_ok=True)
img = cv2.imread(src); kps, scores = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')(img)
if len(kps) == 0: raise SystemExit('FIG portrait: no face found')
best = int(np.argmax(scores[:, 23:91].mean(1)))          # the person whose face is surest
pts, sc = kps[best][23:91], scores[best][23:91]
json.dump({'portrait': {'points': [[float(x), float(y), float(s)] for (x, y), s in zip(pts, sc)], 'mean_score': float(sc.mean()), 'size': [img.shape[1], img.shape[0]]}},
          open(os.path.join(out, 'marks.json'), 'w'), indent=1)
print('FIG portrait face points: 68, mean score %.2f' % sc.mean())

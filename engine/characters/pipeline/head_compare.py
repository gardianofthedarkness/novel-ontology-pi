"""Heads side by side at the same eye spacing (RTMPose eyes), first image the reference; plus a full-body strip.
usage: head_compare.py <out.png> <label>=<image> ..."""
import sys, cv2, numpy as np
from rtmlib import Body
body = Body(mode='balanced', backend='onnxruntime', device='cpu')
out = sys.argv[1]; items = [a.split('=', 1) for a in sys.argv[2:]]
heads, fulls = [], []
for label, path in items:
    img = cv2.imread(path)
    k, s = body(img); k = k[0]
    le, re_ = k[1], k[2]; c = (le + re_) / 2; sc = 120 / max(1.0, np.linalg.norm(le - re_))
    M = np.array([[sc, 0, 200 - c[0] * sc], [0, sc, 190 - c[1] * sc]])
    h = cv2.warpAffine(img, M, (400, 420), borderValue=(255, 255, 255))
    cv2.rectangle(h, (0, 0), (400, 30), (30, 30, 30), -1); cv2.putText(h, label, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    heads.append(h)
    m = (img.min(2) < 235).astype(np.uint8); ys, xs = np.nonzero(m)
    crop = img[max(0, ys.min() - 10):ys.max() + 10, max(0, xs.min() - 10):xs.max() + 10]
    fulls.append(cv2.resize(crop, (round(crop.shape[1] * 420 / crop.shape[0]), 420)))
sep = lambda h: np.full((h, 8, 3), 255, np.uint8)
row1 = np.hstack(sum([[h, sep(420)] for h in heads], [])[:-1])
row2 = np.hstack(sum([[f, sep(420)] for f in fulls], [])[:-1])
W = max(row1.shape[1], row2.shape[1]); pad = lambda r: np.hstack([r, np.full((420, W - r.shape[1], 3), 255, np.uint8)])
cv2.imwrite(out, np.vstack([pad(row1), np.full((8, W, 3), 255, np.uint8), pad(row2)])); print('saved', out)

"""Read each eye's shapes from a portrait (anime eyes): the opening, the iris, the pupil, the highlights, the upper lash.
usage: python eye_shapes.py <portrait.png> <out-dir>      (in the portrait tool's Python: anime-face-detector, MIT)
  The opening comes from anime-face-detector's 28 points (trained on anime faces; a detector trained on real faces puts
  its eye contour well inside an anime eye): per eye the outer corner, the lid's top, the inner corner and three points
  of the lower lid. Inside that outline the pixels give the iris (not the white: a tall dark oval, as one ellipse), the
  pupil (the iris's darkest part) and the highlights (white blobs on the iris); just above the upper lid, the lash band
  (its thickness per column, and the wing past the outer corner). (Reading the lash by darkness alone fails: the iris's
  top is as dark as the lashes.) Writes eyes.json in portrait pixels (also the 28 points, for brows, nose and mouth) and
  eyes_check.png."""
import json, os, sys
import cv2
import numpy as np
from anime_face_detector import create_detector
SRC, OUT = sys.argv[1:3]; os.makedirs(OUT, exist_ok=True)
img = cv2.imread(SRC); hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); Hh, Ww = img.shape[:2]
pred = max(create_detector('yolov3', device='cpu')(img), key=lambda p: p['bbox'][4])
K = pred['keypoints'][:, :2]
check = img.copy(); out = {'points28': K.round(1).tolist()}
# the 28 points: 0-4 jaw, 5-7 and 8-10 brows, 11-16 and 17-22 eyes (outer, top, inner, then the lower lid), 23 nose,
# 24-27 mouth. The two eyes: the one on the picture's left first.
for name, ids in (('eye_r', (11, 12, 13, 16, 15, 14)), ('eye_l', (19, 18, 17, 20, 21, 22))):
    E = K[list(ids)]
    # a smooth outline through the six points: upper lid outer -> top -> inner, lower lid inner -> outer
    def spline(pts, n):
        t = np.linspace(0, 1, len(pts)); tt = np.linspace(0, 1, n)
        return np.stack([np.interp(tt, t, pts[:, 0]), np.interp(tt, t, pts[:, 1])], 1)
    upper = spline(E[[0, 1, 2]], 24); lower = spline(np.vstack([E[2], E[3], E[4], E[5], E[0]]), 24)
    outline = np.vstack([upper, lower[1:-1]])
    mask = np.zeros(img.shape[:2], np.uint8); cv2.fillPoly(mask, [outline.astype(np.int32)], 1)
    S, V = hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    # the iris: inside the opening and not the white
    iris = ((mask > 0) & ~((S < 45) & (V > 185))).astype(np.uint8)
    iris = cv2.morphologyEx(iris, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lb, st, _ = cv2.connectedComponentsWithStats(iris)
    iris = (lb == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    ic = max(cv2.findContours(iris, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea)
    ie = cv2.fitEllipse(ic)
    inside = np.zeros_like(iris); cv2.ellipse(inside, ie, 1, -1)
    pupil = ((inside > 0) & (V < np.percentile(V[inside > 0], 18))).astype(np.uint8)
    pupil = cv2.morphologyEx(pupil, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    pcs = cv2.findContours(pupil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    pc = max(pcs, key=cv2.contourArea) if pcs else None
    pe = cv2.fitEllipse(pc) if pc is not None and len(pc) >= 5 else (ie[0], (ie[1][0] * 0.4, ie[1][1] * 0.5), ie[2])
    # highlights: white blobs on the iris (a little enlarged, they sit on its edge)
    big = np.zeros_like(iris); cv2.ellipse(big, (ie[0], (ie[1][0] * 1.15, ie[1][1] * 1.1), ie[2]), 1, -1)
    hl = ((big > 0) & (S < 45) & (V > 215)).astype(np.uint8)
    # the white touching the iris's sides is not a highlight: keep blobs mostly inside the iris itself
    hls = []
    for h in sorted(cv2.findContours(hl, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea, reverse=True):
        if len(h) < 5 or cv2.contourArea(h) < 12: continue
        m2 = np.zeros_like(iris); cv2.drawContours(m2, [h], -1, 1, -1)
        if (m2 & inside).sum() > 0.6 * m2.sum(): hls.append(cv2.fitEllipse(h))
        if len(hls) == 3: break
    # the upper lash: dark pixels in a band just above the upper lid, per column; the wing past the outer corner
    span = np.ptp(E[:, 0]); lash = []
    xs = np.linspace(E[2][0], E[0][0] + np.sign(E[0][0] - E[2][0]) * 0.25 * span, 28)
    for x in xs:
        x_ = int(round(x))
        if not 0 <= x_ < Ww: continue
        y_lid = float(np.interp(x, *(upper[:, 0], upper[:, 1]) if upper[0, 0] < upper[-1, 0] else (upper[::-1, 0], upper[::-1, 1])))
        if (x - E[0][0]) * np.sign(E[0][0] - E[2][0]) > 0:   # past the outer corner: follow the lid's last direction
            y_lid = E[0][1] + (x - E[0][0]) * 0.35
        col = V[max(0, int(y_lid - 0.35 * span)):int(y_lid + 0.06 * span), x_]
        d = np.where(col < 70)[0]
        if len(d) < 2: continue
        top = max(0, int(y_lid - 0.35 * span)) + d.min(); bot = max(0, int(y_lid - 0.35 * span)) + d.max()
        lash.append([float(x), (top + bot) / 2, float(bot - top + 1)])
    sh = lambda e: {'centre': [float(e[0][0]), float(e[0][1])], 'axes': [float(e[1][0] / 2), float(e[1][1] / 2)], 'angle': float(e[2])}
    out[name] = {'corners': {'outer': E[0].tolist(), 'top': E[1].tolist(), 'inner': E[2].tolist()}, 'outline': outline.round(1).tolist(),
                 'iris': sh(ie), 'pupil': sh(pe), 'highlights': [sh(h) for h in hls], 'upper_lash': lash}
    cv2.polylines(check, [outline.astype(np.int32)], True, (0, 255, 0), 1)
    cv2.ellipse(check, ie, (255, 0, 255), 1); cv2.ellipse(check, pe, (0, 0, 255), 1)
    for h in hls: cv2.ellipse(check, h, (255, 255, 0), 1)
    for x, y, t in lash: cv2.line(check, (int(x), int(y - t / 2)), (int(x), int(y + t / 2)), (0, 165, 255), 1)
    print('FIG %s: opening %.0f px wide; iris %.0f x %.0f px; pupil %.0f x %.0f; %d highlights; lash over %d columns, %.0f-%.0f px thick'
          % (name, span, ie[1][0], ie[1][1], pe[1][0], pe[1][1], len(hls), len(lash), min(t for *_, t in lash), max(t for *_, t in lash)))
# the other organs as strokes: the brows (5-7, 8-10), the nose (23) and the mouth (24-27). Each stroke's path starts at
# the detector's points and is refined by the dark pixels across it, column by column (row by row for the nose), with
# its thickness there; strands of hair crossing a brow give outliers, so the path is a robust fit and the thickness is
# clamped near its median.
def stroke(P, n=28, band=None, dark=115, vertical=False, ext=0.0):
    P = np.asarray(P, float); A = P[:, ::-1] if vertical else P            # work as y(x); the nose as x(y)
    o = np.argsort(A[:, 0]); A = A[o]; span = np.ptp(A[:, 0]) or 10.0
    band = band or max(6.0, 0.18 * span)
    co = np.polyfit(A[:, 0], A[:, 1], min(2, len(A) - 1))
    xs = np.linspace(A[0, 0] - ext * span, A[-1, 0] + ext * span, n); rows = []
    for x in xs:
        y0 = np.polyval(co, x); lo, hi = int(y0 - band), int(y0 + band) + 1
        col = (V[max(0, lo):hi, int(round(x))] if not vertical else V[int(round(x)), max(0, lo):hi]).astype(int)
        d = np.where(col < dark)[0]
        if len(d) == 0: rows.append((x, y0, 0.0)); continue
        k = d[np.argmin(np.abs(d + max(0, lo) - y0))]; a_ = b_ = k          # the dark run nearest the path
        while a_ - 1 in d: a_ -= 1
        while b_ + 1 in d: b_ += 1
        rows.append((x, max(0, lo) + (a_ + b_) / 2, float(b_ - a_ + 1)))
    R = np.array(rows); ok = R[:, 2] > 0
    if ok.sum() >= 4:
        for _ in range(3):
            c2 = np.polyfit(R[ok, 0], R[ok, 1], 2); r = np.abs(np.polyval(c2, R[:, 0]) - R[:, 1])
            ok = ok & (r < max(2.0, 2.5 * np.median(r[ok])))
        R[:, 1] = np.polyval(c2, R[:, 0])
        med = np.median(R[ok, 2]); R[:, 2] = np.where(ok, np.minimum(R[:, 2], 1.8 * med), med)
        R[:, 2] = np.convolve(np.pad(R[:, 2], 2, mode='edge'), np.ones(5) / 5, mode='valid')
    else:
        R[:, 1] = np.polyval(co, R[:, 0]); R[:, 2] = 3.0
    R = R[:, [1, 0, 2]] if vertical else R
    return R.round(2).tolist()
V = hsv[..., 2]
out['brow_r'] = {'line': stroke(K[[5, 6, 7]], ext=0.05)}
out['brow_l'] = {'line': stroke(K[[8, 9, 10]], ext=0.05)}
nose_len = 0.35 * np.linalg.norm(K[23] - K[25])
out['nose'] = {'line': stroke(np.array([K[23] - [0, nose_len / 2], K[23], K[23] + [0, nose_len / 2]]), n=10, band=8, vertical=True)}
mouth_open = float(np.linalg.norm(K[27] - K[25]))
out['mouth'] = {'line': stroke(K[[24, 25, 26]], n=24, band=max(5.0, mouth_open + 4)), 'open_px': mouth_open,
                'corners': [K[24].tolist(), K[26].tolist()]}
for k in ('brow_r', 'brow_l', 'nose', 'mouth'):
    L = np.array(out[k]['line'])
    for x, y, t in L: cv2.line(check, (int(x), int(y - t / 2)), (int(x), int(y + t / 2)), (0, 255, 255), 1)
    print('FIG %s: %d samples, %.0f px long, %.1f-%.1f px thick' % (k, len(L), np.hypot(*np.ptp(L[:, :2], 0)), L[:, 2].min(), L[:, 2].max()))
json.dump(out, open(os.path.join(OUT, 'eyes.json'), 'w'), indent=1)
x0, y0, x1, y1 = [int(v) for v in pred['bbox'][:4]]
cv2.imwrite(os.path.join(OUT, 'eyes_check.png'), cv2.resize(check[y0 + (y1 - y0) // 6:y0 + (y1 - y0) // 2, x0:x1], None, fx=1.6, fy=1.6))
cv2.imwrite(os.path.join(OUT, 'face_check.png'), check[y0:y1, x0:x1])

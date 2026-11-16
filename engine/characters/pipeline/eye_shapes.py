"""Read each eye's shapes from a portrait (anime eyes): the opening, the iris, the pupil, the highlights, the upper lash.
usage: python eye_shapes.py <portrait.png> <out-dir>      (in the portrait tool's Python: anime-face-detector, MIT)
  The opening comes from anime-face-detector's 28 points (trained on anime faces; a detector trained on real faces puts
  its eye contour well inside an anime eye): per eye the outer corner, the lid's top, the inner corner and three points
  of the lower lid. Inside that outline the pixels give the iris (not the white: a tall dark oval, as one ellipse), the
  pupil (the iris's darkest part) and the highlights (white blobs on the iris); just above the upper lid, the lash band
  (its thickness per column, and the wing past the outer corner); just under the lower lid, the lower lid's line. (Reading
  the lash by darkness alone fails: the iris's top is as dark as the lashes.) Writes eyes.json in portrait pixels (also
  the 28 points, for brows, nose and mouth, and each eye's tones: the white's, the iris's, the pupil's and the highlights'
  brightness, which the organ step turns into the depth of each cut) and eyes_check.png.
  Every split of the pixels is the picture's own: white against not-white, the line ink against the skin, the pupil and the
  highlights against the iris (each half of the iris split again) are each the threshold that best separates the pixels
  at that place into two (Otsu); search bands reach half way to the neighbouring organ's detector points; fits
  are weighted by a Cauchy weight of each sample's miss over the median miss (no cut-off); lines run until their ink ends.
  Numbers kept: the 24 points per lid in the outline, 28 lash columns over the opening and 24 under it, 28 samples per brow,
  24 for the mouth (sampling); the 3 x 3 opening (the smallest structuring element: single-pixel specks); the polynomial
  degrees tried, 0 to 6 (chosen by leave-one-out cross-validation); the check pictures' crop."""
import json, os, sys
import cv2
import numpy as np
from anime_face_detector import create_detector
SRC, OUT = sys.argv[1:3]; os.makedirs(OUT, exist_ok=True)
img = cv2.imread(SRC); hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); Hh, Ww = img.shape[:2]
GREY = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(int)          # brightness as seen (luma): what reads dark
S, V = hsv[..., 1].astype(int), hsv[..., 2].astype(int)
pred = max(create_detector('yolov3', device='cpu')(img), key=lambda p: p['bbox'][4])
K = pred['keypoints'][:, :2]
check = img.copy(); out = {'points28': K.round(1).tolist()}

def otsu(vals):
    """the threshold that best splits these 0..255 values into two classes (Otsu); a pixel is above it or not"""
    v = np.clip(np.asarray(vals), 0, 255).astype(np.uint8).reshape(-1, 1)
    return float(cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0]) if len(v) else 128.0

def cauchy_poly(x, y, deg, w0=None):
    """a polynomial through (x, y), every sample weighted by a Cauchy weight of its miss over the median miss (outliers
    fade by themselves; no cut-off), iterated until the fit stops changing; returns (function, weights). x is centred
    and scaled to its own spread first (conditioning only)."""
    x = np.asarray(x, float); y = np.asarray(y, float); w0 = np.ones(len(x)) if w0 is None else np.asarray(w0, float)
    mu, sd = float(x.mean()), float(x.std()) or 1.0; t = (x - mu) / sd
    w = w0.copy(); co = np.polyfit(t, y, deg, w=np.sqrt(w))
    for _ in range(200):
        r = np.abs(np.polyval(co, t) - y); s = float(np.median(r[w0 > 0])) if (w0 > 0).any() else 0.0
        if s <= 1e-9: break
        w = w0 / (1 + (r / s) ** 2); c2 = np.polyfit(t, y, deg, w=np.sqrt(w))
        done = np.allclose(c2, co, rtol=1e-7, atol=1e-9); co = c2
        if done: break
    return (lambda q, co=co: np.polyval(co, (np.asarray(q, float) - mu) / sd)), w

def robust_poly(x, y, w0=None, max_deg=6):
    """cauchy_poly at the degree with the smallest leave-one-out miss (weighted by the fit's own weights)"""
    x = np.asarray(x, float); y = np.asarray(y, float); best = None
    mu, sd = float(x.mean()), float(x.std()) or 1.0; t = (x - mu) / sd
    for deg in range(0, max(0, min(max_deg, len(x) - 2)) + 1):
        f, w = cauchy_poly(x, y, deg, w0)
        A = np.vander(t, deg + 1); Wd = w / max(1e-12, w.max())
        H = A @ np.linalg.pinv((A * Wd[:, None]).T @ A) @ (A * Wd[:, None]).T
        e = (f(x) - y) / np.maximum(1e-6, 1 - np.diag(H)); cv = float(np.sum(Wd * e * e) / max(1e-12, Wd.sum()))
        if best is None or cv < best[0]: best = (cv, f, w)
    return best[1], best[2]

def runs(col_dark):
    """the dark runs of one column (start, end) of a boolean column"""
    d = np.where(col_dark)[0]
    if len(d) == 0: return []
    cut = np.where(np.diff(d) > 1)[0]; starts = np.r_[d[0], d[cut + 1]]; ends = np.r_[d[cut], d[-1]]
    return list(zip(starts, ends))

def column_run(x, y_ref, lo, hi, dark, vertical=False):
    """the dark run of the column at x between rows lo and hi nearest the row y_ref: (top, bottom) or None"""
    x_ = int(round(x)); lo, hi = max(0, int(np.floor(lo))), int(np.ceil(hi)) + 1
    if vertical:
        if not 0 <= x_ < Hh: return None
        hi = min(hi, Ww); col = GREY[x_, lo:hi]
    else:
        if not 0 <= x_ < Ww: return None
        hi = min(hi, Hh); col = GREY[lo:hi, x_]
    rs = runs(col < dark)
    if not rs: return None
    a, b = min(rs, key=lambda r: 0 if r[0] + lo <= y_ref <= r[1] + lo else min(abs(r[0] + lo - y_ref), abs(r[1] + lo - y_ref)))
    return float(a + lo), float(b + lo)

# the face's sideways reach: the jaw contour (detector points 0-4); a line may not run past it
JAW_X = (float(K[0:5, 0].min()), float(K[0:5, 0].max()))
def brow_over(E):
    """the eye's brow: the detector's brow nearer it sideways"""
    c = E[:, 0].mean(); return min((K[[5, 6, 7]], K[[8, 9, 10]]), key=lambda B: abs(B[:, 0].mean() - c))

# the 28 points: 0-4 jaw, 5-7 and 8-10 brows, 11-16 and 17-22 eyes (outer, top, inner, then the lower lid), 23 nose,
# 24-27 mouth. The two eyes: the one on the picture's left first.
EYES = {}
for name, ids in (('eye_r', (11, 12, 13, 16, 15, 14)), ('eye_l', (19, 18, 17, 20, 21, 22))):
    E = K[list(ids)]
    # a smooth outline through the six points: upper lid outer -> top -> inner, lower lid inner -> outer
    def spline(pts, n):
        t = np.linspace(0, 1, len(pts)); tt = np.linspace(0, 1, n)
        return np.stack([np.interp(tt, t, pts[:, 0]), np.interp(tt, t, pts[:, 1])], 1)
    upper = spline(E[[0, 1, 2]], 24); lower = spline(np.vstack([E[2], E[3], E[4], E[5], E[0]]), 24)
    outline = np.vstack([upper, lower[1:-1]])
    mask = np.zeros(img.shape[:2], np.uint8); cv2.fillPoly(mask, [outline.astype(np.int32)], 1); M = mask > 0
    # the white: unsaturated and bright, each split the opening's own (Otsu on the saturation, Otsu on the brightness)
    t_s, t_v = otsu(S[M]), otsu(V[M]); t_white = {'saturation': t_s, 'value': t_v}; white = M & (S < t_s) & (V > t_v)
    # the iris: the not-white inside the opening, opened to cut it from the lid's line where they touch; the opening's
    # size is the one whose iris ellipse best explains the not-white pixels (overlap over union), tried from the smallest
    # up to half the opening's height
    notwhite = (M & ~white).astype(np.uint8); best = None
    for k in range(1, max(2, int(np.ptp(outline[:, 1]) / 2)), 2):
        ir = cv2.morphologyEx(notwhite, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
        n, lb, st, _ = cv2.connectedComponentsWithStats(ir)
        if n < 2: break
        comp = (lb == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
        cs = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
        c_ = max(cs, key=cv2.contourArea)
        if len(c_) < 5: continue
        e_ = cv2.fitEllipse(c_); el = np.zeros_like(comp); cv2.ellipse(el, e_, 1, -1); el = (el > 0) & M
        iou = float((el & (notwhite > 0)).sum()) / max(1, (el | (notwhite > 0)).sum())
        if best is None or iou > best[0]: best = (iou, k, comp, c_, e_)
    _, k_open, iris, ic, ie = best
    # how far the iris's own outline strays from its ellipse (median, px): the slack of everything placed on that ellipse
    (ecx, ecy), (ea, eb), eang = ie; ca, sa = np.cos(np.radians(eang)), np.sin(np.radians(eang))
    d_ = ic[:, 0, :] - [ecx, ecy]; lx = d_[:, 0] * ca + d_[:, 1] * sa; ly = -d_[:, 0] * sa + d_[:, 1] * ca
    rn = np.hypot(lx / (ea / 2), ly / (eb / 2)); fit_px = float(np.median(np.abs(rn - 1) * np.hypot(lx, ly) / np.maximum(rn, 1e-6)))
    inside = np.zeros_like(iris); cv2.ellipse(inside, ie, 1, -1); IN = (inside > 0) & M
    # the iris's brightness split in two (Otsu): the highlights are the brighter class of the brighter half (and white).
    # The pupil sits at the iris's middle (the iris's own outline is dark too, at its rim) and is drawn in one flat tone:
    # the dark blob holding (else nearest) the iris's centre, at the darkness where that blob is most stable (its area
    # grows least from one brightness level to the next: a flat region's edge, the most stable region's criterion),
    # tried over every level of the darker half
    vi = V[IN]; t_mid = otsu(vi); t_bright = otsu(vi[vi >= t_mid])
    x0_, y0_, w_, h_ = cv2.boundingRect(np.argwhere(IN)[:, ::-1].astype(np.int32)); sl = (slice(y0_, y0_ + h_), slice(x0_, x0_ + w_))
    cen = (float(ie[0][0] - x0_), float(ie[0][1] - y0_)); levels = np.unique(vi[vi < t_mid]) + 0.5; blobs = []
    for t in levels:
        pm = cv2.morphologyEx((IN[sl] & (V[sl] < t)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        pcs = [c for c in cv2.findContours(pm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0] if len(c) >= 5]
        if not pcs: blobs.append(None); continue
        c_ = min(pcs, key=lambda c: max(0.0, -cv2.pointPolygonTest(c, cen, True)))
        blobs.append((max(0.0, -cv2.pointPolygonTest(c_, cen, True)), max(1.0, cv2.contourArea(c_)), c_, float(t)))
    cand = [(b[0] > 0, b[0], abs(n_[1] - b[1]) / b[1], b) for b, n_ in zip(blobs, blobs[1:]) if b is not None and n_ is not None]
    pc, t_dark = (None, None) if not cand else (lambda b: (b[2] + [x0_, y0_], b[3]))(min(cand, key=lambda c: c[:3])[3])
    pe = cv2.fitEllipse(pc) if pc is not None and len(pc) >= 5 else None
    # highlights: white blobs on the iris, searched over the iris ellipse widened by its own outline's slack (they sit on
    # its edge); the white touching the iris's sides is not a highlight: keep blobs mostly (a majority) inside the iris
    big = np.zeros_like(iris); cv2.ellipse(big, (ie[0], (ie[1][0] + 2 * fit_px, ie[1][1] + 2 * fit_px), ie[2]), 1, -1)
    hl = ((big > 0) & M & (V > t_bright) & white).astype(np.uint8)
    hl = cv2.morphologyEx(hl, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    hls = []; HL = np.zeros(img.shape[:2], bool)
    for h in sorted(cv2.findContours(hl, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=cv2.contourArea, reverse=True):
        if len(h) < 5: continue
        m2 = np.zeros_like(iris); cv2.drawContours(m2, [h], -1, 1, -1)
        if (m2 & inside).sum() > 0.5 * m2.sum(): hls.append(cv2.fitEllipse(h)); HL |= m2 > 0
    # the upper lash: the ink's dark run at the upper lid, per column; above it the band reaches up to the brow's line (the
    # detector's brow points), below it down to the iris's top (or the lower lid where the column misses the iris)
    span = np.ptp(E[:, 0]); B = brow_over(E); cb = np.polyfit(B[:, 0], B[:, 1], min(2, len(B) - 1))
    lid_y = lambda x: float(np.interp(x, *(upper[:, 0], upper[:, 1]) if upper[0, 0] < upper[-1, 0] else (upper[::-1, 0], upper[::-1, 1])))
    low_y = lambda x: float(np.interp(x, *(lower[:, 0], lower[:, 1]) if lower[0, 0] < lower[-1, 0] else (lower[::-1, 0], lower[::-1, 1])))
    ys_in, xs_in = np.nonzero(IN)
    def floor_y(x):
        on = ys_in[np.abs(xs_in - x) < 0.5]
        return float(on.min()) if len(on) else low_y(x)
    xs = np.linspace(E[2][0], E[0][0], 28); dx = xs[1] - xs[0]
    band_px = np.concatenate([GREY[max(0, int(np.polyval(cb, x))):max(1, int(floor_y(x))), int(round(x))] for x in xs if 0 <= int(round(x)) < Ww])
    t_ink = otsu(band_px)
    lash = []; prev = None; x = xs[0]; i = 0
    while True:
        if i < len(xs): x = xs[i]
        else:   # past the outer corner: follow the ink's run until it ends (the wing), at the same column spacing
            x = x + dx
            if not JAW_X[0] <= x <= JAW_X[1] or prev is None: break
        if i < len(xs): r = column_run(x, lid_y(x), np.polyval(cb, x), floor_y(x), t_ink)
        else:
            r = column_run(x, (prev[0] + prev[1]) / 2, np.polyval(cb, x), prev[1] + (prev[1] - prev[0] + 1), t_ink)
            # the wing ends where no ink overlaps the last column's, or where the run grows (more than the picture's one
            # pixel) instead of thinning: there the ink is the hair's, not the lash's
            if r is None or r[1] < prev[0] or r[0] > prev[1] or r[1] - r[0] > prev[1] - prev[0] + 1: break
        if r is not None: lash.append([float(x), (r[0] + r[1]) / 2, float(r[1] - r[0] + 1)]); prev = r
        i += 1
    # the lower lid's line: the same ink's run just under the lower lid, down at most half way to the nose point; a run
    # counts when it touches the lid within its own width (a line drawn on the lid)
    lower_line = []
    for x in np.linspace(E[2][0], E[0][0], 24)[1:-1]:
        yl = low_y(x); r = column_run(x, yl, yl, yl + (K[23][1] - yl) / 2, t_ink)
        if r is not None and r[0] - yl <= r[1] - r[0] + 1: lower_line.append([float(x), (r[0] + r[1]) / 2, float(r[1] - r[0] + 1)])
    # the tones (luma medians): the white, the iris's outer and inner halves (split half way between the pupil's edge and
    # the iris's), the pupil and the highlights
    yy, xx = np.nonzero(IN); d2 = np.stack([xx - ecx, yy - ecy], 1); lx2 = d2[:, 0] * ca + d2[:, 1] * sa; ly2 = -d2[:, 0] * sa + d2[:, 1] * ca
    rho = np.hypot(lx2 / (ea / 2), ly2 / (eb / 2))
    PU = np.zeros(img.shape[:2], bool)
    if pe is not None: pm = np.zeros_like(iris); cv2.ellipse(pm, pe, 1, -1); PU = (pm > 0) & IN
    prho = (np.sqrt(pe[1][0] * pe[1][1]) / np.sqrt(ea * eb)) if pe is not None else 0.0
    plain = ~PU[yy, xx] & ~HL[yy, xx]
    tone = lambda m: float(np.median(GREY[m])) if np.any(m) else None
    gi = GREY[yy, xx]
    tones = {'white': tone(white & ~HL), 'pupil': tone(PU) if pe is not None else None, 'highlight': tone(HL) if HL.any() else None,
             'iris_outer': float(np.median(gi[plain & (rho >= (1 + prho) / 2)])) if np.any(plain & (rho >= (1 + prho) / 2)) else None,
             'iris_inner': float(np.median(gi[plain & (rho < (1 + prho) / 2)])) if np.any(plain & (rho < (1 + prho) / 2)) else None}
    EYES[name] = dict(E=E, outline=outline, ie=ie, pe=pe, hls=hls, lash=lash, lower=lower_line, tones=tones, fit_px=fit_px, k_open=k_open,
                      thr={'white': t_white, 'pupil': t_dark, 'highlight': t_bright, 'ink': t_ink})
# an eye with no pupil found takes the other eye's pupil, as a share of its own iris (the eyes are a mirror pair); with
# neither, there is no pupil (the organ step leaves the hole out)
for name, other in (('eye_r', 'eye_l'), ('eye_l', 'eye_r')):
    a, b = EYES[name], EYES[other]
    if a['pe'] is None and b['pe'] is not None:
        sx, sy = b['pe'][1][0] / b['ie'][1][0], b['pe'][1][1] / b['ie'][1][1]
        off = np.subtract(b['pe'][0], b['ie'][0]) / np.array(b['ie'][1]) * np.array(a['ie'][1]) * [-1, 1]
        a['pe'] = ((a['ie'][0][0] + off[0], a['ie'][0][1] + off[1]), (a['ie'][1][0] * sx, a['ie'][1][1] * sy), a['ie'][2]); a['pupil_from'] = other
sh = lambda e: None if e is None else {'centre': [float(e[0][0]), float(e[0][1])], 'axes': [float(e[1][0] / 2), float(e[1][1] / 2)], 'angle': float(e[2])}
for name, d in EYES.items():
    E, ie, pe, hls, lash = d['E'], d['ie'], d['pe'], d['hls'], d['lash']
    out[name] = {'corners': {'outer': E[0].tolist(), 'top': E[1].tolist(), 'inner': E[2].tolist()}, 'outline': d['outline'].round(1).tolist(),
                 'iris': dict(sh(ie), fit_px=round(d['fit_px'], 2)), 'pupil': sh(pe), 'highlights': [sh(h) for h in hls], 'upper_lash': lash,
                 'lower_line': d['lower'], 'tones': d['tones'], 'thresholds': d['thr']}
    if 'pupil_from' in d: out[name]['pupil_from'] = d['pupil_from']
    cv2.polylines(check, [d['outline'].astype(np.int32)], True, (0, 255, 0), 1)
    cv2.ellipse(check, ie, (255, 0, 255), 1)
    if pe is not None: cv2.ellipse(check, pe, (0, 0, 255), 1)
    for h in hls: cv2.ellipse(check, h, (255, 255, 0), 1)
    for x, y, t in lash + d['lower']: cv2.line(check, (int(x), int(y - t / 2)), (int(x), int(y + t / 2)), (0, 165, 255), 1)
    th = [t for *_, t in lash]
    print('FIG %s: opening %.0f px wide; iris %.0f x %.0f px (open %d px, outline slack %.1f px); pupil %s; %d highlights; lash over %d columns, %.0f-%.0f px thick; lower line over %d columns; tones %s'
          % (name, np.ptp(E[:, 0]), ie[1][0], ie[1][1], d['k_open'], d['fit_px'], 'none' if pe is None else '%.0f x %.0f' % pe[1],
             len(hls), len(lash), min(th + [0]), max(th + [0]), len(d['lower']), {k: v if v is None else round(v) for k, v in d['tones'].items()}))
# the other organs as strokes: the brows (5-7, 8-10), the nose (23) and the mouth (24-27). Each stroke's path starts at
# the detector's points and is refined by the ink's dark run across it, column by column (row by row for the nose), with
# its thickness there, and runs on past the points while the ink does; strands of hair crossing a brow give outliers, so
# the path and the thickness are robust fits (Cauchy weights). The band searched across the stroke reaches half way to the
# neighbouring organ; the ink's darkness is the band's own split (Otsu).
def stroke(P, band, n=28, vertical=False, step=None):
    P = np.asarray(P, float); A = P[:, ::-1] if vertical else P            # work as y(x); the nose as x(y)
    o = np.argsort(A[:, 0]); A = A[o]
    co = np.polyfit(A[:, 0], A[:, 1], min(2, len(np.unique(A[:, 0])) - 1))
    xs = list(np.linspace(A[0, 0], A[-1, 0], n)) if np.ptp(A[:, 0]) > 0 else [A[0, 0]]
    dx = step or (xs[1] - xs[0] if len(xs) > 1 else 1.0)
    dark = otsu(np.concatenate([(GREY[max(0, int(np.polyval(co, x) - band)):int(np.polyval(co, x) + band) + 1, int(round(x))] if not vertical
                                 else GREY[int(round(x)), max(0, int(np.polyval(co, x) - band)):int(np.polyval(co, x) + band) + 1]) for x in xs
                                if 0 <= int(round(x)) < (Hh if vertical else Ww)]))
    rows = {}
    for x in xs:
        y0 = np.polyval(co, x); r = column_run(x, y0, y0 - band, y0 + band, dark, vertical)
        rows[x] = (x, y0, 0.0) if r is None else (x, (r[0] + r[1]) / 2, r[1] - r[0] + 1)
    # past each end: on while the ink's run continues (overlapping the last one), inside the face
    reach = (JAW_X if not vertical else (float(K[[11, 13, 17, 19], 1].min()), float(K[[24, 25, 26], 1].min())))
    tmax = max([t for *_, t in rows.values()] + [0.0])
    for sgn, x_end in ((-1, xs[0]), (1, xs[-1])):
        last = rows[x_end]; x = x_end
        while last[2] > 0:
            x = x + sgn * dx
            if not reach[0] <= x <= reach[1]: break
            r = column_run(x, last[1], last[1] - last[2], last[1] + last[2], dark, vertical)
            if r is None or r[1] - r[0] + 1 > tmax or r[1] < last[1] - last[2] / 2 or r[0] > last[1] + last[2] / 2: break
            last = (x, (r[0] + r[1]) / 2, r[1] - r[0] + 1); rows[x] = last
    R = np.array([rows[x] for x in sorted(rows)]); ok = R[:, 2] > 0
    if ok.sum() >= 4:
        f2, _ = robust_poly(R[:, 0], R[:, 1], w0=ok.astype(float)); R[:, 1] = f2(R[:, 0])
        ft, wt = robust_poly(R[:, 0], R[:, 2], w0=ok.astype(float)); a_ = wt / max(1e-12, wt[ok].max())
        R[:, 2] = np.where(ok, a_ * R[:, 2] + (1 - a_) * ft(R[:, 0]), ft(R[:, 0]))   # a thickness the fit doubts leans to the fit
        # smoothed over the stroke's own width (its thickness cannot change faster than that), in samples
        sp = float(np.median(np.diff(R[:, 0]))) if len(R) > 1 else 1.0; win = max(1, int(round(np.median(R[ok, 2]) / max(1e-6, sp))) | 1)
        if win > 1 and len(R) > win: R[:, 2] = np.convolve(np.pad(R[:, 2], win // 2, mode='edge'), np.ones(win) / win, mode='valid')
        R[:, 2] = np.maximum(R[:, 2], 0.0)
    else:
        R[:, 1] = np.polyval(co, R[:, 0]); R[:, 2] = np.nan                  # no ink: the thickness comes from the others
    R = R[:, [1, 0, 2]] if vertical else R
    return R
half = lambda a, b: abs(float(b) - float(a)) / 2
def eye_top_near(B):
    c = B[:, 0].mean(); return min((K[12], K[18]), key=lambda p: abs(p[0] - c))
SK = {}
for k, ids in (('brow_r', [5, 6, 7]), ('brow_l', [8, 9, 10])):
    B = K[ids]; SK[k] = stroke(B, half(B[:, 1].mean(), eye_top_near(B)[1]))
nm = half(K[23][1], K[25][1])                                           # the nose point to the mouth's top
SK['nose'] = stroke(np.array([K[23], K[23]]), nm, n=1, vertical=True, step=1.0)
mouth_open = float(np.linalg.norm(K[27] - K[25]))
SK['mouth'] = stroke(K[[24, 25, 26]], nm, n=24)
# a stroke without ink takes the median thickness of the strokes that have it (or of the lashes)
have = np.concatenate([L[~np.isnan(L[:, 2]), 2] for L in SK.values()] + [np.zeros(0)])
fill = float(np.median(have)) if len(have) else float(np.median([t for d in EYES.values() for *_, t in d['lash']]))
for k, L in SK.items():
    L[np.isnan(L[:, 2]), 2] = fill
out['brow_r'] = {'line': SK['brow_r'].round(2).tolist()}
out['brow_l'] = {'line': SK['brow_l'].round(2).tolist()}
out['nose'] = {'line': SK['nose'].round(2).tolist()}
out['mouth'] = {'line': SK['mouth'].round(2).tolist(), 'open_px': mouth_open, 'corners': [K[24].tolist(), K[26].tolist()]}
for k in ('brow_r', 'brow_l', 'nose', 'mouth'):
    L = np.array(out[k]['line'])
    for x, y, t in L: cv2.line(check, (int(x), int(y - t / 2)), (int(x), int(y + t / 2)), (0, 255, 255), 1)
    print('FIG %s: %d samples, %.0f px long, %.1f-%.1f px thick' % (k, len(L), np.hypot(*np.ptp(L[:, :2], 0)), L[:, 2].min(), L[:, 2].max()))
json.dump(out, open(os.path.join(OUT, 'eyes.json'), 'w'), indent=1)
x0, y0, x1, y1 = [int(v) for v in pred['bbox'][:4]]
cv2.imwrite(os.path.join(OUT, 'eyes_check.png'), cv2.resize(check[y0 + (y1 - y0) // 6:y0 + (y1 - y0) // 2, x0:x1], None, fx=1.6, fy=1.6))
cv2.imwrite(os.path.join(OUT, 'face_check.png'), check[y0:y1, x0:x1])

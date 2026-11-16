"""Read a clean front view of a character: its outline, its joints, its flat colour blocks.
usage: prep_view.py <front.png> <out-dir>
Writes view.json (bbox, joints, palette, which colour is hair and skin) and labels.png (a palette index per pixel,
every pixel filled with its nearest figure colour so projection never lands on the background).
Nothing here is a tuned number: the background level, the number of colours, which colours are one, the line art's width,
which colours are shadow tones of another and where hair and skin are are all read from the picture and the detectors.
Numeric constants left: the 20000-pixel sample the colour model is fitted on and its seed, the 1/12 level^2 floor of a
colour's variance (8-bit rounding), EM's stopping change and 100-iteration cap (scikit-learn's defaults), the 1..24 range
of mixture sizes tried (BIC keeps falling slowly to the top of it on a drawing's soft shading: the unimodality merge,
not the size, decides the colours), the 3x3 opening (one pixel), the 101 steps of the unimodality test, the one pass of
the mode filter. The median splits (flat half / edge half of the figure) are statistics of the picture."""
import json, os, sys
import cv2, numpy as np

def otsu(v):
    """the split of a set of numbers into two groups with the most between-group variance (no parameter)"""
    v = np.sort(np.asarray(v, np.float64).ravel()); n = len(v)
    if n < 2 or v[0] == v[-1]: return float(v[0]) if n else 0.0
    c = np.cumsum(v); i = np.arange(1, n); m0, m1 = c[:-1] / i, (c[-1] - c[:-1]) / (n - i)
    k = int(np.argmax(i * (n - i) * (m0 - m1) ** 2)); return float((v[k] + v[k + 1]) / 2)

def figure_mask(img):
    """the figure: everything but the paper connected to the picture's border. The paper's level is the upper Otsu split
    of the lightness (first figure against light, then within the light: light colours of the figure against the paper),
    so white clothes inside the line art stay. Detached bits are kept while they are of the figure's size order: the
    components' areas are cut at their largest ratio gap (the figure and its props against specks)."""
    h, w = img.shape[:2]; m = img.min(axis=2)
    t1 = otsu(m); t2 = otsu(m[m > t1]) if (m > t1).sum() > 1 else t1
    paper = (m > t2).astype(np.uint8)
    n, cc = cv2.connectedComponents(paper)
    border = np.unique(np.concatenate([cc[0], cc[-1], cc[:, 0], cc[:, -1]])); border = border[border > 0]
    fg = (~np.isin(cc, border)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
    area = st[1:, cv2.CC_STAT_AREA]; order = np.argsort(-area)
    if len(order) > 1:
        a = area[order].astype(float); cut = int(np.argmax(np.log(a[:-1] / a[1:]))) + 1; keep = 1 + order[:cut]
    else: keep = 1 + order
    return np.isin(lab, keep).astype(np.uint8), t2

# ── a Gaussian mixture in Lab, its size picked by BIC ──
FLOOR = np.eye(3) / 12.0                 # 8-bit rounding: a colour's variance is never below 1/12 level^2 per axis
def logpdf(X, mu, cov):
    d = X - mu; inv = np.linalg.inv(cov); _, ld = np.linalg.slogdet(cov)
    return -0.5 * (((d @ inv) * d).sum(1) + ld + 3 * np.log(2 * np.pi))
def fit_gmm(X, K):
    cv2.setRNGSeed(0)
    _, l, _ = cv2.kmeans(X.astype(np.float32), K, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    R = np.eye(K)[l.ravel()]; prev = -np.inf
    for _ in range(100):                 # EM to a mean log-likelihood change of 1e-3 (scikit-learn's defaults)
        nk = R.sum(0) + 1e-9; wts = nk / len(X); mu = R.T @ X / nk[:, None]
        cov = np.stack([((R[:, k:k + 1] * (X - mu[k])).T @ (X - mu[k])) / nk[k] + FLOOR for k in range(K)])
        lp = np.stack([np.log(wts[k]) + logpdf(X, mu[k], cov[k]) for k in range(K)], 1)
        mx = lp.max(1, keepdims=True); ll = float((mx[:, 0] + np.log(np.exp(lp - mx).sum(1))).sum())
        R = np.exp(lp - mx); R /= R.sum(1, keepdims=True)
        if ll - prev < 1e-3 * len(X): break
        prev = ll
    return wts, mu, cov, ll
def mix_density(P, comps, wts, mu, cov):
    return sum(wts[k] * np.exp(logpdf(P, mu[k], cov[k])) for k in comps)

def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    img = cv2.imread(src, cv2.IMREAD_COLOR); h, w = img.shape[:2]
    fg, paper_level = figure_mask(img)
    ys, xs = np.nonzero(fg); bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    labimg = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float64)
    # the colour model is fitted on the flat insides of the colour blocks (the half of the figure with the least colour
    # change around it: no line art edges, no soft transitions), so its components are the drawn colours
    lab32 = labimg.astype(np.float32)
    grad = np.sqrt((cv2.Sobel(lab32, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(lab32, cv2.CV_32F, 0, 1) ** 2).sum(-1))
    flatm = (fg == 1) & (grad <= np.median(grad[fg == 1])); flat = labimg[flatm]
    rng = np.random.default_rng(0); X = flat[rng.choice(len(flat), min(len(flat), 20000), replace=False)]
    # how many colours: the mixture size with the lowest BIC (log-likelihood against 10 numbers per colour)
    best = None
    for K in range(1, 25):
        wts, mu, cov, ll = fit_gmm(X, K); bic = -2 * ll + (10 * K - 1) * np.log(len(X))
        if best is None or bic < best[0]: best = (bic, K, wts, mu, cov)
    _, K, wts, mu, cov = best
    # which components are one colour: two groups are one when the mixture of the two has no dip on the line between
    # their peaks (one hill: a gradient, a soft edge); a dip means two flat colours (Ray & Lindsay's unimodality)
    groups = [[k] for k in range(K)]
    def peak(g): return mu[max(g, key=lambda k: wts[k] * np.exp(logpdf(mu[k:k + 1], mu[k], cov[k]))[0])]
    t = np.linspace(0, 1, 101)[:, None]
    while len(groups) > 1:
        cand = []
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                pa, pb = peak(groups[a]), peak(groups[b]); f = mix_density(pa + t * (pb - pa), groups[a] + groups[b], wts, mu, cov)
                top = int(np.argmax(f)); eps = 1e-12 * f[top]
                if np.all(np.diff(f[:top + 1]) >= -eps) and np.all(np.diff(f[top:]) <= eps):
                    cand.append((f.min() / f[top], a, b))            # the flattest pair (least drop) first
        if not cand: break
        _, a, b = max(cand); groups[a] += groups[b]; del groups[b]
    G = len(groups)
    def hexes(c): return ['#%02x%02x%02x' % tuple(v) for v in cv2.cvtColor(np.clip(c, 0, 255).reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB).reshape(-1, 3)]
    if os.environ.get('PREP_DEBUG'): print('DBG mixture', hexes(mu), 'groups', groups)
    # every flat pixel to the colour with the most posterior mass; edge pixels (line art, soft transitions) are no colour
    # of their own (far from every component, they would go to the broadest one): they take their nearest flat pixel's
    lp = np.stack([np.log(wts[k]) + logpdf(flat, mu[k], cov[k]) for k in range(K)], 1); lp = np.exp(lp - lp.max(1, keepdims=True))
    gl = np.stack([lp[:, g].sum(1) for g in groups], 1).argmax(1).astype(np.uint8)
    L = np.full((h, w), 255, np.uint8); L[flatm] = gl
    _, near = cv2.distanceTransformWithLabels((~flatm).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lookup = np.zeros(near.max() + 1, np.uint8); lookup[near[flatm]] = gl
    L = np.where(fg == 1, lookup[near], 255).astype(np.uint8)
    cent = np.array([np.median(flat[gl == i], 0) if (gl == i).any() else peak(groups[i]) for i in range(G)])
    # the line art's width: the figure's edges (the half with the most colour change around it) form bands as wide as
    # a stroke; twice the distance to the band's side along its middle (ridge), median over the figure
    edge = ((fg == 1) & (grad > np.median(grad[fg == 1]))).astype(np.uint8)
    dt = cv2.distanceTransform(edge, cv2.DIST_L2, 5)
    ridge = (dt > 0) & (dt >= cv2.dilate(dt, np.ones((3, 3), np.uint8)))
    stroke = 2 * float(np.median(dt[ridge])) if ridge.any() else 1.0
    # wipe the line art and specks with a mode filter whose window is wide enough that the colours on both sides of a
    # stroke outvote it (window > 3 strokes); one pass: repeating it eats narrow regions (a T-pose's small face)
    k = int(np.floor(3 * stroke)) + 1; k += 1 - k % 2
    votes = np.stack([cv2.blur((L == i).astype(np.float32), (k, k)) for i in range(len(cent))], -1)
    L = np.where(fg == 1, votes.argmax(-1), 255).astype(np.uint8)
    # colours that are nowhere as wide as that window are left-over detail (line art, glints): to the nearest kept colour
    keepi = [i for i in range(len(cent)) if (L == i).any() and cv2.distanceTransform((L == i).astype(np.uint8), cv2.DIST_L2, 5).max() * 2 >= k]
    if len(keepi) < len(cent):
        kept = np.isin(L, keepi)
        _, near = cv2.distanceTransformWithLabels((~kept).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        lookup = np.zeros(near.max() + 1, np.int64); lookup[near[kept]] = L[kept]
        L = np.where(fg == 1, np.where(kept, L, lookup[near]), 255).astype(np.uint8)
        remap = np.full(256, 255, np.uint8); remap[keepi] = np.arange(len(keepi)); L = remap[L]; cent = cent[keepi]
    if os.environ.get('PREP_DEBUG'): print('DBG before fold', hexes(cent), [int((L == i).sum()) for i in range(len(cent))])
    L, cent = fold_shades(img, fg, L, cent, k)
    counts = np.array([(L == i).sum() for i in range(len(cent))])
    # joints (RTMPose body, any drawing style): the person found with the highest mean confidence
    from rtmlib import Body, Wholebody
    kps, scores = Body(mode='balanced', backend='onnxruntime', device='cpu')(img)
    p = int(np.argmax(scores.mean(1)))
    NAMES = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_sho', 'r_sho', 'l_elb', 'r_elb', 'l_wri', 'r_wri', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ank', 'r_ank']
    joints = {n: [float(x), float(y), float(s)] for n, (x, y), s in zip(NAMES, kps[p], scores[p])}
    # hair and skin from the face's 68 points (RTMW): skin is the colour covering the face below the nose, inside the jaw;
    # hair is the colour other than skin covering the head above the brows, across the jaw's width
    hair, skin = face_colours(img, L, fg, len(cent), Wholebody)
    # fill the background with the nearest figure colour (projection never misses)
    _, near = cv2.distanceTransformWithLabels((fg == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lookup = np.zeros(near.max() + 1, np.int64); lookup[near[fg == 1]] = L[fg == 1]
    Lfull = np.where(fg == 1, L, lookup[near]).astype(np.uint8)
    cv2.imwrite(os.path.join(out, 'labels.png'), Lfull); np.save(os.path.join(out, 'labels.npy'), Lfull); np.save(os.path.join(out, 'mask.npy'), fg.astype(np.uint8))
    rgb = cv2.cvtColor(np.clip(cent, 0, 255).reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB).reshape(-1, 3)
    palette = ['#%02x%02x%02x' % tuple(int(c) for c in col) for col in rgb]
    prev = np.full((h, w, 3), 255, np.uint8); prev[fg == 1] = rgb[L[fg == 1]][:, ::-1]
    cv2.imwrite(os.path.join(out, 'blocks.png'), prev)
    json.dump({'image': os.path.abspath(src), 'size': [w, h], 'bbox': bbox, 'joints': joints, 'palette': palette,
               'coverage': [round(float(c) / fg.sum(), 4) for c in counts], 'hair': hair, 'skin': skin,
               'measured': {'paper_level': round(paper_level, 1), 'mixture_size': K, 'colours': G, 'stroke_px': round(stroke, 2), 'mode_window': k}},
              open(os.path.join(out, 'view.json'), 'w'), indent=1)
    print('palette', palette, 'hair', hair, palette[hair], 'skin', skin, palette[skin], 'bbox', bbox, 'mixture', K, 'colours', G, 'stroke', round(stroke, 2), 'window', k)

def fold_shades(img, fg, L, cent, k):
    """fold drawn shadow tones into their base colour. Shading darkens a colour by a factor (the same hue and saturation
    in linear light), so a shade lies on the line from black to its base: it is folded when its offset from that line is
    within the two colours' own pixel scatter off the line, it is darker and smaller than the base (overall and in its
    biggest patch: a region such as a dark jacket is never a shade of its light trim), and the base is what it touches
    most (the paper around the figure counted too: a hair bun against the sky is no shadow on the face), and no ink
    line is drawn where they meet (a drawn border separates two parts; a cel shadow's edge is just the two fills). Only
    colours with a hue take part (their Lab chroma beyond their own pixels' scatter in a, b): black, greys and white lie
    on every colour's line, so a black shoe would read as anyone's shadow. All colours are judged once, on their own pixels,
    and a shade of a shade goes to the first base."""
    lin = np.where(img / 255.0 <= 0.04045, img / 255.0 / 12.92, ((img / 255.0 + 0.055) / 1.055) ** 2.4)[..., ::-1]
    n = len(cent); masks = [L == i for i in range(n)]; area = np.array([m.sum() for m in masks])
    P = [lin[m] for m in masks]; C = np.array([np.median(p, 0) if len(p) else np.zeros(3) for p in P])
    big = np.array([cv2.connectedComponentsWithStats(m.astype(np.uint8))[2][1:, cv2.CC_STAT_AREA].max() if m.any() else 0 for m in masks])
    def off(p, c, u): d = p - c; return np.linalg.norm(d - (d @ u)[:, None] * u, axis=-1)
    ab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[..., 1:].astype(np.float64) - 128      # hue is judged perceptually (Lab)
    def hue_shows(m):
        q = ab[m]; c = np.median(q, 0); return np.linalg.norm(c) > np.median(np.linalg.norm(q - c, axis=1))
    hued = np.array([bool(m.any()) and hue_shows(m) for m in masks])
    Limg = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float64)
    win = np.ones((k, k), np.uint8)
    def inked(j, i):
        """is the meeting of j and i drawn with a line? within a filter window of the contact, count the pixels darker
        than the darker colour by more than its own scatter: a drawn border (hair against the face) has at least one per
        pixel of contact, a cel shadow's edge (no ink, the two fills meet) has next to none"""
        contact = cv2.dilate(masks[j].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & masks[i]
        if not contact.any(): return False
        band = cv2.dilate(contact.astype(np.uint8), win).astype(bool) & (fg == 1)
        lj = Limg[masks[j]]; mj = np.median(lj); sj = np.median(np.abs(lj - mj))
        return (Limg[band] < mj - sj).sum() >= contact.sum()
    to = list(range(n))
    for j in range(n):
        if not area[j] or not hued[j]: continue
        ring = cv2.dilate(masks[j].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~masks[j]
        nb = np.bincount(L[ring], minlength=256)                          # 255: the paper around the figure
        best = None
        for i in range(n):
            if i == j or not hued[i] or area[i] <= area[j] or big[i] <= big[j]: continue
            u = C[i] / (np.linalg.norm(C[i]) + 1e-12); s = C[j] @ u
            if s >= C[i] @ u: continue                                          # not darker along the base's line
            r = np.linalg.norm(C[j] - s * u)
            spread = np.hypot(np.median(off(P[i], C[i], u)), np.median(off(P[j], C[j], u)))
            if r <= spread and nb.argmax() == i and not inked(j, i) and (best is None or r / spread < best[0]): best = (r / spread, i)
        if best:
            to[j] = best[1]
            if os.environ.get('PREP_DEBUG'): print('DBG fold', j, '->', best, C[j].round(3), C[best[1]].round(3))
    for j in range(n):
        while to[to[j]] != to[j]: to[j] = to[to[j]]
    L = np.where(L == 255, 255, np.array(to + [0] * (256 - n), np.uint8)[L]).astype(np.uint8)
    used = [i for i in range(n) if (L == i).any()]
    remap = np.full(256, 255, np.uint8); remap[used] = np.arange(len(used)); return remap[L], cent[used]

def face_colours(img, L, fg, n, Wholebody):
    kps, sc = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')(img)
    p = int(np.argmax(sc[:, 23:91].mean(1))); k = kps[p]
    jaw, brows, nose = k[23:40], k[40:50], k[50:59]           # COCO-WholeBody face: jaw 0-16, brows 17-26, nose 27-35
    h, w = L.shape
    hull = np.zeros((h, w), np.uint8); cv2.fillConvexPoly(hull, cv2.convexHull(jaw.round().astype(np.int32)), 1)
    yy, xx = np.mgrid[:h, :w]
    lower_face = (hull == 1) & (yy > nose[:, 1].mean()) & (fg == 1)
    above_brows = (yy < brows[:, 1].min()) & (xx >= jaw[:, 0].min()) & (xx <= jaw[:, 0].max()) & (fg == 1)
    def major(m, but=255): v = L[m]; v = v[(v != 255) & (v != but)]; return int(np.bincount(v, minlength=n).argmax()) if len(v) else 0
    skin = major(lower_face)
    return major(above_brows, but=skin), skin           # the forehead is skin: hair is the head's other colour

if __name__ == '__main__':
    main()

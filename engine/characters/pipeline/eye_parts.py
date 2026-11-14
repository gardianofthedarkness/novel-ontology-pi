"""Build the face's organs on a figure's head from the portrait, automatically: each is read from the portrait (eye_shapes.py)
and built as a basic structure aligned to the head, the same way for every character.
  eyes   carved relief (below); brows  ridges along the drawing's strokes;
  nose   the face's own structure: the cheek planes meeting in a bridge ridge down to a sharp tip and a short underside,
         its tip and height the head's own nose, rebuilt in the face's triangles (nose_structure, stitch_face);
  mouth  the drawing's line as a strip on the skin, thin in the middle and heavier toward the corners (ink).
usage: blender -b <figure.blend> -P eye_parts.py -- <eyes.json> <render-dir> <out.blend> [--seg=40] [--bulge=1.6]
        [--organs=eyes,brows,nose,mouth]
  <eyes.json>: eye_shapes.py (portrait pixels). <render-dir>: face_marks.py's marks.json (the portrait's 68 points, to
  fit the portrait onto the head's face points). The head stays as it is (v0.7's triangles); the eyes are their own quads.
  A sculptor shows an eye in plain stone by form alone, not colour: the eyeball bulges, the iris is a cut ring with a
  shallow dish, the pupil a drilled hole (it reads dark because it is deep), the highlight a bump left standing, the lids
  rims with thickness. The eyes here are built the same way, so a one-colour hologram or a white render can show them:
    faired surface  everything sits on a smooth surface fitted to the skin around the eye (hair skipped);
    socket          the head's skin inside the opening pushed 0.5 mm behind that surface (the sculptor's cut socket), so
                    the eye sits in the face rather than standing proud of it; only the head's triangles hidden under the
                    eye are split for it (the visible skin keeps its own triangle size); eye points the skin still covers
                    (the lash wing where the face curves back) are then moved out in front of it, the shift spread smoothly;
    opening         two smooth lid curves (upper, lower) that meet at the inner and outer corners as sharp nodes;
    eyeball         the white: a dome inside the opening, from the lid line up to --bulge mm at its middle;
    iris            a cut: a step down at the iris's edge (an oval clipped by the lids), then a dish sinking toward the pupil;
    pupil           a drilled hole: a second step down and a flat floor;
    highlights      bumps standing in front of the iris;
    upper lid       the lash: a bar along the upper lid curve with a smooth thickness profile and a wing, ends pinched;
    lower lid       a thin rounded rim along the lower lid curve, pinched at both corners.
  One mesh Eyes_quad on the head bone, a material per part (eye_white, eye_iris, eye_pupil, eye_highlight, eye_lid), and a
  UV map 'lines' marking the quad loops the hologram draws (u = a shown ring, v = a shown radial), spaced like the head's
  triangles; the viewer adds the cuts and part edges."""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
EYES, RDIR, OUT = [a for a in argv if not a.startswith('--')][:3]
SEG = int(flags.get('seg', 40)); MM = 0.001; BULGE = float(flags.get('bulge', 1.6))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; head = bpy.data.objects.get('Head') or bpy.data.objects['Head_quad']
F = json.loads(rig['figure_face']); M3 = {int(k): np.array(v) for k, v in F['marks'].items()}
eyes = json.load(open(EYES)); marks = json.load(open(os.path.join(RDIR, 'marks.json')))
pp = np.array([p[:2] for p in marks['portrait']['points']]); mp = np.array([[M3[i][0], M3[i][2]] for i in range(68)])
src = np.stack([pp[:, 0], -pp[:, 1]], 1); mu_s, mu_d = src.mean(0), mp.mean(0); S0, D0 = src - mu_s, mp - mu_d
U, sig, Vt = np.linalg.svd(D0.T @ S0); Rm = U @ Vt; scale = sig.sum() / (S0 ** 2).sum(); tr = mu_d - scale * Rm @ mu_s
def to_xz(u, v): q = scale * (Rm @ np.array([u, -v])) + tr; return float(q[0]), float(q[1])
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
# which of the head's faces are hair (its hair chains' weights): a ray to the skin passes through them
_hn = {g.index: g.name for g in head.vertex_groups}
_vh = [sum(g.weight for g in v.groups if _hn[g.group].startswith('hair')) for v in head.data.vertices]
HAIRY = [max(_vh[i] for i in p.vertices) > 0.3 for p in head.data.polygons]
def first_skin(tree, hairy, x, z, sheet=0.006):
    """the skin along a ray from the front: past faces weighted to hair chains, and past thin sheets (a front face with a
    back face less than 6 mm behind it: a lock of bangs not weighted as hair, as on a character whose bangs are fused)"""
    o = Vector((x, -1.0, z)); hits = []
    for _ in range(16):
        loc, nrm, fi, d = tree.ray_cast(o, Vector((0, 1, 0)))
        if loc is None: break
        hits.append((loc, nrm, fi)); o = loc + Vector((0, 1e-4, 0))
    for k, (loc, nrm, fi) in enumerate(hits):
        if hairy(fi) or nrm.y > 0: continue                      # hair, or a back face
        nxt = hits[k + 1] if k + 1 < len(hits) else None
        if nxt is not None and nxt[1].y > 0 and nxt[0].y - loc.y < sheet: continue   # a thin sheet in front of the face
        return loc
    return None
def skin_hit(x, z): return first_skin(bvh, lambda fi: fi is not None and fi < len(HAIRY) and HAIRY[fi], x, z)
bm = bmesh.new()
MAT = {'white': 0, 'iris': 1, 'pupil': 2, 'highlight': 3, 'lid': 4, 'brow': 5, 'nose': 6, 'lip': 7, 'mouth': 8, 'inner': 9, 'teeth': 10, 'skin': 11}
ORGANS = set(flags.get('organs', 'eyes,brows,nose,mouth').split(','))   # all by default; a subset to build only some
STITCH = []     # face regions rebuilt as structure (the nose): outline level, target surface, structural lines
BRIDGE = {}     # the rebuilt region's copies of the face's rim points -> the head's point (same place, same weights)
PIN = set()     # points on the face's own surface (rim copies, the rebuilt region): the settle pass leaves them
STEINER = set() # the rebuilt region's own points (their weights blend from the rim)

def faired_surface(box):
    """depth y as a quadratic in (x, z) fitted to the skin around the eye: the eye's own smooth, round surface"""
    (u0, v0, u1, v1) = box; pts = []
    for u in np.linspace(u0, u1, 14):
        for v in np.linspace(v0, v1, 10):
            x, z = to_xz(u, v); hit = skin_hit(x, z)
            if hit is not None: pts.append((x, z, hit.y))
    P = np.array(pts); A = np.stack([np.ones(len(P)), P[:, 0], P[:, 1], P[:, 0] ** 2, P[:, 0] * P[:, 1], P[:, 1] ** 2], 1)
    # robust: hits on bangs or a lock hanging in front of the face stand out from the skin; refit without them
    keep = np.ones(len(P), bool)
    for _ in range(5):
        c = np.linalg.lstsq(A[keep], P[keep, 2], rcond=None)[0]
        r_all = np.abs(A @ c - P[:, 2])
        keep = r_all < max(1.5 * MM, 2.5 * np.median(r_all[keep]))
    res = r_all[keep]
    def surf_y(x, z): return c[0] + c[1] * x + c[2] * z + c[3] * x * x + c[4] * x * z + c[5] * z * z
    shift = [0.0]
    def at(u, v, lift):
        x, z = to_xz(u, v); y = surf_y(x, z)
        n = Vector((-(c[1] + 2 * c[3] * x + c[4] * z), 1.0, -(c[2] + c[4] * x + 2 * c[5] * z))).normalized()
        return Vector((x, y, z)) - n * (lift + shift[0])       # the face is at -y: out of the surface is -n
    def clear_skin(points2d):
        """move the surface out as a whole until no skin point inside the eye is in front of it"""
        d = [surf_y(*to_xz(u, v)) - h.y for u, v in points2d for h in [skin_hit(*to_xz(u, v))] if h is not None]
        return float(max(d + [0.0]))
    clear_skin.reset = lambda: None
    return at, clear_skin, float(np.median(res)), float(res.max()), float(keep.mean())

def inside(poly, pt):
    """point in polygon (crossing count)"""
    x, y = pt; X, Y = poly[:, 0], poly[:, 1]; X2, Y2 = np.roll(X, -1), np.roll(Y, -1)
    cross = ((Y > y) != (Y2 > y)) & (x < X + (y - Y) * (X2 - X) / (Y2 - Y + 1e-12))
    return bool(cross.sum() % 2)

def lid_curves(e, n_half):
    """the upper and the lower lid as smooth curves from the outer corner to the inner corner, the corners exact nodes"""
    O = np.array(e['outline']); A = np.array(e['corners']['outer']); B = np.array(e['corners']['inner'])
    up, lo = O[1:23], O[24:]               # eye_shapes: upper lid (outer -> top -> inner, 24 points), then the lower lid
    def fit(P):
        x = np.r_[A[0], P[:, 0], B[0]]; y = np.r_[A[1], P[:, 1], B[1]]; w = np.r_[30.0, np.ones(len(P)), 30.0]
        co = np.polyfit(x, y, 4, w=w)
        t = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_half + 1))           # denser toward the corners
        xs = A[0] + (B[0] - A[0]) * t; ys = np.polyval(co, xs)
        ys += (1 - t) * (A[1] - ys[0]) + t * (B[1] - ys[-1])                # the corners exactly
        return np.stack([xs, ys], 1)
    Up, Lo = fit(up), fit(lo)
    curve = np.vstack([Up, Lo[::-1][1:-1]])                                 # outer -> over the top -> inner -> under
    area = 0.5 * np.sum(curve[:, 0] * np.roll(curve[:, 1], -1) - np.roll(curve[:, 0], -1) * curve[:, 1])
    return Up, Lo, (curve if area > 0 else curve[::-1].copy())

def ray_radius(curve, c, ang):
    """distance from c to the closed curve along the direction ang"""
    d = curve - c; th = np.arctan2(d[:, 1], d[:, 0]); r = np.hypot(d[:, 0], d[:, 1])
    o = np.argsort(th); th, r = th[o], r[o]
    return np.interp((ang + np.pi) % (2 * np.pi) - np.pi, np.r_[th - 2 * np.pi, th, th + 2 * np.pi], np.r_[r, r, r])

def smooth_ring(vals, w=3):
    k = np.ones(2 * w + 1) / (2 * w + 1); return np.convolve(np.r_[vals[-w:], vals, vals[:w]], k, mode='valid')

def oval(e, n, r=1.0):
    a = math.radians(e['angle']); t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    px, py = r * e['axes'][0] * np.cos(t), r * e['axes'][1] * np.sin(t)
    return np.stack([e['centre'][0] + px * math.cos(a) - py * math.sin(a), e['centre'][1] + px * math.sin(a) + py * math.cos(a)], 1)

def oval_radius(e, centre, ang):
    """the oval's radius seen from a point inside it, along the direction ang"""
    return ray_radius(oval(e, 96), np.asarray(centre), ang)

PARTS = {}
# which edges the hologram draws as lines, carried to the viewer in the UV map: u = 1 on the points of a shown ring (or lid
# row), v = 1 on the points of a shown radial (or column). An edge is drawn when both its ends have u, or both have v.
# Shown rings and radials are never neighbours, so no quad's diagonal qualifies. Spaced to the head's own triangle size so
# the eye's lines are as dense as the rest of the face (cuts and part edges are drawn anyway, as creases and borders).
LINE = {}
RADIAL = int(flags.get('radial', 5))
def flag(v, u=0, w=0):
    a, b = LINE.get(v, (0, 0)); LINE[v] = (max(a, u), max(b, w))
def bands(at, rings, mats, centre=None, show=None, every=0, radial_to=None, radial_from=0):
    """quads between consecutive rings (each a list of (u, v, lift_mm), equal counts; a ring may repeat the last one's
    points at another lift, which makes a wall: a cut); closed by a fan to a centre point when given"""
    V = [[bm.verts.new(at(u, v, h * MM)) for u, v, h in ring] for ring in rings]; k = len(V[0]); n = 0
    for j, ring in enumerate(V):
        for i, v in enumerate(ring): flag(v, int(bool(show and show[j])), int(bool(every and i % every == 0 and j >= radial_from and (radial_to is None or j <= radial_to))))
    for j, (a, b) in enumerate(zip(V, V[1:])):
        for i in range(k):
            f = bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i])); f.material_index = mats[j]; n += 1
    if centre is not None:
        cv = bm.verts.new(at(centre[0], centre[1], centre[2] * MM)); flag(cv, 0, int(bool(every and radial_to is None)))
        for i in range(k):
            f = bm.faces.new((V[-1][i], V[-1][(i + 1) % k], cv)); f.material_index = mats[-1]; n += 1
        V.append([cv])
    bands.V = V
    return n

def face(vs, mat):
    u = []
    for v in vs:
        if v not in u: u.append(v)
    if len(u) < 3: return 0
    f = bm.faces.new(u); f.material_index = mat; return 1

report = {}; SOCKETS = []
for name in ('eye_r', 'eye_l'):
    e = eyes[name]
    Up, Lo, curve = lid_curves(e, SEG // 2); c = curve.mean(0)
    span = np.ptp(curve[:, 0]); box = (curve[:, 0].min() - 0.5 * span, curve[:, 1].min() - 0.35 * span, curve[:, 0].max() + 0.5 * span, curve[:, 1].max() + 0.5 * span)
    at, clear_skin, fit_med, fit_max, kept = faired_surface(box)
    # the socket: skin inside the opening (a little beyond it) pushed back behind the eye, as a sculptor cuts the socket
    # before setting the eyeball (moving the eye out instead left it standing proud of the face like a plate)
    shift = clear_skin([tuple(c + r * (q - c)) for r in (0.95, 0.6, 0.25) for q in curve[::2]]); clear_skin.reset()
    SOCKETS.append((at, c, curve))
    def ball(u, v):
        """the eyeball's height (mm) over the lid line: a dome, 0 at the opening, BULGE in the middle"""
        d = np.array([u, v]) - c; rho = min(1.0, np.hypot(*d) / max(1e-6, ray_radius(curve, c, math.atan2(d[1], d[0]))))
        return 0.3 + BULGE * (1 - rho * rho)
    n = 0
    # the iris's edge and the pupil's edge, seen from the iris centre along the direction of each opening point (so the
    # rings from the opening inward have equal counts and run in the same order)
    ir = e['iris']; ic = np.array(ir['centre']); pu = e['pupil']; pc = np.array(pu['centre'])
    ang = np.array([math.atan2(q[1] - ic[1], q[0] - ic[0]) for q in curve])
    rad = smooth_ring(np.minimum(oval_radius(ir, ic, ang), 0.95 * ray_radius(curve, ic, ang)), 2)
    iris_edge = ic + np.stack([np.cos(ang), np.sin(ang)], 1) * rad[:, None]
    prad = np.minimum(oval_radius(pu, pc, ang), 0.85 * np.array([ray_radius(iris_edge, pc, a) for a in ang]))
    pupil_edge = pc + np.stack([np.cos(ang), np.sin(ang)], 1) * prad[:, None]
    lerp = lambda A, B, t: A + (B - A) * t
    rings, mats = [], []
    for t in (0.0, 0.3, 0.6, 1.0):                                         # the eyeball, from the lid line to the iris
        R = lerp(curve, iris_edge, t); rings.append([(u, v, ball(u, v)) for u, v in R]); mats.append(MAT['white'])
    rings.append([(u, v, ball(u, v) - 0.25) for u, v in iris_edge]); mats[-1] = MAT['white']; mats.append(MAT['iris'])  # the iris's cut
    for t in (0.35, 0.7, 1.0):                                             # the iris's dish, sinking toward the pupil
        R = lerp(iris_edge, pupil_edge, t); rings.append([(u, v, ball(u, v) - 0.25 - 0.3 * t) for u, v in R]); mats.append(MAT['iris'])
    mats[-1] = MAT['iris']
    rings.append([(u, v, ball(u, v) - 1.1) for u, v in pupil_edge]); mats.append(MAT['pupil'])                         # the drilled hole
    floor_h = min(h for *_, h in rings[-1])
    rings.append([(u, v, floor_h) for u, v in lerp(pupil_edge, np.tile(pc, (len(pupil_edge), 1)), 0.55)]); mats.append(MAT['pupil'])
    W, I, P = MAT['white'], MAT['iris'], MAT['pupil']
    n += bands(at, rings, [W, W, W, I, I, I, I, P, P], centre=(pc[0], pc[1], floor_h),
               show=[1, 0, 1, 0, 0, 0, 1, 0, 0, 0], every=RADIAL, radial_to=7)   # radials stop at the pupil's rim: a hole, no lines in it   # the cuts' walls belong to the part inside
    PARTS['white'] = PARTS.get('white', []) + [curve.tolist()]; PARTS['iris'] = PARTS.get('iris', []) + [iris_edge.tolist()]
    PARTS['pupil'] = PARTS.get('pupil', []) + [pupil_edge.tolist()]
    # highlights: bumps standing in front of the iris
    for h in e['highlights']:
        hc = h['centre']; b = ball(*hc)
        n += bands(at, [[(u, v, b + 0.2) for u, v in oval(h, 12)], [(u, v, b + 0.75) for u, v in oval(h, 12, 0.55)]],
                   [MAT['highlight']], centre=(hc[0], hc[1], b + 0.9))
        PARTS.setdefault('highlight', []).append(oval(h, 12).tolist())
    # the lower lid: a thin rounded rim along the lower lid curve, pinched at both corners
    m = len(Lo); s = np.linspace(0, 1, m); width = 0.06 * span * np.sin(np.pi * s) ** 0.8
    nrm = np.gradient(Lo, axis=0); nrm = np.stack([-nrm[:, 1], nrm[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    nrm *= np.sign(((Lo - c) * nrm).sum(1, keepdims=True) + 1e-9)          # pointing away from the opening
    rows = [Lo - nrm * (0.25 * width)[:, None], Lo + nrm * (0.35 * width)[:, None], Lo + nrm * width[:, None]]
    lifts = [lambda i: 0.3 + 0.3 * math.sin(math.pi * s[i]), lambda i: 0.3 + 0.7 * math.sin(math.pi * s[i]), lambda i: 0.3]
    G = [[bm.verts.new(at(*rows[k][i], lifts[k](i) * MM)) if 0 < i < m - 1 else None for i in range(m)] for k in range(3)]
    ends = {0: bm.verts.new(at(*Lo[0], 0.3 * MM)), m - 1: bm.verts.new(at(*Lo[-1], 0.3 * MM))}
    for k in range(3):
        for i in (0, m - 1): G[k][i] = ends[i]
    for i in range(1, m - 1):
        flag(G[1][i], 1, 0)
        if i % 4 == 0:
            for k in range(3): flag(G[k][i], 0, 1)
    for i in range(m - 1):
        for k in range(2): n += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), MAT['lid'])
    PARTS.setdefault('lid', []).append(np.vstack([rows[0], rows[2][::-1]]).tolist())
    # the upper lid: the lash, a smooth bar along the upper lid curve
    L = np.array(e['upper_lash'])
    if len(L) >= 4:
        L = L[np.argsort(L[:, 0])]
        # drop columns whose lower edge leaves the lid's line (a dark hair strand read as lash)
        for _ in range(3):
            lo_ = L[:, 1] + L[:, 2] / 2; r_ = np.abs(lo_ - np.polyval(np.polyfit(L[:, 0], lo_, 2), L[:, 0]))
            ok_ = r_ < max(6.0, 2.5 * np.median(r_))
            if ok_.all() or ok_.sum() < 6: break
            L = L[ok_]
        med = np.median(L[:, 2])
        thick = np.minimum(L[:, 2], 1.8 * med); thick = np.polyval(np.polyfit(L[:, 0], thick, 3), L[:, 0])   # a smooth thickness profile
        xs = np.linspace(L[0, 0], L[-1, 0], 28); tk = np.interp(xs, L[:, 0], thick)
        top = Up[np.argsort(Up[:, 0])]
        # one smooth lower edge: a polynomial through the upper lid curve (weighted) and the lash's own lower edge beyond it
        out_ = (L[:, 0] < top[0, 0]) | (L[:, 0] > top[-1, 0])
        X_ = np.r_[top[:, 0], L[out_, 0]]; Y_ = np.r_[top[:, 1], L[out_, 1] + L[out_, 2] / 2]
        W_ = np.r_[np.full(len(top), 3.0), np.ones(out_.sum())]
        lower = np.polyval(np.polyfit(X_, Y_, 4, w=W_), xs)
        inner_x = e['corners']['inner'][0]; s = np.abs(xs - inner_x) / (np.ptp(xs) + 1e-6)
        taper = np.clip(0.3 + 0.7 * np.sin(np.clip(s, 0, 1) * np.pi * 0.62) ** 0.7, 0.3, 1.0)     # thin at the inner corner, full mid-lid
        tk = tk * taper * np.where(s > 0.88, np.clip((1.0 - s) / 0.12, 0.15, 1.0), 1.0)     # the wing's tip tapers
        rows = [(lower - tk * f) for f in (0.0, 0.5, 1.0)]
        m = len(xs); prof = (0.0, 0.6, 0.0)       # the front rounded: its middle row stands a little further out
        close = np.ones(m); close[[0, -1]] = 0.0; close[[1, -2]] = 0.55      # both ends pinched to a point
        mid = (rows[0] + rows[2]) / 2
        def lift(k, i, front):
            full = (2.2 + 1.0 * prof[k]) if front else 1.2
            return (1.7 + (full - 1.7) * close[i]) * MM
        G = {}
        for i in range(m):
            if close[i] == 0: v = bm.verts.new(at(xs[i], mid[i], 1.7 * MM)); G.update({(f, k, i): v for f in (0, 1) for k in range(3)}); continue
            for f in (0, 1):
                for k in range(3):
                    y = mid[i] + (rows[k][i] - mid[i]) * close[i]
                    G[(f, k, i)] = bm.verts.new(at(xs[i], y, lift(k, i, f)))
        for i in range(1, m - 1):
            flag(G[(1, 1, i)], 1, 0)
            if i % 4 == 0:
                for f_ in (0, 1):
                    for k in range(3): flag(G[(f_, k, i)], 0, 1)
        for i in range(m - 1):
            for k in range(2): n += face((G[(1, k, i)], G[(1, k, i + 1)], G[(1, k + 1, i + 1)], G[(1, k + 1, i)]), MAT['lid'])   # the front
            n += face((G[(0, 0, i)], G[(0, 0, i + 1)], G[(1, 0, i + 1)], G[(1, 0, i)]), MAT['lid'])                             # lower side
            n += face((G[(1, 2, i)], G[(1, 2, i + 1)], G[(0, 2, i + 1)], G[(0, 2, i)]), MAT['lid'])                             # upper side
        out = [(float(x), float(mid[i] + (rows[0][i] - mid[i]) * close[i])) for i, x in enumerate(xs)]
        out += [(float(x), float(mid[i] + (rows[2][i] - mid[i]) * close[i])) for i, x in list(enumerate(xs))[::-1]]
        PARTS.setdefault('lash', []).append(out)
    report[name] = {'faces': n, 'surface fit median mm': round(1000 * fit_med, 2), 'max mm': round(1000 * fit_max, 2),
                    'skin hits kept': round(kept, 2), 'skin in front before mm': round(1000 * shift, 2), }
def ridge(line, mat, height, wmin_mm, shift_px=0.0, taper=0.5, cols=4):
    """a stroke as a carved ridge: a strip along the stroke's path, its width the stroke's thickness (at least wmin_mm,
    or a thin stroke vanishes), raised to `height` mm along its middle and tapering to points at both ends"""
    L = np.array(line, float); P = L[:, :2].copy(); n_ = len(P)
    d = np.gradient(P, axis=0); nrm = np.stack([-d[:, 1], d[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    if nrm[:, 1].mean() < 0: nrm = -nrm                                # pointing down the picture
    P = P + nrm * shift_px
    px_mm = 1.0 / (1000 * scale)                                       # portrait pixels per mm
    s_ = np.linspace(0, 1, n_); tp = np.clip(np.sin(np.pi * s_) ** taper, 0.0, 1.0)
    half = 0.5 * np.maximum(L[:, 2] * 1.4, wmin_mm * px_mm) * tp
    # a stroke is narrow: it follows the real skin along its path (a surface fitted over the area flattens a nose and the
    # brow's ridge), the skin's depth smoothed along the stroke so the ridge runs as one even curve
    XZ = np.array([to_xz(*q) for q in P]); ys = np.array([(lambda h: np.nan if h is None else h.y)(skin_hit(x, z)) for x, z in XZ])
    ok_ = ~np.isnan(ys)
    if ok_.sum() < 3: return 0
    deg = 3 if ok_.mean() > 0.7 else 1                                  # few hits (a brow under hair): a straight fit
    for _ in range(3):
        co_ = np.polyfit(s_[ok_], ys[ok_], deg); r_ = np.abs(np.polyval(co_, s_) - ys)
        ok_ = ok_ & (r_ < max(0.5 * MM, 2.5 * np.median(r_[ok_])))
        if ok_.sum() < deg + 2: break
    ysm = np.clip(np.polyval(co_, s_), np.nanmin(ys) - 5 * MM, np.nanmax(ys) + 5 * MM)  # never far from the skin it found
    ysm = np.minimum(ysm, np.where(np.isnan(ys), np.inf, ys))          # never under the skin it follows
    def at_(u, v, lift, i):
        x, z = to_xz(u, v); return Vector((x, ysm[i] - lift, z))
    rows = [P - nrm * half[:, None], P - nrm * (0.5 * half)[:, None], P, P + nrm * (0.5 * half)[:, None], P + nrm * half[:, None]]
    prof = (0.0, 0.75, 1.0, 0.75, 0.0)                                 # a rounded section
    G = [[None] * n_ for _ in rows]; nf = 0
    for i in range(n_):
        if tp[i] == 0:
            v = bm.verts.new(at_(*P[i], 0.2 * MM, i))
            for k in range(len(rows)): G[k][i] = v
            continue
        for k in range(len(rows)):
            G[k][i] = bm.verts.new(at_(*rows[k][i], (0.2 + height * prof[k] * tp[i]) * MM, i))
    for i in range(n_):
        flag(G[2][i], 1, 0)
        if i % cols == 0:
            for k in range(len(rows)): flag(G[k][i], 0, 1)
    for i in range(n_ - 1):
        for k in range(len(rows) - 1): nf += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), mat)
    PARTS.setdefault(next(k for k, v in MAT.items() if v == mat), []).append(np.vstack([rows[0], rows[-1][::-1]]).tolist())
    return nf
if 'brows' in ORGANS:
    for k in ('brow_r', 'brow_l'): report[k] = ridge(eyes[k]['line'], MAT['brow'], 0.8, 1.6, taper=0.6)
def ink(P, half_px, mat, edge=0.3, middle=0.12):
    """a drawn line as the tutorial models it: one strip of faces lying on the face, dark (as the pupil's hole is dark),
    as wide as the drawing's stroke at each point; its outline is the line the hologram draws. P: the stroke's path in
    portrait pixels; half_px: its half width there (0 closes it to a point). The strip follows the real skin along its
    path, `edge` mm in front of it at its sides and `middle` mm along its middle (a line cut a little into the surface)."""
    P = np.asarray(P, float); half = np.asarray(half_px, float); n_ = len(P); s_ = np.linspace(0, 1, n_)
    d = np.gradient(P, axis=0); nrm = np.stack([-d[:, 1], d[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    rows = [P - nrm * half[:, None], P, P + nrm * half[:, None]]
    # the skin's depth along the stroke (from all three rows), as one smooth curve that never goes under the skin it found
    ys = np.array([[(lambda h: np.nan if h is None else h.y)(skin_hit(*to_xz(*q))) for q in r] for r in rows])
    yc = np.nanmin(ys, 0); ok_ = ~np.isnan(yc)
    if ok_.sum() < 3: return 0
    co_ = np.polyfit(s_[ok_], yc[ok_], min(3, ok_.sum() - 1)); ysm = np.minimum(np.polyval(co_, s_), np.where(ok_, yc, np.inf))
    G = [[None] * n_ for _ in range(3)]
    for k in range(3):
        for i in range(n_):
            x, z = to_xz(*rows[k][i]); G[k][i] = bm.verts.new(Vector((x, ysm[i] - (middle if k == 1 else edge) * MM, z)))
    nf = 0
    for i in range(n_ - 1):
        for k in range(2): nf += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), mat)
    PARTS.setdefault(next(k for k, v in MAT.items() if v == mat), []).append(np.vstack([rows[0], rows[2][::-1]]).round(1).tolist())
    return nf
px_mm = 1.0 / (1000 * scale)                                            # portrait pixels per mm
K28 = np.array(eyes['points28'], float)
DIN = float(np.linalg.norm(np.array(eyes['eye_r']['corners']['inner']) - np.array(eyes['eye_l']['corners']['inner'])))
def nose_structure():
    """the nose as the face's own structure, the way the tutorial's loops make it: not a bump set on a flat face but the
    two cheek planes running together into a ridge (the bridge) that rises from just under the eyes to the tip, where a
    short underside cuts back to the face above the mouth. Placed automatically: the face's axis runs from between the
    inner eye corners to the mouth; the tip is where the head's own nose stands furthest out of the face's faired surface
    (near the portrait's nose point), and its height is the head's own; the cheeks' slope sets the nose's width (a fifth
    of the eyes' inner distance at the tip). The region is rebuilt in the face (stitch_face) with the bridge and the tip's
    cross line as real edges, so both stay sharp; the cheek planes meet the face smoothly."""
    G0 = 0.5 * (np.array(eyes['eye_r']['corners']['inner']) + np.array(eyes['eye_l']['corners']['inner']))
    Mth = np.array(eyes['mouth']['line'], float); Mc = Mth[:, :2].mean(0)
    ea = (Mc - G0) / np.linalg.norm(Mc - G0); el = np.array([-ea[1], ea[0]])          # down the face, across it
    K = K28[23]
    at_f = faired_surface((K[0] - 0.9 * DIN, G0[1], K[0] + 0.9 * DIN, Mc[1] + 0.1 * DIN))[0]
    best = (-1.0, K[0], K[1])
    for da in np.linspace(-0.25 * DIN, 0.25 * DIN, 21):
        for dl in np.linspace(-0.15 * DIN, 0.15 * DIN, 13):
            u, v = K + da * ea + dl * el; h = skin_hit(*to_xz(u, v))
            if h is not None: best = max(best, ((at_f(u, v, 0.0).y - h.y) / MM, u, v))
    T = np.array(best[1:]); H = float(np.clip(best[0], 1.5, 9.0))
    # the tip on the face's axis line through it (the axis is shifted sideways onto the head's tip)
    Ltop = float((T - G0) @ ea) * 0.8; B = T - Ltop * ea                               # the bridge's start
    Lbot = float((Mc - T) @ ea) * 0.32; Sn = T + Lbot * ea                             # the underside's foot
    wt = 0.2 * DIN; k = H / (wt / px_mm)                                               # cheek slope (mm per mm)
    def frame(u, v):
        d = np.array([u, v]) - T; return float(d @ ea), float(d @ el)
    def rise(u, v):
        a_, l_ = frame(u, v)
        h = H * np.clip(1 + a_ / Ltop, 0, 1) ** 1.15 if a_ <= 0 else H * np.clip(1 - a_ / Lbot, 0, 1) ** 0.6
        o = h - k * abs(l_) / px_mm; e = 0.6                                           # mm; a soft foot on the cheeks
        return 0.5 * (o + math.sqrt(o * o + e * e)) - 0.5 * e
    def target(u, v): return at_f(u, v, rise(u, v) * MM)
    up, dn, side = 1.12 * Ltop, min(1.4 * Lbot, 0.6 * float((Mc - T) @ ea)), 1.7 * wt
    def lv(u, v):
        a_, l_ = frame(u, v); return abs(l_) / side + (-a_ / up if a_ < 0 else a_ / dn)
    # the structural lines: the bridge down to the tip and on under it, and the tip's cross line out to the cheeks
    lines = [[tuple(B + t * (T - B)) for t in np.linspace(0, 1, 6)] + [tuple(T + t * (Sn - T)) for t in np.linspace(0, 1, 3)[1:]]]
    lines += [[tuple(T + t * sg * wt * el) for t in np.linspace(0, 1, 3)] for sg in (-1, 1)]
    STITCH.append({'name': 'nose', 'lv': lv, 'target': target, 'lines': lines})
    PARTS['nose'] = [[list(map(float, B)), list(map(float, T)), list(map(float, Sn))]]
    return {'tip off the portrait point px': [round(float(T[0] - K[0]), 1), round(float(T[1] - K[1]), 1)],
            'height mm (the head\'s own)': round(H, 2), 'bridge px': round(Ltop, 1), 'underside px': round(Lbot, 1),
            'half width at the tip mm': round(wt / px_mm, 2)}
if 'nose' in ORGANS: report['nose'] = nose_structure()
if 'mouth' in ORGANS:
    # the mouth: the drawing's line, thin in the middle and heavier toward the corners, the ends rounded off
    Mth = np.array(eyes['mouth']['line'], float); Mth = Mth[np.argsort(Mth[:, 0])]; w_ = float(np.ptp(Mth[:, 0]))
    xs_ = np.linspace(Mth[0, 0], Mth[-1, 0], 25); path = np.stack([xs_, np.interp(xs_, Mth[:, 0], Mth[:, 1])], 1)
    a_ = np.abs(np.linspace(-1, 1, len(xs_)))
    half = 0.5 * w_ * (0.035 + 0.085 * a_ ** 1.6)
    half = np.maximum(half, 0.22 * px_mm)                               # at least 0.45 mm wide in the middle
    half *= np.sqrt(np.clip(1 - np.clip((a_ - 0.86) / 0.14, 0, 1) ** 2, 0, 1))
    report['mouth'] = ink(path, half, MAT['mouth'])

REPORT_STITCH = {}
def stitch_face(hb, hairy, uv_of, Mw):
    """a region of the face rebuilt as structure (the nose): the head's triangles reaching inside its outline are removed
    and the opening refilled with new triangles like the face's own (a constrained triangulation, points spaced like the
    face's triangles, the structural lines kept as edges), lying on the region's target surface; near the rim the fill
    blends smoothly onto the face left around it (the rim's offset from the target spread inward), meeting it exactly on
    copies of the rim's points (same place, same weights later). Locks of hair fused to the face are left standing."""
    from mathutils.geometry import delaunay_2d_cdt
    uvc = {}
    def UV(co):
        k = (round(co.x, 7), round(co.y, 7), round(co.z, 7))
        if k not in uvc: uvc[k] = uv_of(co)[0]
        return uvc[k]
    def probes(f):
        P_ = [v.co for v in f.verts]; out = list(P_) + [f.calc_center_median()]
        for i in range(len(P_)):
            for t in (0.25, 0.5, 0.75): out.append(P_[i].lerp(P_[(i + 1) % len(P_)], t))
        return out
    lockc = {}
    def lock(f):
        if f not in lockc:
            if any(hairy(v) for v in f.verts): lockc[f] = True
            else:
                c = Mw @ f.calc_center_median(); u, v = UV(f.calc_center_median()); o = skin_hit(*to_xz(u, v))
                lockc[f] = o is not None and c.y < o.y - 1.5 * MM
        return lockc[f]
    for S in STITCH:
        dead = {f for f in hb.faces if not lock(f) and any(S['lv'](*UV(q)) < 1.0 for q in probes(f))}
        if not dead: continue
        SP = float(np.median([np.hypot(*(np.subtract(UV(e.verts[0].co), UV(e.verts[1].co)))) for f in dead for e in f.edges]))
        touched = {v for f in dead for v in f.verts}
        bmesh.ops.delete(hb, geom=list(dead), context='FACES')
        bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
        # the face left under the old shape (the old nose's underside, which its tip hid) can lie deep behind the new
        # surface: near the region, those triangles are rebuilt too, until the opening's edge meets the new surface
        def behind(v):
            w = Mw @ v.co; u_, v_ = UV(v.co); return S['lv'](u_, v_) < 1.6 and w.y - S['target'](u_, v_).y > 2.0 * MM
        grown = 0
        for _ in range(6):
            deep = {v for e in hb.edges if e.is_boundary and all(v in touched for v in e.verts) for v in e.verts if behind(v)}
            gone = {f for v in deep for f in v.link_faces if not lock(f)}
            if not gone: break
            touched |= {v for f in gone for v in f.verts}; grown += len(gone)
            bmesh.ops.delete(hb, geom=list(gone), context='FACES')
            bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
        hb.verts.index_update(); hb.faces.ensure_lookup_table()
        rim_edges = [e for e in hb.edges if e.is_boundary and all(v in touched for v in e.verts)
                     and not any(lock(f) for f in e.link_faces)]
        open_e = [e for e in hb.edges if e.is_boundary and all(v in touched for v in e.verts)]
        left_out = {'lock': sum(1 for e in open_e if any(lock(f) for f in e.link_faces)),
                    'still behind the new surface': sum(1 for e in open_e if any(behind(v) for v in e.verts))}
        rim_v = sorted({v for e in rim_edges for v in e.verts}, key=lambda v: v.index)
        cur = BVHTree.FromBMesh(hb); cur_hair = lambda fi: fi is not None and any(hairy(v) for v in hb.faces[fi].verts)
        def opening(u, v):
            x, z = to_xz(u, v); o = skin_hit(x, z)
            if o is None: return False
            c = first_skin(cur, cur_hair, x, z)
            return c is None or abs(c.y - o.y) > 1.5 * MM
        P2, P3, KIND, idx = [], [], [], {}
        for v in rim_v:
            idx[v] = len(P2); P2.append(tuple(UV(v.co))); P3.append(Mw @ v.co); KIND.append(('rim', v))
        cons = [(idx[e.verts[0]], idx[e.verts[1]]) for e in rim_edges]
        # the structural lines, resampled to about half the face's triangle size, as fixed edges
        for line in S['lines']:
            Lp = np.array(line, float); seg = np.r_[0, np.cumsum(np.hypot(*np.diff(Lp, axis=0).T))]
            n_ = max(2, int(round(seg[-1] / (0.5 * SP))) + 1); tt = np.linspace(0, seg[-1], n_)
            Q = np.stack([np.interp(tt, seg, Lp[:, 0]), np.interp(tt, seg, Lp[:, 1])], 1); k0 = len(P2)
            for q in Q:
                P2.append((float(q[0]), float(q[1]))); P3.append(None); KIND.append(('line', None))
            cons += [(k0 + i, k0 + i + 1) for i in range(len(Q) - 1)]
        C2 = np.array(P2); lo, hi = C2.min(0), C2.max(0); st = []
        segs = np.array([[C2[i], C2[j]] for i, j in cons])
        def seg_dist(p_):
            a_, b_ = segs[:, 0], segs[:, 1]; d = b_ - a_; t = np.clip(((p_ - a_) * d).sum(1) / ((d * d).sum(1) + 1e-12), 0, 1)
            return np.hypot(*(a_ + d * t[:, None] - p_).T).min()
        for r_, y in enumerate(np.arange(lo[1], hi[1], 0.87 * SP)):
            for x in np.arange(lo[0] + (0.5 * SP if r_ % 2 else 0.0), hi[0], SP):
                p_ = np.array([x, y])
                if np.hypot(*(C2 - p_).T).min() < 0.6 * SP or seg_dist(p_) < 0.4 * SP: continue
                if opening(x, y): st.append(p_)
        for p_ in st:
            P2.append((float(p_[0]), float(p_[1]))); P3.append(None); KIND.append(('new', None))
        out = delaunay_2d_cdt([Vector(q) for q in P2], cons, [], 0, 1e-6)
        ov, of, oorig = out[0], out[2], out[3]
        BV, mine = {}, set()
        for i, orig in enumerate(oorig):
            if orig: k = orig[0]; kind, ref = KIND[k]
            else: k, kind, ref = None, 'new', None
            q = tuple(ov[i]) if k is None else P2[k]
            if kind == 'rim':
                c_ = bm.verts.new(P3[k]); BRIDGE[c_] = ref.index
            else:
                c_ = bm.verts.new(S['target'](q[0], q[1])); STEINER.add(c_); mine.add(c_)
            flag(c_, 1, 1); PIN.add(c_); BV[i] = c_
        line_pts = {BV[i] for i, orig in enumerate(oorig) if orig and KIND[orig[0]][0] == 'line'}
        FL = bm.faces.layers.int.get('flat') or bm.faces.layers.int.new('flat')
        nf = 0; adj = {}
        for tri in of:
            cen = np.mean([np.array(ov[t]) for t in tri], 0)
            if not opening(*cen): continue
            vs = [BV[t] for t in tri]
            if len(set(vs)) < 3: continue
            try: f = bm.faces.new(vs)
            except ValueError: continue
            f.material_index = MAT['skin']; f[FL] = 1; f.normal_update()
            if f.normal.y > 0: f.normal_flip()
            nf += 1
            for a_ in vs:
                for b_ in vs:
                    if a_ is not b_: adj.setdefault(a_, set()).add(b_)
        # near the rim the fill eases onto the face that is left: the rim's offset from the target surface, spread inward
        # (the structural lines stay exactly on the target)
        def tgt_y(co):
            q = (Rm.T @ (np.array([co.x, co.z]) - tr)) / scale; return S['target'](float(q[0]), float(-q[1])).y
        off = {v: (v.co.y - tgt_y(v.co)) if v in BRIDGE else 0.0 for v in adj}
        free = [v for v in mine if v in adj and v not in line_pts]
        for _ in range(300):
            for v in free: off[v] = sum(off[w] for w in adj[v]) / len(adj[v])
        for v in free: v.co.y = tgt_y(v.co) + off[v]
        loose = [v for v in list(mine) + [c_ for c_ in BRIDGE] if v.is_valid and not v.link_faces]
        for v in loose: STEINER.discard(v); PIN.discard(v); BRIDGE.pop(v, None)
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        S['report'] = {'face triangles rebuilt': len(dead), 'more under the old shape': grown, 'rim points': len(rim_v), 'rim edges left out': left_out, 'new points': len([v for v in mine if v.is_valid]),
                       'triangles': nf, 'face edge px': round(SP, 1)}
        print('FIG %s rebuilt in the face: %s' % (S['name'], S['report']))
def cut_sockets():
    """the head's skin around each eye pushed back behind the eye's faired surface, fully inside the opening and fading out
    by 1.5 times its size (a socket's slope); the triangles lying wholly under the eye are split once first, so the skin
    under the eye can sink although the head's triangles are larger than the eye's parts"""
    hb = bmesh.new(); hb.from_mesh(head.data); dl = hb.verts.layers.deform.active; hb.verts.ensure_lookup_table()
    hair_ids = {g.index for g in head.vertex_groups if g.name.startswith('hair')}
    Mw = head.matrix_world; Mi = Mw.inverted()
    def uv_of(co):
        w = Mw @ co; q = (Rm.T @ (np.array([w.x, w.z]) - tr)) / scale; return (q[0], -q[1]), w
    def level(uv, c, curve):
        d = np.array(uv) - c; return np.hypot(*d) / max(1e-6, ray_radius(curve, c, math.atan2(d[1], d[0])))
    hairy = lambda v: sum(w for g, w in v[dl].items() if g in hair_ids) > 0.3
    near = set()
    for f in hb.faces:
        if any(hairy(v) for v in f.verts): continue
        for at_, c_, cv_ in SOCKETS:
            if max(level(uv_of(v.co)[0], c_, cv_) for v in f.verts) < 1.25: near.add(f); break
    # only the triangles under the eye are split (it hides them); the skin that shows keeps the head's own triangle size
    # (splitting everything near the eye made a dense patch of lines that glowed around it in the hologram)
    edges = [e for e in {e for f in near for e in f.edges} if all(f in near for f in e.link_faces)]
    bmesh.ops.subdivide_edges(hb, edges=edges, cuts=1, use_grid_fill=True)
    moved = 0
    for v in hb.verts:
        if hairy(v): continue
        uv, w = uv_of(v.co)
        for at_, c_, cv_ in SOCKETS:
            s_ = level(uv, c_, cv_)
            if s_ >= 1.5: continue
            t = 1.0 if s_ <= 1.1 else (1.5 - s_) / 0.4
            back = at_(uv[0], uv[1], -0.5 * MM)
            if w.y < back.y: v.co = Mi @ Vector((w.x, w.y + t * (back.y - w.y), w.z)); moved += 1
    if STITCH: stitch_face(hb, hairy, uv_of, Mw)
    hb.to_mesh(head.data); hb.free(); head.data.update()
    global HAIR_POLY
    vh = [sum(g.weight for g in v.groups if head.vertex_groups[g.group].name.startswith('hair')) for v in head.data.vertices]
    ph = [max(vh[i] for i in p.vertices) > 0.3 for p in head.data.polygons]
    HAIR_POLY = lambda fi: fi is not None and ph[fi]
    return len(near), moved
socket_faces, socket_points = cut_sockets()
MAX_SETTLE = 4 * MM
def settle_on_skin():
    """where the skin still covers an eye point after the socket (the lash wing and lid rims run past the corners onto
    skin the socket left alone; a large face triangle crossing the opening covers the eyeball's edge), move it out in
    front of the skin, the shift spread over its neighbours with a decay so the parts keep their smooth shapes"""
    hm = head.data; hbv = BVHTree.FromPolygons([head.matrix_world @ v.co for v in hm.vertices], [p.vertices[:] for p in hm.polygons])
    def skin_y(x, z):
        h = first_skin(hbv, HAIR_POLY, x, z); return None if h is None else h.y
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')    # loose points
    bm.verts.ensure_lookup_table()
    margin = {MAT['lid']: 0.5 * MM}
    need = {}
    for v in bm.verts:
        sy = skin_y(v.co.x, v.co.z)
        if sy is None or v in PIN: continue
        mi = v.link_faces[0].material_index
        if mi in (MAT['inner'], MAT['teeth'], MAT['skin']): continue                 # the mouth's inside belongs behind the skin
        need[v] = max(0.0, v.co.y - (sy - margin.get(mi, 0.3 * MM)))
        # deeper than that it is not skin poking through but something over the eye (the eyeball stays under it); the lids
        # run past the corners where the face curves back, so they follow the skin much further
        if need[v] > (4 * MAX_SETTLE if mi in (MAT['lid'], MAT['brow'], MAT['nose'], MAT['lip'], MAT['mouth']) else MAX_SETTLE): need[v] = 0.0
    shift = dict(need)
    for _ in range(8):
        new = {}
        for v in bm.verts:
            nb = [shift.get(e.other_vert(v), 0.0) for e in v.link_edges]
            new[v] = 0.0 if v in PIN else max(need.get(v, 0.0), 0.8 * max(nb + [0.0]))
        shift = new
    moved = 0
    for v, d in shift.items():
        if d > 0: v.co.y -= d; moved += 1
    return moved, 1000 * max(need.values())
settled, worst = settle_on_skin()
print('FIG settled %d eye points in front of the skin (deepest was %.1f mm under)' % (settled, worst))
_hm = head.data; _hb = BVHTree.FromPolygons([head.matrix_world @ v.co for v in _hm.vertices], [p.vertices[:] for p in _hm.polygons])
_hid = 0; HID = {}
for v in bm.verts:
    sk = first_skin(_hb, HAIR_POLY, v.co.x, v.co.z)
    hit = (sk, None, None) if sk is not None and sk.y < v.co.y - 2e-4 else (None,)
    mi = v.link_faces[0].material_index if v.link_faces else -1
    if hit[0] is not None and mi not in (MAT['inner'], MAT['teeth'], MAT['skin']) and v not in PIN:
        _hid += 1
        HID.setdefault(mi, []).append(round(1000 * (v.co - hit[0]).length, 2))
print('FIG behind skin by part: %s' % {k: (len(d), max(d)) for k, d in HID.items()})
print('FIG sockets: %d head faces split, %d points pushed back; %d of %d eye points behind skin' % (socket_faces, socket_points, _hid, len(bm.verts)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(PARTS, open(OUT.replace('.blend', '_parts2d.json'), 'w'))   # every part's outline in portrait pixels (to overlay)
bm.verts.index_update(); LINE_BY_INDEX = {v.index: LINE[v] for v in bm.verts if v in LINE}
FREE = {v.index for v in STEINER if v.is_valid}
COPY = {c_.index: h_ for c_, h_ in BRIDGE.items() if c_.is_valid}
me = bpy.data.meshes.new('Eyes_quad'); bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('Eyes_quad', me); bpy.context.scene.collection.objects.link(ob)
_flat = me.attributes.get('flat')
_flat = [d.value for d in _flat.data] if _flat is not None else [0] * len(me.polygons)
for p in me.polygons: p.use_smooth = not _flat[p.index]           # the rebuilt face is flat like the head's triangles
if me.attributes.get('flat') is not None: me.attributes.remove(me.attributes['flat'])
uvl = me.uv_layers.new(name='lines')
for poly in me.polygons:
    for li in poly.loop_indices: uvl.data[li].uv = LINE_BY_INDEX.get(me.loops[li].vertex_index, (0, 0))
# the weights: the eyes, brows and mouth on the head; the rebuilt face's rim copies exactly the face's points, its own
# points a smooth blend from the rim (so it moves as the face around it does)
_hn = {gg.index: gg.name for gg in head.vertex_groups}
def head_w(i): return {_hn[gg.group]: gg.weight for gg in head.data.vertices[i].groups if gg.weight > 0}
W = {i: {'head': 1.0} for i in range(len(me.vertices))}
for i, h_ in COPY.items(): W[i] = head_w(h_)
_nb = {}
for e in me.edges:
    a_, b_ = e.vertices; _nb.setdefault(a_, []).append(b_); _nb.setdefault(b_, []).append(a_)
for _ in range(400 if FREE else 0):
    for i in FREE:
        nb = _nb.get(i, [])
        if not nb: continue
        acc = {}
        for j in nb:
            for nm, w in W[j].items(): acc[nm] = acc.get(nm, 0.0) + w / len(nb)
        W[i] = acc
for i, d in W.items():
    tot = sum(d.values()) or 1.0
    for nm, w in d.items():
        if w / tot > 1e-4: (ob.vertex_groups.get(nm) or ob.vertex_groups.new(name=nm)).add([i], w / tot, 'REPLACE')
ob.parent = rig; am = ob.modifiers.new('Armature', 'ARMATURE'); am.object = rig
for part, grey in (('white', 0.92), ('iris', 0.6), ('pupil', 0.08), ('highlight', 1.0), ('lid', 0.25), ('brow', 0.3), ('nose', 0.85), ('lip', 0.7), ('mouth', 0.9), ('inner', 0.1), ('teeth', 1.0), ('skin', 0.92)):
    nm = ('eye_' if MAT[part] < 5 else 'face_') + part
    mt = bpy.data.materials.get(nm) or bpy.data.materials.new(nm)
    mt.diffuse_color = (grey, grey, grey, 1.0); me.materials.append(mt)
print('FIG eyes built: %s; %d points' % (report, len(me.vertices)))
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

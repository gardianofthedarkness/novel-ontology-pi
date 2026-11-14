"""Build the eyes as a carved relief (organ prototypes), placed on a figure's head from the portrait.
usage: blender -b <figure.blend> -P eye_parts.py -- <eyes.json> <render-dir> <out.blend> [--seg=40] [--bulge=1.6]
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
MAT = {'white': 0, 'iris': 1, 'pupil': 2, 'highlight': 3, 'lid': 4}

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
def bands(at, rings, mats, centre=None, show=None, every=0, radial_to=None):
    """quads between consecutive rings (each a list of (u, v, lift_mm), equal counts; a ring may repeat the last one's
    points at another lift, which makes a wall: a cut); closed by a fan to a centre point when given"""
    V = [[bm.verts.new(at(u, v, h * MM)) for u, v, h in ring] for ring in rings]; k = len(V[0]); n = 0
    for j, ring in enumerate(V):
        for i, v in enumerate(ring): flag(v, int(bool(show and show[j])), int(bool(every and i % every == 0 and (radial_to is None or j <= radial_to))))
    for j, (a, b) in enumerate(zip(V, V[1:])):
        for i in range(k):
            f = bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i])); f.material_index = mats[j]; n += 1
    if centre is not None:
        cv = bm.verts.new(at(centre[0], centre[1], centre[2] * MM)); flag(cv, 0, int(bool(every and radial_to is None)))
        for i in range(k):
            f = bm.faces.new((V[-1][i], V[-1][(i + 1) % k], cv)); f.material_index = mats[-1]; n += 1
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
        if sy is None: continue
        mi = v.link_faces[0].material_index
        need[v] = max(0.0, v.co.y - (sy - margin.get(mi, 0.3 * MM)))
        # deeper than that it is not skin poking through but something over the eye (the eyeball stays under it); the lids
        # run past the corners where the face curves back, so they follow the skin much further
        if need[v] > (4 * MAX_SETTLE if mi == MAT['lid'] else MAX_SETTLE): need[v] = 0.0
    shift = dict(need)
    for _ in range(8):
        new = {}
        for v in bm.verts:
            nb = [shift.get(e.other_vert(v), 0.0) for e in v.link_edges]
            new[v] = max(need.get(v, 0.0), 0.8 * max(nb + [0.0]))
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
    if hit[0] is not None:
        _hid += 1; mi = v.link_faces[0].material_index if v.link_faces else -1
        HID.setdefault(mi, []).append(round(1000 * (v.co - hit[0]).length, 2))
print('FIG behind skin by part: %s' % {k: (len(d), max(d)) for k, d in HID.items()})
print('FIG sockets: %d head faces split, %d points pushed back; %d of %d eye points behind skin' % (socket_faces, socket_points, _hid, len(bm.verts)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(PARTS, open(OUT.replace('.blend', '_parts2d.json'), 'w'))   # every part's outline in portrait pixels (to overlay)
bm.verts.index_update(); LINE_BY_INDEX = {v.index: LINE[v] for v in bm.verts if v in LINE}
me = bpy.data.meshes.new('Eyes_quad'); bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('Eyes_quad', me); bpy.context.scene.collection.objects.link(ob)
for p in me.polygons: p.use_smooth = True
uvl = me.uv_layers.new(name='lines')
for poly in me.polygons:
    for li in poly.loop_indices: uvl.data[li].uv = LINE_BY_INDEX.get(me.loops[li].vertex_index, (0, 0))
g = ob.vertex_groups.new(name='head'); g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
ob.parent = rig; am = ob.modifiers.new('Armature', 'ARMATURE'); am.object = rig
for part, grey in (('white', 0.92), ('iris', 0.6), ('pupil', 0.08), ('highlight', 1.0), ('lid', 0.25)):
    mt = bpy.data.materials.get('eye_' + part) or bpy.data.materials.new('eye_' + part)
    mt.diffuse_color = (grey, grey, grey, 1.0); me.materials.append(mt)
print('FIG eyes built: %s; %d points' % (report, len(me.vertices)))
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

"""Build the face's organs on a figure's head from the portrait, automatically: each is read from the portrait (eye_shapes.py)
and built as a basic structure aligned to the head, the same way for every character.
  eyes   carved relief (below); brows  ridges along the drawing's strokes;
  nose   the face's own structure: the cheek planes meeting in a bridge ridge down to a sharp tip and a short underside,
         its tip, height, length and width the head's own nose, rebuilt in the face's triangles (nose_structure, stitch_face);
  mouth  the drawing's line as a strip on the skin, as wide as the drawing's stroke at each point (ink).
usage: blender -b <figure.blend> -P eye_parts.py -- <eyes.json> <render-dir> <out.blend> [--seg=40] [--bulge=<mm>]
        [--organs=eyes,brows,nose,mouth] [--front=<build-dir>]
  <eyes.json>: eye_shapes.py (portrait pixels). <render-dir>: only read without --front (face_marks.py's marks.json, the
  portrait's 68 points, to fit the portrait onto the head's face points); the default (--front with a grafted bust) puts
  the portrait's own 28 points on the bust. The head stays as it is (its own triangles); the eyes are their own quads.
  A sculptor shows an eye in plain stone by form alone, not colour: the eyeball bulges, the iris is a cut ring with a
  shallow dish, the pupil a drilled hole (it reads dark because it is deep), the highlight a bump left standing, the lids
  rims with thickness. The eyes here are built the same way, so a one-colour hologram or a white render can show them.
  Every size is the portrait's (each part's outline and stroke width, in portrait pixels, through the portrait-to-head
  mapping); every depth is in one unit U, the bust's own relief around the eyes (how far its skin there departs from a
  smooth surface: the robust scale of the faired surface's fit, the two eyes' mean, as a mirror pair); how deep each cut of
  the eye goes in that unit is the portrait's own tone there (a carving reads dark because it is deep: a part's depth is U
  times its darkness against the white, as a lithophane is cut):
    faired surface  everything sits on a smooth surface fitted to the skin around the eye (hair skipped), each skin sample
                    weighted by a Cauchy weight of its miss over the median miss (bangs and locks fade, no cut-off);
    socket          the head's skin inside the opening pushed U behind that surface (the sculptor's cut socket), its wall
                    rising at 45 degrees outside the opening; only the head's triangles hidden under the eye (and one ring
                    of neighbours) are split for it; eye points the skin still covers (the lash wing where the face curves
                    back) are then moved out onto it, the shift spread over the part falling 1 mm per mm (45 degrees);
    opening         two smooth lid curves (upper, lower) that meet at the inner and outer corners as sharp nodes;
    eyeball         the white: a dome inside the opening, from the lid line up to U at its middle (--bulge overrides);
    iris            a cut: a step down at the iris's edge (an oval clipped by the lids) by U x the iris rim's darkness, then
                    a dish to U x the inner iris's darkness at the pupil;
    pupil           a drilled hole: down to U x the pupil's darkness, and a flat floor;
    highlights      the uncut eyeball left standing in the iris (higher still by U x how much brighter than the white);
    upper lid       the lash: a bar along the upper lid curve, as thick as the drawing's lash per column (its wing to where
                    the ink ends), one U in front of the eyeball, its rounded middle one U more, ends pinched;
    lower lid       a rim from the lower lid curve to where the drawing's lower line ends, rounded, as high as U where the
                    line is widest.
  Constants kept (structural or numeric): 40 outline points per eye (--seg), a shown radial every 5 (--radial) and a
  shown column every 4, the white's rings at 0, 0.3, 0.6, 1 of the way to the iris, the dish's rings in thirds, the pupil
  floor's ring half way in, the half-round section of every ridge (sqrt(1 - x^2)), the lash's ends pinched over one
  sample, 14 x 10 skin samples per faired surface, the quadratic surface model, polynomial degrees 0-6 tried (chosen by
  leave-one-out cross-validation), the iteration caps (convergence loops; 300 rim and 400 weight diffusion passes, 6 rounds
  of nose growth), 20000 bust points for the registration (speed), the 0.2 mm behind-skin test (also the settle's
  clearance), the materials' greys.
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
SEG = int(flags.get('seg', 40)); MM = 0.001; BULGE = float(flags['bulge']) * MM if flags.get('bulge') else None
TOL = 2e-4      # m: the behind-skin test's tolerance (numeric); the settle pass clears the skin by it
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; head = bpy.data.objects.get('Head') or bpy.data.objects['Head_quad']
eyes = json.load(open(EYES))
_hv = np.empty(3 * len(head.data.vertices)); head.data.vertices.foreach_get('co', _hv); _hv = _hv.reshape(-1, 3)
_he = np.empty(2 * len(head.data.edges), dtype=np.int64); head.data.edges.foreach_get('vertices', _he); _he = _he.reshape(-1, 2)
_hw = _hv @ np.array(head.matrix_world)[:3, :3].T
EDGE = float(np.median(np.linalg.norm(_hw[_he[:, 0]] - _hw[_he[:, 1]], axis=1)))   # the head's own triangle size (m)
SCALE_REPORT = {}
if flags.get('front') and 'bust_map' in rig:
    # front mapping onto a grafted bust: the bust was shaped from the portrait itself, so the portrait's own 28 points go
    # straight onto it: the portrait's figure outline registered onto the bust's front outline as imported (view_register:
    # one scale, a turn, a move, Cauchy-weighted both ways; not the figure box stretched onto the bust's bounds, which
    # gave x and z two scales), then head_swap's placement of the bust (bust_map's M)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from view_register import register
    FD = flags['front']; bmap = json.loads(rig['bust_map']); Mb = np.array(bmap['M']); lo, hi = np.array(bmap['lo']), np.array(bmap['hi'])
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(FD, 'bust.glb'))
    BP = []
    for o in [o for o in bpy.data.objects if o not in before]:
        if o.type == 'MESH':
            a = np.empty(3 * len(o.data.vertices)); o.data.vertices.foreach_get('co', a); Mw_ = np.array(o.matrix_world)
            BP.append(a.reshape(-1, 3) @ Mw_[:3, :3].T + Mw_[:3, 3])
        bpy.data.objects.remove(o, do_unlink=True)
    BP = np.concatenate(BP)
    BP = BP[np.linspace(0, len(BP) - 1, min(len(BP), 20000)).astype(int)]     # an even stride through the points (speed only)
    mask = np.load(os.path.join(FD, 'prep_portrait', 'mask.npy'))
    reg = register(mask, BP); pp = np.array(eyes['points28'], float)[:, :2]
    X, Z = reg.to_mesh(pp[:, 0], pp[:, 1])
    Q = np.stack([X, np.full(len(X), (lo[1] + hi[1]) / 2), Z, np.ones(len(X))], 1) @ Mb.T
    mp = Q[:, [0, 2]]
    bx0, by0, bx1, by1 = bmap['bbox']                                      # the old figure-box mapping, for the report only
    Xb = lo[0] + (pp[:, 0] - bx0) / (bx1 - bx0) * (hi[0] - lo[0]); Zb = lo[2] + (by1 - pp[:, 1]) / (by1 - by0) * (hi[2] - lo[2])
    Qb = np.stack([Xb, np.full(len(Xb), (lo[1] + hi[1]) / 2), Zb, np.ones(len(Xb))], 1) @ Mb.T
    _mv = 1000 * np.linalg.norm(Q[:, [0, 2]] - Qb[:, [0, 2]], axis=1)
    SCALE_REPORT = {'registration': {k: (np.round(v, 3).tolist() if isinstance(v, list) else round(float(v), 6)) for k, v in reg.report.items()},
                    'bust bounds vs import mm': np.round(1000 * (np.r_[BP.min(0), BP.max(0)] - np.r_[lo, hi]), 1).tolist(),
                    'moved from the figure-box mapping mm (median, max)': [round(float(np.median(_mv)), 2), round(float(_mv.max()), 2)]}
    print('FIG front mapping: the portrait\'s 28 points onto the bust by outline registration: %s' % SCALE_REPORT)
elif flags.get('front'):
    # (not the default: a head without a bust) front mapping: the 3D shape was made from the T-pose drawing seen from the
    # front, so a point of that drawing lies on the mesh straight behind it. The portrait's 28 face points are traced to the
    # T-pose through the head crop (the same detector's 28 points found in the crop, the crop's box in the T-pose), then
    # into the mesh through the drawing's figure box and the mesh's bounds (as dress_rig.py and head_swap.py map joints)
    FD = flags['front']
    c28 = np.array(json.load(open(os.path.join(FD, 'eyes', 'crop28.json')))['points28'])
    box = json.load(open(os.path.join(FD, 'head_crop.json'))); (cx0, cy0, cx1, cy1), csz = box['crop'], box['size']
    view = json.load(open(os.path.join(FD, 'prep', 'view.json'))); bx0, by0, bx1, by1 = view['bbox']
    V = np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in bpy.data.objects
                        if o.type == 'MESH' and (o.name.startswith('Outfit') or o.name == 'Head')])
    lo, hi = V.min(0), V.max(0)
    tx = cx0 + c28[:, 0] * (cx1 - cx0) / csz; ty = cy0 + c28[:, 1] * (cy1 - cy0) / csz
    mp = np.stack([lo[0] + (tx - bx0) / (bx1 - bx0) * (hi[0] - lo[0]), lo[2] + (by1 - ty) / (by1 - by0) * (hi[2] - lo[2])], 1)
    pp = np.array(eyes['points28'], float)[:, :2]
    print('FIG front mapping: 28 portrait points through the head crop onto the mesh')
else:
    # (not the default) the portrait's 68 points onto the head's 68 face points (face_marks.py's marks.json)
    F = json.loads(rig['figure_face']); M3 = {int(k): np.array(v) for k, v in F['marks'].items()}
    marks = json.load(open(os.path.join(RDIR, 'marks.json')))
    pp = np.array([p[:2] for p in marks['portrait']['points']]); mp = np.array([[M3[i][0], M3[i][2]] for i in range(68)])
src = np.stack([pp[:, 0], -pp[:, 1]], 1); mu_s, mu_d = src.mean(0), mp.mean(0); S0, D0 = src - mu_s, mp - mu_d
U_, sig, Vt = np.linalg.svd(D0.T @ S0); Rm = U_ @ Vt; scale = sig.sum() / (S0 ** 2).sum(); tr = mu_d - scale * Rm @ mu_s
def to_xz(u, v): q = scale * (Rm @ np.array([u, -v])) + tr; return float(q[0]), float(q[1])
px_mm = 1.0 / (1000 * scale)                                            # portrait pixels per mm, from that same mapping
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
# which of the head's faces are hair: a point is hair when its hair chains' weights outweigh all its other weights; a ray
# to the skin passes through faces with a hair point
_hn = {g.index: g.name for g in head.vertex_groups}
def hair_major(pairs):
    """pairs: (group name, weight) of one point; hair when the hair chains' weights outweigh the rest"""
    pairs = list(pairs); h = sum(w for n, w in pairs if n.startswith('hair')); return h > sum(w for n, w in pairs) - h
_vh = [hair_major((_hn[g.group], g.weight) for g in v.groups) for v in head.data.vertices]
HAIRY = [any(_vh[i] for i in p.vertices) for p in head.data.polygons]
def first_skin(tree, hairy, x, z, sheet=None):
    """the skin along a ray from the front: past faces of hair, and past thin sheets (a front face with a back face less
    than one of the head's own triangles (its median edge) behind it: a lock of bangs not weighted as hair, as on a
    character whose bangs are fused; no solid part of the face is thinner than the triangles it is made of)"""
    sheet = EDGE if sheet is None else sheet
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
def skin_hit_head(x, z): return first_skin(bvh, lambda fi: fi is not None and fi < len(HAIRY) and HAIRY[fi], x, z)
def skin_hit(x, z):
    # once the face grid is built (and until the face is cut for it), parts placed on the skin sit on the grid's surface
    if GRID['bvh'] is not None:
        loc, nrm, fi, d = GRID['bvh'].ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
        if loc is not None: return loc
    return skin_hit_head(x, z)
bm = bmesh.new()
MAT = {'white': 0, 'iris': 1, 'pupil': 2, 'highlight': 3, 'lid': 4, 'brow': 5, 'nose': 6, 'lip': 7, 'mouth': 8, 'inner': 9, 'teeth': 10, 'skin': 11, 'grid': 12}
ORGANS = set(flags.get('organs', 'eyes,brows,nose,mouth').split(','))   # all by default; a subset to build only some
STITCH = []     # face regions rebuilt as structure (the nose): outline level, target surface, structural lines
BRIDGE = {}     # the rebuilt region's copies of the face's rim points -> the head's point (same place, same weights)
PIN = set()     # points on the face's own surface (rim copies, the rebuilt region): the settle pass leaves them
STEINER = set() # the rebuilt region's own points (their weights blend from the rim)
FACE_QUAD = flags.get('face', '') == 'quad'   # the face as one quad grid (test, not the default): face_grid()
GRID = {'bvh': None, 'faces': [], 'w': {}}      # the face grid: its surface (once built), faces, points' head weights
NOSE_FORM = {}  # the nose's structural surface (nose_structure), for the face grid's depth
PROUD = {}      # raised strokes' points -> their own height over the surface they lie on (m): the settle keeps it
CAP = {}        # per material: how far the settle pass may move a point out (the eyeball's parts: the eye's own depth)

def cauchy_fit(A, y, w0=None):
    """least squares A c = y, each row weighted by a Cauchy weight of its miss over the median miss (no cut-off), iterated
    until the fit stops changing; returns (c, weights, scale = the median miss)"""
    w0 = np.ones(len(y)) if w0 is None else np.asarray(w0, float); w = w0.copy(); c = None; s = 0.0
    for _ in range(200):
        sw = np.sqrt(w); c2 = np.linalg.lstsq(A * sw[:, None], y * sw, rcond=None)[0]
        r = np.abs(A @ c2 - y); s = float(np.median(r[w0 > 0])) if (w0 > 0).any() else 0.0
        done = c is not None and np.allclose(c2, c, rtol=1e-7, atol=1e-12); c = c2
        if s <= 1e-12 or done: break
        w = w0 / (1 + (r / s) ** 2)
    return c, w, s

def robust_poly(x, y, w0=None, max_deg=6):
    """a polynomial y(x) fitted with Cauchy weights, at the degree with the smallest leave-one-out miss; returns
    (function, weights, scale). x is centred and scaled to its own spread (conditioning only)."""
    x = np.asarray(x, float); y = np.asarray(y, float); w0 = np.ones(len(x)) if w0 is None else np.asarray(w0, float)
    mu, sd = float(x.mean()), float(x.std()) or 1.0; t = (x - mu) / sd; best = None
    for deg in range(0, max(0, min(max_deg, int((w0 > 0).sum()) - 2)) + 1):
        A = np.vander(t, deg + 1); c, w, s = cauchy_fit(A, y, w0); Wd = w / max(1e-12, w.max())
        H = A @ np.linalg.pinv((A * Wd[:, None]).T @ A) @ (A * Wd[:, None]).T
        e = (A @ c - y) / np.maximum(1e-6, 1 - np.diag(H)); cv = float(np.sum(Wd * e * e) / max(1e-12, Wd.sum()))
        if best is None or cv < best[0]: best = (cv, c, w, s)
    _, c, w, s = best
    return (lambda q, c=c: np.polyval(c, (np.asarray(q, float) - mu) / sd)), w, s

def faired_surface(box):
    """depth y as a quadratic in (x, z) fitted to the skin over the box: the eye's own smooth, round surface. Robust: hits
    on bangs or a lock hanging in front of the face stand out from the skin and fade by their Cauchy weight. Returns
    at(u, v, lift), a report function, the fit's scale (median miss, m), its weighted rms (m), the mean weight."""
    (u0, v0, u1, v1) = box; pts = []
    for u in np.linspace(u0, u1, 14):
        for v in np.linspace(v0, v1, 10):
            x, z = to_xz(u, v); hit = skin_hit(x, z)
            if hit is not None: pts.append((x, z, hit.y))
    P = np.array(pts); A = np.stack([np.ones(len(P)), P[:, 0], P[:, 1], P[:, 0] ** 2, P[:, 0] * P[:, 1], P[:, 1] ** 2], 1)
    c, w, s = cauchy_fit(A, P[:, 2])
    def surf_y(x, z): return c[0] + c[1] * x + c[2] * z + c[3] * x * x + c[4] * x * z + c[5] * z * z
    shift = [0.0]
    def at(u, v, lift):
        x, z = to_xz(u, v); y = surf_y(x, z)
        n = Vector((-(c[1] + 2 * c[3] * x + c[4] * z), 1.0, -(c[2] + c[4] * x + 2 * c[5] * z))).normalized()
        return Vector((x, y, z)) - n * (lift + shift[0])       # the face is at -y: out of the surface is -n
    def clear_skin(points2d):
        """how far the skin inside the eye stands in front of the surface (report)"""
        d = [surf_y(*to_xz(u, v)) - h.y for u, v in points2d for h in [skin_hit(*to_xz(u, v))] if h is not None]
        return float(max(d + [0.0]))
    clear_skin.reset = lambda: None
    rms = float(np.sqrt(np.sum(w * (A @ c - P[:, 2]) ** 2) / max(1e-12, w.sum())))
    return at, clear_skin, s, rms, float(w.mean())

def smooth01(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)

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
        # a robust polynomial (Cauchy weights, degree by cross-validation) through the lid's points and the corners; the
        # corners are then met exactly (below), so they need no extra weight
        x = np.r_[A[0], P[:, 0], B[0]]; y = np.r_[A[1], P[:, 1], B[1]]
        f, _, _ = robust_poly(x, y)
        t = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_half + 1))           # denser toward the corners
        xs = A[0] + (B[0] - A[0]) * t; ys = f(xs)
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
K28 = np.array(eyes['points28'], float)
G0x = 0.5 * (eyes['eye_r']['corners']['inner'][0] + eyes['eye_l']['corners']['inner'][0])     # the face's middle
def eye_box(curve):
    """the skin around an eye, from the detector's 28 points: up to its brow (the brow nearer it sideways), down to the
    nose point's height (the cheek), out to the jaw contour on its side and in to the face's middle"""
    cx = curve[:, 0].mean(); B = min((K28[[5, 6, 7]], K28[[8, 9, 10]]), key=lambda b: abs(b[:, 0].mean() - cx))
    outer = K28[0:5, 0].min() if cx < G0x else K28[0:5, 0].max()
    return (min(outer, G0x), float(B[:, 1].min()), max(outer, G0x), float(K28[23][1]))
# first pass: each eye's opening and faired surface; the depth unit U is the bust's relief around the eyes (the faired
# fits' median miss, the two eyes' mean: a mirror pair, so both eyes are carved alike)
EYE = {}
for name in ('eye_r', 'eye_l'):
    e = eyes[name]; Up, Lo, curve = lid_curves(e, SEG // 2); c = curve.mean(0)
    at, clear_skin, fit_med, fit_rms, kept = faired_surface(eye_box(curve))
    EYE[name] = (e, Up, Lo, curve, c, at, clear_skin, fit_med, fit_rms, kept)
U = float(np.mean([EYE[k][7] for k in EYE])); U_mm = U / MM
DOME = (BULGE if BULGE is not None else U) / MM
CAP.update({MAT[k]: 2 * U for k in ('white', 'iris', 'pupil', 'highlight')})   # the eye's own depth: socket U + dome U
for name in ('eye_r', 'eye_l'):
    e, Up, Lo, curve, c, at, clear_skin, fit_med, fit_rms, kept = EYE[name]
    span = np.ptp(curve[:, 0])
    # the socket: skin inside the opening pushed back behind the eye, as a sculptor cuts the socket before setting the
    # eyeball (moving the eye out instead left it standing proud of the face like a plate); the report says how far the
    # skin stood in front of the eye's surface before
    shift = clear_skin([tuple(c + r * (q - c)) for r in (0.95, 0.6, 0.25) for q in curve[::2]]); clear_skin.reset()
    SOCKETS.append((at, c, curve))
    def ball(u, v):
        """the eyeball's height (mm) over the faired surface: a dome, 0 at the lid line, DOME in the middle"""
        d = np.array([u, v]) - c; rho = min(1.0, np.hypot(*d) / max(1e-6, ray_radius(curve, c, math.atan2(d[1], d[0]))))
        return DOME * (1 - rho * rho)
    # each cut's depth: U times its darkness against the white (the portrait's tones, eye_shapes)
    tn = e['tones']; Yw = tn['white']
    dk = lambda Y, Yd=None: None if Y is None else U_mm * (1 - Y / Yw)
    d_out = dk(tn['iris_outer']) or 0.0; d_in = dk(tn['iris_inner']); d_in = d_out if d_in is None else d_in
    n = 0
    # the iris's edge and the pupil's edge, seen from the iris centre along the direction of each opening point (so the
    # rings from the opening inward have equal counts and run in the same order); the iris clipped by the lids themselves
    # and smoothed over its own outline's slack (eye_shapes: how far the drawn outline strays from its ellipse), in samples
    ir = e['iris']; ic = np.array(ir['centre']); pu = e.get('pupil')
    ang = np.array([math.atan2(q[1] - ic[1], q[0] - ic[0]) for q in curve])
    rad = np.minimum(oval_radius(ir, ic, ang), ray_radius(curve, ic, ang))
    step_px = float(np.median(rad * np.abs(np.diff(np.r_[ang, ang[0] + 2 * np.pi]) % (2 * np.pi))))
    w_s = int(round(ir.get('fit_px', 0.0) / max(1e-6, step_px)))
    if w_s > 0: rad = smooth_ring(rad, w_s)
    iris_edge = ic + np.stack([np.cos(ang), np.sin(ang)], 1) * rad[:, None]
    lerp = lambda A, B, t: A + (B - A) * t
    rings, mats = [], []
    for t in (0.0, 0.3, 0.6, 1.0):                                         # the eyeball, from the lid line to the iris
        R = lerp(curve, iris_edge, t); rings.append([(u, v, ball(u, v)) for u, v in R]); mats.append(MAT['white'])
    rings.append([(u, v, ball(u, v) - d_out) for u, v in iris_edge]); mats[-1] = MAT['white']; mats.append(MAT['iris'])  # the iris's cut
    W, I, P = MAT['white'], MAT['iris'], MAT['pupil']
    if pu is not None:
        pc = np.array(pu['centre'])
        prad = np.minimum(oval_radius(pu, pc, ang), np.array([ray_radius(iris_edge, pc, a) for a in ang]))   # inside the iris
        pupil_edge = pc + np.stack([np.cos(ang), np.sin(ang)], 1) * prad[:, None]
        for t in (1 / 3, 2 / 3, 1.0):                                      # the iris's dish, toward the pupil
            R = lerp(iris_edge, pupil_edge, t); rings.append([(u, v, ball(u, v) - (d_out + (d_in - d_out) * t)) for u, v in R]); mats.append(MAT['iris'])
        d_p = dk(tn['pupil']); d_p = d_in if d_p is None else d_p
        rings.append([(u, v, ball(u, v) - d_p) for u, v in pupil_edge]); mats.append(MAT['pupil'])                      # the drilled hole
        floor_h = min(h for *_, h in rings[-1])
        rings.append([(u, v, floor_h) for u, v in lerp(pupil_edge, np.tile(pc, (len(pupil_edge), 1)), 0.5)]); mats.append(MAT['pupil'])
        n += bands(at, rings, [W, W, W, I, I, I, I, P, P], centre=(pc[0], pc[1], floor_h),
                   show=[1, 0, 1, 0, 0, 0, 1, 0, 0, 0], every=RADIAL, radial_to=7)   # radials stop at the pupil's rim: a hole, no lines in it   # the cuts' walls belong to the part inside
        PARTS['pupil'] = PARTS.get('pupil', []) + [pupil_edge.tolist()]
    else:   # no pupil in the portrait: the dish runs to the iris's centre
        pc = ic; pupil_edge = np.tile(ic, (len(iris_edge), 1)); d_p = d_in
        for t in (1 / 3, 2 / 3):
            R = lerp(iris_edge, pupil_edge, t); rings.append([(u, v, ball(u, v) - (d_out + (d_in - d_out) * t)) for u, v in R]); mats.append(MAT['iris'])
        n += bands(at, rings, [W, W, W, I, I, I], centre=(ic[0], ic[1], ball(*ic) - d_in), show=[1, 0, 1, 0, 0, 0, 1], every=RADIAL)
    PARTS['white'] = PARTS.get('white', []) + [curve.tolist()]; PARTS['iris'] = PARTS.get('iris', []) + [iris_edge.tolist()]
    def iris_level(u, v):
        """the carved surface's height (mm) at a point of the eye: the dome, less the iris's cut and dish, less the hole"""
        p = np.array([u, v]); d = p - ic; a = math.atan2(d[1], d[0]); r = np.hypot(*d)
        ri = ray_radius(iris_edge, ic, a)
        if r >= ri: return ball(u, v)
        rp = ray_radius(pupil_edge, ic, a) if pu is not None else 0.0
        if r <= rp: return ball(u, v) - d_p
        t = (ri - r) / max(1e-6, ri - rp); return ball(u, v) - (d_out + (d_in - d_out) * t)
    # highlights: the uncut eyeball left standing in the iris: the rim on the carved surface around it, the top at the dome
    # (raised by U times how much brighter than the white the highlight is drawn), a half-round in between
    for h in e['highlights']:
        hc = h['centre']; top_ = ball(*hc) + max(0.0, -(dk(tn['highlight']) or 0.0))
        rim = [(u, v, iris_level(u, v)) for u, v in oval(h, 12)]
        mid_ = [(u, v, l_ + (top_ - l_) * math.sqrt(1 - 0.5 ** 2)) for (u, v), (_, _, l_) in zip(oval(h, 12, 0.5), rim)]
        n += bands(at, [rim, mid_], [MAT['highlight']], centre=(hc[0], hc[1], top_))
        PARTS.setdefault('highlight', []).append(oval(h, 12).tolist())
    # the lower lid: a rim from the lower lid curve out to where the drawing's lower line ends (eye_shapes' lower_line, per
    # column), half-round in section, as high as U where the line is widest; the corners exact nodes on the lid line
    LL = np.array(e.get('lower_line', []), float).reshape(-1, 3)
    m = len(Lo)
    if len(LL) >= 2:
        LL = LL[np.argsort(LL[:, 0])]
        far = np.interp(Lo[:, 0], LL[:, 0], LL[:, 1] + LL[:, 2] / 2, left=np.nan, right=np.nan)
        wdt = np.where(np.isnan(far), 0.0, np.maximum(0.0, far - Lo[:, 1])); wdt[[0, -1]] = 0.0
        hgt = U_mm * wdt / max(1e-9, wdt.max())
        rows = [Lo, Lo + np.stack([np.zeros(m), 0.5 * wdt], 1), Lo + np.stack([np.zeros(m), wdt], 1)]
        lifts = [lambda i: 0.0, lambda i: hgt[i], lambda i: 0.0]
        G = [[bm.verts.new(at(*rows[k][i], lifts[k](i) * MM)) if 0 < i < m - 1 else None for i in range(m)] for k in range(3)]
        for k in range(3):
            for i in range(1, m - 1): PROUD[G[k][i]] = lifts[k](i) * MM
        ends = {0: bm.verts.new(at(*Lo[0], 0.0)), m - 1: bm.verts.new(at(*Lo[-1], 0.0))}
        for k in range(3):
            for i in (0, m - 1): G[k][i] = ends[i]
        for i in range(1, m - 1):
            flag(G[1][i], 1, 0)
            if i % 4 == 0:
                for k in range(3): flag(G[k][i], 0, 1)
        for i in range(m - 1):
            for k in range(2): n += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), MAT['lid'])
        PARTS.setdefault('lid', []).append(np.vstack([rows[0], rows[2][::-1]]).tolist())
    # the upper lid: the lash, a bar along the upper lid curve as thick as the drawing's lash per column
    L = np.array(e['upper_lash'], float).reshape(-1, 3)
    if len(L) >= 4:
        L = L[np.argsort(L[:, 0])]
        # a column whose lower edge leaves the lid's line (a dark hair strand read as lash) fades by its Cauchy weight; the
        # thickness the same way, leaning to its smooth fit where the fit doubts it
        lo_ = L[:, 1] + L[:, 2] / 2; _, wl, _ = robust_poly(L[:, 0], lo_)
        ft, wt, _ = robust_poly(L[:, 0], L[:, 2], w0=wl); a_ = wt / max(1e-12, wt.max())
        thick = np.maximum(0.0, a_ * L[:, 2] + (1 - a_) * ft(L[:, 0]))
        xs = np.linspace(L[0, 0], L[-1, 0], 28); tk = np.interp(xs, L[:, 0], thick)
        top = Up[np.argsort(Up[:, 0])]
        # one smooth lower edge: a robust polynomial through the upper lid curve and the lash's own lower edge beyond it,
        # each source weighted by the inverse of its own miss variance (re-estimated until the weights settle)
        out_ = (L[:, 0] < top[0, 0]) | (L[:, 0] > top[-1, 0])
        X_ = np.r_[top[:, 0], L[out_, 0]]; Y_ = np.r_[top[:, 1], L[out_, 1] + L[out_, 2] / 2]
        src = np.r_[np.zeros(len(top), int), np.ones(int(out_.sum()), int)]; base = np.r_[np.ones(len(top)), wl[out_]]
        ws = np.ones(2)
        for _ in range(50):
            fl, w_, _ = robust_poly(X_, Y_, w0=base * ws[src]); r_ = fl(X_) - Y_
            var = np.array([np.sum(w_[src == k] * r_[src == k] ** 2) / max(1e-12, w_[src == k].sum()) if (src == k).any() else 1.0 for k in (0, 1)])
            new = 1 / np.maximum(var, 1e-12); new /= new.max()
            if np.allclose(new, ws, rtol=1e-3): break
            ws = new
        lower = fl(xs)
        rows = [(lower - tk * f) for f in (0.0, 0.5, 1.0)]
        m = len(xs)
        close = np.ones(m); close[[0, -1]] = 0.0; close[[1, -2]] = 0.5       # both ends pinched to a point over one sample
        mid = (rows[0] + rows[2]) / 2
        def lift(k, i, front):
            # the back on the eyeball's lid line (0), the front one U out, its middle row (rounded) one U more; the ends
            # half way between back and front
            full = (U_mm * (2.0 if k == 1 else 1.0)) if front else 0.0
            return (0.5 * U_mm + (full - 0.5 * U_mm) * close[i]) * MM
        G = {}
        for i in range(m):
            if close[i] == 0: v = bm.verts.new(at(xs[i], mid[i], 0.5 * U)); PROUD[v] = 0.5 * U; G.update({(f, k, i): v for f in (0, 1) for k in range(3)}); continue
            for f in (0, 1):
                for k in range(3):
                    y = mid[i] + (rows[k][i] - mid[i]) * close[i]
                    G[(f, k, i)] = bm.verts.new(at(xs[i], y, lift(k, i, f))); PROUD[G[(f, k, i)]] = lift(k, i, f)
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
    report[name] = {'faces': n, 'surface fit median mm': round(1000 * fit_med, 2), 'weighted rms mm': round(1000 * fit_rms, 2),
                    'skin hits kept (mean weight)': round(kept, 2), 'skin in front before mm': round(1000 * shift, 2),
                    'depths mm (dome, iris rim, iris inner, pupil)': [round(DOME, 2), round(d_out, 2), round(d_in, 2), round(d_p, 2)],
                    'lash px': (round(float(np.median(L[:, 2])), 1) if len(L) else 0), 'lower line columns': len(LL)}
report['depth unit U mm'] = round(U_mm, 2)
def skin_path(P):
    """the skin's depth along a stroke's path (portrait pixels): the hits (nan where none), one smooth robust curve through
    them (Cauchy weights, degree by cross-validation) that never leaves the range of the skin it found nor goes under it,
    and the skin's own bumps about that curve (the median miss, m)"""
    s_ = np.linspace(0, 1, len(P)); ys = np.array([(lambda h: np.nan if h is None else h.y)(skin_hit(*to_xz(*q))) for q in P])
    ok_ = ~np.isnan(ys)
    if ok_.sum() < 3: return None
    f_, _, _ = robust_poly(s_[ok_], ys[ok_])
    ysm = np.clip(f_(s_), np.nanmin(ys), np.nanmax(ys)); ysm = np.minimum(ysm, np.where(ok_, ys, np.inf))
    return ys, ysm, float(np.median(np.abs(ys[ok_] - f_(s_[ok_]))))
def ridge(line, mat, height, cols=4):
    """a stroke as a carved ridge: a strip along the stroke's path as wide as the drawing's stroke there (eye_shapes),
    half-round in section, `height` (m) high along its middle, closed to points at both ends"""
    L = np.array(line, float); P = L[:, :2].copy(); n_ = len(P)
    d = np.gradient(P, axis=0); nrm = np.stack([-d[:, 1], d[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    if nrm[:, 1].mean() < 0: nrm = -nrm                                # pointing down the picture
    tp = np.ones(n_); tp[[0, -1]] = 0.0; half = 0.5 * L[:, 2] * tp
    # a stroke is narrow: it follows the real skin along its path (a surface fitted over the area flattens a nose and the
    # brow's ridge), the skin's depth smoothed along the stroke so the ridge runs as one even curve; its foot stands clear
    # of the skin's own bumps along the path
    sp = skin_path(P)
    if sp is None: return 0
    ys, ysm, base = sp
    def at_(u, v, lift, i):
        x, z = to_xz(u, v); return Vector((x, ysm[i] - lift, z))
    rows = [P - nrm * half[:, None], P - nrm * (0.5 * half)[:, None], P, P + nrm * (0.5 * half)[:, None], P + nrm * half[:, None]]
    prof = [math.sqrt(max(0.0, 1 - x * x)) for x in (-1.0, -0.5, 0.0, 0.5, 1.0)]   # a half-round section
    G = [[None] * n_ for _ in rows]; nf = 0
    for i in range(n_):
        if tp[i] == 0:
            v = bm.verts.new(at_(*P[i], base, i)); PROUD[v] = base
            for k in range(len(rows)): G[k][i] = v
            continue
        for k in range(len(rows)):
            G[k][i] = bm.verts.new(at_(*rows[k][i], base + height * prof[k], i)); PROUD[G[k][i]] = base + height * prof[k]
    for i in range(n_):
        flag(G[2][i], 1, 0)
        if i % cols == 0:
            for k in range(len(rows)): flag(G[k][i], 0, 1)
    for i in range(n_ - 1):
        for k in range(len(rows) - 1): nf += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), mat)
    PARTS.setdefault(next(k for k, v in MAT.items() if v == mat), []).append(np.vstack([rows[0], rows[-1][::-1]]).tolist())
    return nf
def ink(P, half_px, mat):
    """a drawn line as the tutorial models it: one strip of faces lying on the face, dark (as the pupil's hole is dark),
    as wide as the drawing's stroke at each point; its outline is the line the hologram draws. P: the stroke's path in
    portrait pixels; half_px: its half width there (0 closes it to a point). The strip follows the real skin along its
    path: its middle on the skin's smooth curve, its sides out by the skin's own bumps along the path (a line cut a little
    into the surface)."""
    P = np.asarray(P, float); half = np.asarray(half_px, float); n_ = len(P); s_ = np.linspace(0, 1, n_)
    d = np.gradient(P, axis=0); nrm = np.stack([-d[:, 1], d[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    rows = [P - nrm * half[:, None], P, P + nrm * half[:, None]]
    # the skin's depth along the stroke (the nearest of all three rows), as one smooth curve that never goes under it
    ys = np.array([[(lambda h: np.nan if h is None else h.y)(skin_hit(*to_xz(*q))) for q in r] for r in rows])
    yc = np.nanmin(ys, 0); ok_ = ~np.isnan(yc)
    if ok_.sum() < 3: return 0
    f_, _, _ = robust_poly(s_[ok_], yc[ok_]); ysm = np.minimum(f_(s_), np.where(ok_, yc, np.inf))
    edge = float(np.median(np.abs(yc[ok_] - f_(s_[ok_]))))
    G = [[None] * n_ for _ in range(3)]
    for k in range(3):
        for i in range(n_):
            x, z = to_xz(*rows[k][i]); G[k][i] = bm.verts.new(Vector((x, ysm[i] - (0.0 if k == 1 else edge), z))); PROUD[G[k][i]] = 0.0 if k == 1 else edge
    nf = 0
    for i in range(n_ - 1):
        for k in range(2): nf += face((G[k][i], G[k][i + 1], G[k + 1][i + 1], G[k + 1][i]), mat)
    PARTS.setdefault(next(k for k, v in MAT.items() if v == mat), []).append(np.vstack([rows[0], rows[2][::-1]]).round(1).tolist())
    return nf
DIN = float(np.linalg.norm(np.array(eyes['eye_r']['corners']['inner']) - np.array(eyes['eye_l']['corners']['inner'])))   # (face grid only)
def nose_structure():
    """the nose as the face's own structure, the way the tutorial's loops make it: not a bump set on a flat face but the
    two cheek planes running together into a ridge (the bridge) that rises to the tip, where a short underside cuts back
    to the face above the mouth. All of it the head's own nose, measured against a surface faired over the face around it
    (between the eyes' centres, from the inner eye corners down to the mouth's top; Cauchy-weighted, so the nose itself and any
    lock fade from the fit): the tip is the top of the head's rise out of that surface reached from the portrait's nose point;
    the bridge runs up and the underside down (half way to the mouth's top at most) as far as the head stays more than the surface fit's own scale (its median
    miss) above it; the cheek planes' slope is a line fitted to the head's own fall across the nose; the profile's curvature up and down is fitted to the head's own rise along the
    face's axis (least squares on the logarithms); the region rebuilt is the head nose's own footprint at that scale. The
    region is rebuilt in the face (stitch_face) with the bridge and the tip's cross line as real edges, so both stay sharp;
    the cheek planes meet the face smoothly (a soft foot as wide as the surface's own scale)."""
    G0 = 0.5 * (np.array(eyes['eye_r']['corners']['inner']) + np.array(eyes['eye_l']['corners']['inner']))
    Mth = np.array(eyes['mouth']['line'], float); Mc = Mth[:, :2].mean(0)
    ea = (Mc - G0) / np.linalg.norm(Mc - G0); el = np.array([-ea[1], ea[0]])          # down the face, across it
    K = K28[23]
    xr = sorted([eyes['eye_r']['iris']['centre'][0], eyes['eye_l']['iris']['centre'][0]])
    Mt = K28[25]                                                                       # the mouth's top (detector)
    nbox = (xr[0], G0[1], xr[1], float(Mt[1]))
    at_f, _, sig, _, _ = faired_surface(nbox)
    sig_mm = sig / MM
    def res(p):
        h = skin_hit(*to_xz(*p)); return None if h is None else (at_f(float(p[0]), float(p[1]), 0.0).y - h.y) / MM
    # the tip: from the portrait's nose point, up the head's own rise out of that surface (steepest ascent, a portrait pixel
    # at a time, to the top), so the tip is the head's nose nearest the drawing's, wherever its maximum lies
    stp = 1.0
    nbr = [np.array([du, dv], float) for du in (-1, 0, 1) for dv in (-1, 0, 1) if du or dv]
    p0 = np.array(K, float); r0 = res(p0)
    while r0 is not None:
        cand = [(res(p0 + d), p0 + d) for d in nbr if nbox[0] <= (p0 + d)[0] <= nbox[2] and nbox[1] <= (p0 + d)[1] <= nbox[3]]
        cand = [c for c in cand if c[0] is not None]
        if not cand: break
        r1, p1 = max(cand, key=lambda c: c[0])
        if r1 <= r0: break
        r0, p0 = r1, p1
    best = (r0 if r0 is not None else -np.inf, p0)
    H, T = float(best[0]), best[1]
    if H <= sig_mm: return {'no nose: the head stands no further out than the surface\'s own scale mm': [round(H, 2), round(sig_mm, 2)]}
    def walk(direction, limit_px, level):
        """how far (px) from the tip along a direction the head stays above `level` mm over the surface, and its rise there"""
        dd, prof = 0.0, []
        while dd + stp <= limit_px:
            r = res(T + (dd + stp) * direction)
            if r is None or r <= level: break
            dd += stp; prof.append((dd, r))
        return max(dd, stp), prof
    # how far the nose may reach: up to the inner eye corners' line, down half way to the mouth's top, sideways half way to
    # the eyes' centres (half way to the neighbouring organ: the mouth's line keeps skin of its own under it)
    lim_up, lim_dn, lim_side = float((T - G0) @ ea), 0.5 * float((Mt - T) @ ea), 0.5 * (xr[1] - xr[0])
    Ltop, pr_up = walk(-ea, lim_up, sig_mm); Lbot, pr_dn = walk(ea, lim_dn, sig_mm)
    (wl_, pr_l), (wr_, pr_r) = walk(-el, lim_side, sig_mm), walk(el, lim_side, sig_mm)
    # the cheek planes' slope: a line from the tip's height fitted (least squares) to the head's own fall across the nose,
    # both sides, down to the surface's scale; the nose's half width is where that line meets the surface
    q_ = pr_l + pr_r; k_px = sum((H - r) * dd for dd, r in q_) / sum(dd * dd for dd, r in q_) if q_ else H / (0.5 * (wl_ + wr_))
    wt = H / k_px
    fwhm = 0.5 * (next((dd for dd, r in pr_l if r <= H / 2), wl_) + next((dd for dd, r in pr_r if r <= H / 2), wr_))
    # the region rebuilt: the nose's own footprint (where the head stands out of the surface by more than its scale);
    # beyond it the head's skin stays (rebuilding out to where the head meets the surface sank the cheeks onto the
    # faired surface, a pit around the nose)
    up, dn, side = Ltop, Lbot, max(wt, 0.5 * (wl_ + wr_))
    def expo(prof, L):
        """h = H (1 - d/L)^p fitted to the head's rise (least squares on the logarithms); a straight profile without samples"""
        q = [(math.log(1 - dd / L), math.log(r / H)) for dd, r in prof if 0 < dd < L and 0 < r <= H]
        return sum(a * b for a, b in q) / sum(a * a for a, b in q) if q and sum(a * a for a, b in q) > 0 else 1.0
    p_up, p_dn = expo(pr_up, Ltop), expo(pr_dn, Lbot)
    B = T - Ltop * ea; Sn = T + Lbot * ea                                              # the bridge's start, the underside's foot
    k = H / (wt / px_mm)                                                               # cheek slope (mm per mm)
    def frame(u, v):
        d = np.array([u, v]) - T; return float(d @ ea), float(d @ el)
    def rise(u, v):
        a_, l_ = frame(u, v)
        h = H * np.clip(1 + a_ / Ltop, 0, 1) ** p_up if a_ <= 0 else H * np.clip(1 - a_ / Lbot, 0, 1) ** p_dn
        o = h - k * abs(l_) / px_mm; e = sig_mm                                        # mm; a soft foot on the cheeks
        return 0.5 * (o + math.sqrt(o * o + e * e)) - 0.5 * e
    def target(u, v): return at_f(u, v, rise(u, v) * MM)
    def lv(u, v):
        a_, l_ = frame(u, v); return abs(l_) / side + (-a_ / up if a_ < 0 else a_ / dn)
    # the structural lines: the bridge down to the tip and on under it, and the tip's cross line out to the cheeks
    lines = [[tuple(B + t * (T - B)) for t in np.linspace(0, 1, 6)] + [tuple(T + t * (Sn - T)) for t in np.linspace(0, 1, 3)[1:]]]
    lines += [[tuple(T + t * sg * wt * el) for t in np.linspace(0, 1, 3)] for sg in (-1, 1)]
    NOSE_FORM.update({'lv': lv, 'target': target, 'T': T})
    if not FACE_QUAD: STITCH.append({'name': 'nose', 'lv': lv, 'target': target, 'lines': lines, 'sig': sig})
    PARTS['nose'] = [[list(map(float, B)), list(map(float, T)), list(map(float, Sn))]]
    return {'tip off the portrait point px': [round(float(T[0] - K[0]), 1), round(float(T[1] - K[1]), 1)],
            'height mm (the head\'s own)': round(H, 2), 'surface scale mm': round(sig_mm, 2), 'bridge px': round(Ltop, 1),
            'underside px': round(Lbot, 1), 'half width at the tip mm': round(float(wt / px_mm), 2),
            'head nose half width mm (at the surface scale, at half height)': [round(float(0.5 * (wl_ + wr_) / px_mm), 2), round(float(fwhm / px_mm), 2)],
            'profile exponents (up, down)': [round(p_up, 2), round(p_dn, 2)], 'region px (up, down, side)': [round(up, 1), round(dn, 1), round(side, 1)]}
if 'nose' in ORGANS: report['nose'] = nose_structure()

def first_skin_face(x, z):
    """the head's own skin along a ray from the front (hair and thin sheets skipped): the hit and its face's index"""
    o = Vector((x, -1.0, z)); hits = []
    for _ in range(16):
        loc, nrm, fi, d = bvh.ray_cast(o, Vector((0, 1, 0)))
        if loc is None: break
        hits.append((loc, nrm, fi)); o = loc + Vector((0, 1e-4, 0))
    for k, (loc, nrm, fi) in enumerate(hits):
        if (fi is not None and fi < len(HAIRY) and HAIRY[fi]) or nrm.y > 0: continue
        nxt = hits[k + 1] if k + 1 < len(hits) else None
        if nxt is not None and nxt[1].y > 0 and nxt[0].y - loc.y < EDGE: continue
        return loc, fi
    return None, None
def face_grid():
    """the face as one grid of quads, the way the modelling tutorial lays it out (test, --face=quad): rows across the face
    and one column down its middle, aligned to the face's axis (between the inner eye corners to the mouth), spaced at a
    sixth and a half of the eyes' inner distance, one row through the nose's tip; inside the face's outline (the
    detector's jaw points and the brow line, pulled in from the side silhouette). Around each eye the grid opens into
    rings stepping in to the eye's opening (the last one sunk into the socket behind the lids); around the mouth the
    rings close onto the mouth's line. The grid's depth is the head's skin, smoothed, and the nose's structural surface
    where the nose is; each point takes the head's weights at its place. stitch_face joins its outer edge to the head."""
    from mathutils.interpolate import poly_3d_calc
    G0 = 0.5 * (np.array(eyes['eye_r']['corners']['inner']) + np.array(eyes['eye_l']['corners']['inner']))
    Mth = np.array(eyes['mouth']['line'], float)[:, :2]; Mth = Mth[np.argsort(Mth[:, 0])]; Mc = Mth.mean(0)
    ea = (Mc - G0) / np.linalg.norm(Mc - G0); el = np.array([-ea[1], ea[0]])
    AL = lambda q: (float((np.asarray(q) - G0) @ ea), float((np.asarray(q) - G0) @ el))
    UV_ = lambda a_, l_: G0 + a_ * ea + l_ * el
    h = DIN / 8.0
    # the outline in the face's frame: the jaw, the brow line; the sides pulled in off the silhouette
    J = [AL(K28[i]) for i in (0, 1, 2, 3, 4, 10, 8, 7, 5)]
    J = [(a_, l_ * f_) for (a_, l_), f_ in zip(J, (1.0, 0.92, 1.0, 0.92, 1.0, 0.95, 0.95, 0.95, 0.95))]
    J[5:] = [(a_ - 0.35 * DIN, l_) for a_, l_ in J[5:]]               # above the brows, under the bangs: the eyes inside
    # at the eyes' level the outline reaches past each eye's outer corner (anime eyes run out to the face's edge)
    oc = {k: AL(eyes[k]['corners']['outer']) for k in ('eye_r', 'eye_l')}
    side = lambda k: 1.0 if oc[k][1] > 0 else -1.0
    J = J[:5] + [(oc['eye_l'][0], oc['eye_l'][1] + side('eye_l') * 0.8 * DIN)] + J[5:] + [(oc['eye_r'][0], oc['eye_r'][1] + side('eye_r') * 0.8 * DIN)]
    poly = np.array([UV_(*q) for q in J])
    aT = AL(NOSE_FORM['T'])[0] if NOSE_FORM else AL(K28[23])[0]
    a0 = min(q[0] for q in J); a1 = max(q[0] for q in J); l1 = max(abs(q[1]) for q in J)
    A = aT + h * np.arange(np.floor((a0 - aT) / h), np.ceil((a1 - aT) / h) + 1)
    Lc = h * np.arange(-np.ceil(l1 / h), np.ceil(l1 / h) + 1)
    node = {(i, j): UV_(A[i], Lc[j]) for i in range(len(A)) for j in range(len(Lc))}
    # the holes: each eye (level from its opening's curve), the mouth (an oval around its line)
    eyes_ = [(c_, cv_, at_) for at_, c_, cv_ in SOCKETS]
    def eye_level(q, c_, cv_):
        d = np.asarray(q) - c_; return np.hypot(*d) / max(1e-6, ray_radius(cv_, c_, math.atan2(d[1], d[0])))
    mw = float(np.ptp([AL(q)[1] for q in Mth])); mA, mL = AL(Mc)
    mouth_lv = lambda q: math.hypot((AL(q)[1] - mL) / (0.62 * mw), (AL(q)[0] - mA) / (0.3 * mw))
    # the face region: the outline, and always a band around each eye (so the eye's rings close all round)
    grown_eye = lambda c_, cv_, f: c_ + f * (np.asarray(cv_) - c_)          # the eye's opening scaled about its middle
    ins = {k: inside(poly, q) or any(inside(grown_eye(c_, cv_, 2.0), q) for c_, cv_, at_ in eyes_) for k, q in node.items()}
    def hole(q):
        for k_, (c_, cv_, at_) in enumerate(eyes_):
            if inside(grown_eye(c_, cv_, 1.15), q): return 'eye%d' % k_
        if 'mouth' in ORGANS and mouth_lv(q) < 1.0: return 'mouth'
        return None
    UVOF = {}
    vert = {}
    def V(k):
        if k not in vert:
            vert[k] = bm.verts.new((0, 0, 0)); UVOF[vert[k]] = tuple(node[k])
        return vert[k]
    keep = np.zeros((len(A) - 1, len(Lc) - 1), bool)
    for i in range(len(A) - 1):
        for j in range(len(Lc) - 1):
            ks = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            keep[i, j] = all(ins[k] for k in ks) and not any(hole(node[k]) for k in ks)
    # a clean outline: no quads touching only at a corner (their edge loops would cross), none on their own
    for _ in range(50):
        changed = False
        for i in range(keep.shape[0]):
            for j in range(keep.shape[1]):
                if not keep[i, j]: continue
                nb = sum(keep[i + di, j + dj] for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1))
                         if 0 <= i + di < keep.shape[0] and 0 <= j + dj < keep.shape[1])
                if nb == 0: keep[i, j] = False; changed = True
        for i in range(keep.shape[0] - 1):
            for j in range(keep.shape[1] - 1):
                b2 = keep[i:i + 2, j:j + 2]
                pair = ((i, j), (i + 1, j + 1)) if (b2[0, 0] and b2[1, 1] and not b2[0, 1] and not b2[1, 0]) else                        ((i, j + 1), (i + 1, j)) if (b2[0, 1] and b2[1, 0] and not b2[0, 0] and not b2[1, 1]) else None
                if pair:                                   # fill a square beside them (not in a hole), else drop the weaker
                    empty = [(i, j + 1), (i + 1, j)] if pair[0] == (i, j) else [(i, j), (i + 1, j + 1)]
                    ok_ = [q for q in empty if not any(hole(node[k]) for k in ((q[0], q[1]), (q[0], q[1] + 1), (q[0] + 1, q[1] + 1), (q[0] + 1, q[1])))]
                    if ok_: keep[ok_[0]] = True
                    else:
                        deg = lambda q: sum(keep[q[0] + di, q[1] + dj] for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1))
                                            if 0 <= q[0] + di < keep.shape[0] and 0 <= q[1] + dj < keep.shape[1])
                        keep[min(pair, key=deg)] = False
                    changed = True
        if not changed: break
    quads = [[(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)] for i in range(keep.shape[0]) for j in range(keep.shape[1]) if keep[i, j]]
    gface = [bm.faces.new([V(k) for k in ks]) for ks in quads]
    for f in gface: f.material_index = MAT['grid']
    # the grid's open edges, chained into loops: the outer edge, and one around each hole
    bnd = [e for f in gface for e in f.edges if len([g for g in e.link_faces if g in set(gface)]) == 1]
    adj = {}
    for e in bnd:
        a_, b_ = e.verts; adj.setdefault(a_, []).append(b_); adj.setdefault(b_, []).append(a_)
    loops, seen = [], set()
    for s0 in adj:
        if s0 in seen: continue
        loop, prev, cur = [s0], None, s0; seen.add(s0)
        while True:
            nx = [w for w in adj[cur] if w is not prev and w not in seen]
            if not nx: break
            prev, cur = cur, nx[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    area = lambda L: abs(0.5 * sum(UVOF[L[i]][0] * UVOF[L[i - 1]][1] - UVOF[L[i - 1]][0] * UVOF[L[i]][1] for i in range(len(L))))
    loops.sort(key=area, reverse=True); outer = loops[0]
    print('FIG grid loops: %s; mouth at a=%.0f, grid a %.0f..%.0f' % ([(len(L), round(area(L))) for L in loops], mA, a0, a1))
    RINGT = {}                     # ring points: (which hole, step 0-1 toward its inner shape)
    def ring_patch(B, kind):
        cen = np.mean([UVOF[v] for v in B], 0)
        if kind.startswith('eye'):
            c_, cv_, at_ = eyes_[int(kind[3:])]
            def Q(q):
                d = np.asarray(q) - c_; ang = math.atan2(d[1], d[0])
                return c_ + d / (np.hypot(*d) + 1e-9) * 0.97 * ray_radius(cv_, c_, ang)
        else:
            Ls = [AL(q)[1] for q in Mth]; ext = max(abs(AL(UVOF[v])[1] - mL) for v in B)
            def Q(q):
                s_ = np.clip((AL(q)[1] - mL) / ext, -1, 1) * 0.5 * mw * 0.92 + mL
                return UV_(float(np.interp(s_, Ls, [AL(q2)[0] for q2 in Mth])), s_)
        rows = [B]
        for t in (1 / 3, 2 / 3, 1.0):
            R = []
            for v in B:
                q = (1 - t) * np.asarray(UVOF[v]) + t * Q(UVOF[v]); w = bm.verts.new((0, 0, 0)); UVOF[w] = tuple(q); R.append(w)
                RINGT[w] = (kind, t)
            rows.append(R)
        n_ = 0
        for r0, r1 in zip(rows, rows[1:]):
            for i in range(len(B)):
                n_ += face((r0[i], r0[(i + 1) % len(B)], r1[(i + 1) % len(B)], r1[i]), MAT['grid'])
        return n_
    holes_done = []
    for L in loops[1:]:
        cen = np.mean([UVOF[v] for v in L], 0); kind = hole(cen) or ('mouth' if mouth_lv(cen) < 1.6 else None)
        if kind is None:
            dmin = min(range(len(eyes_)), key=lambda k_: np.hypot(*(cen - eyes_[k_][0])))
            kind = 'eye%d' % dmin
        holes_done.append((kind, len(L), ring_patch(L, kind)))
    # depth: the head's skin, smoothed over the grid; the nose's structural surface where the nose is; the eye rings
    # sinking into the socket (behind the lids)
    gv = [v for v in UVOF if v.is_valid]
    Y = {}
    for v in gv:
        x, z = to_xz(*UVOF[v]); hh = skin_hit_head(x, z); Y[v] = None if hh is None else hh.y
    # a ray that misses the face (beside the eyes, under bangs) can find something far behind it: not the face
    ymed = float(np.median([y for y in Y.values() if y is not None]))
    for v in gv:
        if Y[v] is not None and abs(Y[v] - ymed) > 0.035: Y[v] = None
    nbr = {v: [e.other_vert(v) for e in v.link_edges] for v in gv}
    for _ in range(20):                                         # points with no skin (under a lock): from their neighbours
        for v in gv:
            if Y[v] is None:
                k_ = [Y[w] for w in nbr[v] if Y.get(w) is not None]
                if k_: Y[v] = float(np.mean(k_))
    for v in gv:
        if Y[v] is None: Y[v] = float(np.mean([y for y in Y.values() if y is not None]))
    edge_ = set(outer)
    for _ in range(6):
        Y = {v: (Y[v] if v in edge_ else 0.5 * Y[v] + 0.5 * float(np.mean([Y[w] for w in nbr[v]]))) for v in gv}
    for v in gv:
        u, vv = UVOF[v]; x, z = to_xz(u, vv); y = Y[v]
        if NOSE_FORM:
            wn = smooth01((1.3 - NOSE_FORM['lv'](u, vv)) / 0.5)
            if wn > 0: y = (1 - wn) * y + wn * NOSE_FORM['target'](u, vv).y
        if v in RINGT and RINGT[v][0].startswith('eye'):
            at_ = eyes_[int(RINGT[v][0][3:])][2]; t = RINGT[v][1]
            y = (1 - t) * y + t * at_(u, vv, -0.5 * MM).y
        v.co = Vector((x, y, z)); PIN.add(v); flag(v, 0, 0)
    # weights: the head's own at each point (its skin triangle's weights, interpolated)
    hn = {g.index: g.name for g in head.vertex_groups}; Mw = head.matrix_world
    for v in gv:
        loc, fi = first_skin_face(v.co.x, v.co.z)
        if loc is None or fi is None: continue
        poly = head.data.polygons[fi]; ids = poly.vertices[:]
        bw = poly_3d_calc([Mw @ head.data.vertices[j].co for j in ids], loc); acc = {}
        for j, wt in zip(ids, bw):
            for gg in head.data.vertices[j].groups:
                acc[hn[gg.group]] = acc.get(hn[gg.group], 0.0) + wt * gg.weight
        GRID['w'][v] = acc
    allf = {f for v in gv for f in v.link_faces if f.material_index == MAT['grid']}
    GRID['faces'] = list(allf)
    vs_ = list({v for f in allf for v in f.verts}); ix = {v: i for i, v in enumerate(vs_)}
    GRID['bvh'] = BVHTree.FromPolygons([v.co.copy() for v in vs_], [[ix[v] for v in f.verts] for f in allf])
    ouv = np.array([UVOF[v] for v in outer])
    y_edge = float(np.mean([Y[v] for v in outer]))
    def skin_target(u, v):                                   # the fill around the grid: on the head's own skin
        x, z = to_xz(u, v); hh = skin_hit_head(x, z)
        return Vector((x, hh.y if hh is not None and abs(hh.y - y_edge) < 0.03 else y_edge, z))
    STITCH.append({'name': 'face grid', 'lv': lambda u, v: 0.5 if inside(ouv, (u, v)) else 2.0, 'ring': outer,
                   'ring_uv': [UVOF[v] for v in outer], 'lines': [], 'grow': False, 'target': skin_target})
    PARTS['grid'] = [ouv.round(1).tolist()]
    return {'spacing px': round(h, 1), 'grid quads': len(gface), 'holes (kind, points, ring quads)': holes_done,
            'points': len(gv), 'points with head weights': len(GRID['w'])}
if FACE_QUAD: report['face grid'] = face_grid()
if 'brows' in ORGANS:
    # the brows: ridges as wide as the drawing's strokes, U high (the eyes' depth unit: the bust's relief around them)
    for k in ('brow_r', 'brow_l'): report[k] = ridge(eyes[k]['line'], MAT['brow'], U)
if 'mouth' in ORGANS:
    # the mouth: the drawing's line as wide as its stroke at each point (eye_shapes), closed to points at the corners
    Mth = np.array(eyes['mouth']['line'], float); Mth = Mth[np.argsort(Mth[:, 0])]
    xs_ = np.linspace(Mth[0, 0], Mth[-1, 0], 25); path = np.stack([xs_, np.interp(xs_, Mth[:, 0], Mth[:, 1])], 1)
    half = 0.5 * np.interp(xs_, Mth[:, 0], Mth[:, 2]); half[[0, -1]] = 0.0
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
                lockc[f] = o is not None and c.y < o.y - S_SIG     # in front of the skin by more than its own scale
        return lockc[f]
    for S in STITCH:
        S_SIG = S['sig']    # the region's surface scale (its faired fit's median miss): the skin's own precision there
        def front(f):
            # only the face's front skin is cut: a triangle facing forward and lying on the skin seen from the front (not
            # the back of the head, nor the inside of a crease, which lie behind the same place in the picture)
            c = Mw @ f.calc_center_median(); n = (Mw.to_3x3() @ f.normal)
            if n.y > 0: return False
            o = skin_hit_head(c.x, c.z); return o is not None and c.y - o.y < EDGE      # within one of the head's triangles
        dead = {f for f in hb.faces if not lock(f) and any(S['lv'](*UV(q)) < 1.0 for q in probes(f)) and front(f)}
        if not dead: continue
        SP = float(np.median([np.hypot(*(np.subtract(UV(e.verts[0].co), UV(e.verts[1].co)))) for f in dead for e in f.edges]))
        touched = {v for f in dead for v in f.verts}
        bmesh.ops.delete(hb, geom=list(dead), context='FACES')
        bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
        # the face left under the old shape (the old nose's underside, which its tip hid) can lie deep behind the new
        # surface: near the region, those triangles are rebuilt too, until the opening's edge meets the new surface
        def behind(v):
            if not S.get('grow', True): return False
            w = Mw @ v.co; u_, v_ = UV(v.co); return w.y - S['target'](u_, v_).y > EDGE      # deeper than one triangle
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
            x, z = to_xz(u, v); o = skin_hit_head(x, z)
            if o is None: return False
            c = first_skin(cur, cur_hair, x, z)
            return c is None or abs(c.y - o.y) > S_SIG
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
        # a patch's own outer loop (the face grid's edge): its points are kept, the fill stops at it
        rings2d, ringset = [], set(S.get('ring', []))
        if S.get('ring'):
            k0 = len(P2)
            for v, q in zip(S['ring'], S['ring_uv']):
                P2.append((float(q[0]), float(q[1]))); P3.append(v.co.copy()); KIND.append(('ring', v))
            cons += [(k0 + i, k0 + (i + 1) % len(S['ring'])) for i in range(len(S['ring']))]
            rings2d.append(np.array(S['ring_uv']))
        C2 = np.array(P2); lo, hi = C2.min(0), C2.max(0); st = []
        segs = np.array([[C2[i], C2[j]] for i, j in cons])
        def seg_dist(p_):
            a_, b_ = segs[:, 0], segs[:, 1]; d = b_ - a_; t = np.clip(((p_ - a_) * d).sum(1) / ((d * d).sum(1) + 1e-12), 0, 1)
            return np.hypot(*(a_ + d * t[:, None] - p_).T).min()
        for r_, y in enumerate(np.arange(lo[1], hi[1], 0.87 * SP)):
            for x in np.arange(lo[0] + (0.5 * SP if r_ % 2 else 0.0), hi[0], SP):
                p_ = np.array([x, y])
                if any(inside(rg, p_) for rg in rings2d): continue
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
            elif kind == 'ring':
                BV[i] = ref; continue
            else:
                c_ = bm.verts.new(S['target'](q[0], q[1])); STEINER.add(c_); mine.add(c_)
            flag(c_, 1, 1); PIN.add(c_); BV[i] = c_
        line_pts = {BV[i] for i, orig in enumerate(oorig) if orig and KIND[orig[0]][0] == 'line'}
        FL = bm.faces.layers.int.get('flat') or bm.faces.layers.int.new('flat')
        nf = 0; adj = {}
        for tri in of:
            cen = np.mean([np.array(ov[t]) for t in tri], 0)
            if any(inside(rg, cen) for rg in rings2d) or not opening(*cen): continue
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
        off = {v: (v.co.y - tgt_y(v.co)) if (v in BRIDGE or v in ringset) else 0.0 for v in adj}
        free = [v for v in mine if v in adj and v not in line_pts and v not in ringset]
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
    """the head's skin around each eye pushed back U behind the eye's faired surface inside the opening, the socket's wall
    rising at 45 degrees outside it (the push falls 1 mm per mm from the opening's edge); the triangles lying wholly
    under the eye (and the ring of triangles touching them) are split once first, so the skin under the eye can sink
    although the head's triangles are larger than the eye's parts"""
    hb = bmesh.new(); hb.from_mesh(head.data); dl = hb.verts.layers.deform.active; hb.verts.ensure_lookup_table()
    hair_ids = {g.index for g in head.vertex_groups if g.name.startswith('hair')}
    Mw = head.matrix_world; Mi = Mw.inverted()
    def uv_of(co):
        w = Mw @ co; q = (Rm.T @ (np.array([w.x, w.z]) - tr)) / scale; return (q[0], -q[1]), w
    def level(uv, c, curve):
        d = np.array(uv) - c; return np.hypot(*d) / max(1e-6, ray_radius(curve, c, math.atan2(d[1], d[0])))
    gname = {g.index: g.name for g in head.vertex_groups}
    hairy = lambda v: hair_major((gname[g], w) for g, w in v[dl].items())
    core = set()
    for f in hb.faces:
        if any(hairy(v) for v in f.verts): continue
        for at_, c_, cv_ in SOCKETS:
            if max(level(uv_of(v.co)[0], c_, cv_) for v in f.verts) < 1.0: core.add(f); break
    near = core | {g for f in core for v in f.verts for g in v.link_faces if not any(hairy(w) for w in g.verts)}
    # only the triangles under the eye are split (it hides them); the skin that shows keeps the head's own triangle size
    # (splitting everything near the eye made a dense patch of lines that glowed around it in the hologram)
    edges = [e for e in {e for f in near for e in f.edges} if all(f in near for f in e.link_faces)]
    bmesh.ops.subdivide_edges(hb, edges=edges, cuts=1, use_grid_fill=True)
    moved = 0
    for v in hb.verts:
        if hairy(v): continue
        uv, w = uv_of(v.co)
        for at_, c_, cv_ in SOCKETS:
            d = np.array(uv) - c_; a = math.atan2(d[1], d[0]); r_edge = ray_radius(cv_, c_, a); s_ = np.hypot(*d) / max(1e-6, r_edge)
            out_m = max(0.0, s_ - 1) * r_edge / px_mm * MM                  # how far outside the opening (m)
            if out_m >= U: continue                                          # past the wall's top: the socket cannot reach
            y_s = at_(uv[0], uv[1], -U).y - out_m                            # the socket's floor, then its 45-degree wall
            if w.y < y_s: v.co = Mi @ Vector((w.x, y_s, w.z)); moved += 1; w = Mw @ v.co
    if STITCH: stitch_face(hb, hairy, uv_of, Mw)
    hb.to_mesh(head.data); hb.free(); head.data.update()
    global HAIR_POLY
    vh = [hair_major((head.vertex_groups[g.group].name, g.weight) for g in v.groups) for v in head.data.vertices]
    ph = [any(vh[i] for i in p.vertices) for p in head.data.polygons]
    HAIR_POLY = lambda fi: fi is not None and ph[fi]
    return len(near), moved
GRID['bvh_keep'] = GRID['bvh']; GRID['bvh'] = None
socket_faces, socket_points = cut_sockets()
def settle_on_skin():
    """where the skin still covers an eye point after the socket (the lash wing and lid rims run past the corners onto
    skin the socket left alone; a large face triangle crossing the opening covers the eyeball's edge), move it out onto
    the skin (clear by the behind-skin test's tolerance; a raised stroke's point by its own height too, so the lids and
    brows keep their relief where they run onto the skin), the shift spread over its neighbours falling 1 mm per mm of
    edge (a 45-degree slope) so the parts keep their smooth shapes"""
    hm = head.data; HV = [head.matrix_world @ v.co for v in hm.vertices]; HP = [p.vertices[:] for p in hm.polygons]
    gf = [f for f in GRID['faces'] if f.is_valid]
    if gf:                                                   # the face grid is skin too
        gvs = list({v for f in gf for v in f.verts}); ix = {v: len(HV) + i for i, v in enumerate(gvs)}
        HV += [v.co.copy() for v in gvs]; HP += [[ix[v] for v in f.verts] for f in gf]
    hbv = BVHTree.FromPolygons(HV, HP)
    def skin_y(x, z):
        h = first_skin(hbv, HAIR_POLY, x, z); return None if h is None else h.y
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')    # loose points
    bm.verts.ensure_lookup_table()
    need = {}
    for v in bm.verts:
        sy = skin_y(v.co.x, v.co.z)
        if sy is None or v in PIN: continue
        mi = v.link_faces[0].material_index
        if mi in (MAT['inner'], MAT['teeth'], MAT['skin']): continue                 # the mouth's inside belongs behind the skin
        need[v] = max(0.0, v.co.y - (sy - TOL - PROUD.get(v, 0.0)))     # a raised stroke keeps its own height over the skin
        # deeper than the eye's own depth (socket and dome) it is not skin poking through but something over the eye (the
        # eyeball stays under it); the lids, brows and lines follow the skin wherever it goes
        if mi in CAP and need[v] > CAP[mi]: need[v] = 0.0
    shift = dict(need)
    for _ in range(len(bm.verts)):                                           # to convergence (a cap, never reached)
        changed = False
        for v in bm.verts:
            if v in PIN: continue
            best = max([need.get(v, 0.0)] + [shift.get(e.other_vert(v), 0.0) - e.calc_length() for e in v.link_edges])
            if best > shift.get(v, 0.0) + 1e-9: shift[v] = best; changed = True
        if not changed: break
    moved = 0
    for v, d in shift.items():
        if d > 0: v.co.y -= d; moved += 1
    return moved, 1000 * max(list(need.values()) + [0.0])
settled, worst = settle_on_skin()
print('FIG settled %d eye points in front of the skin (deepest was %.1f mm under)' % (settled, worst))
_hm = head.data; _HV = [head.matrix_world @ v.co for v in _hm.vertices]; _HP = [p.vertices[:] for p in _hm.polygons]
_gf = [f for f in GRID['faces'] if f.is_valid]
if _gf:                                                       # the face grid is skin too
    _gvs = list({v for f in _gf for v in f.verts}); _ix = {v: len(_HV) + i for i, v in enumerate(_gvs)}
    _HV += [v.co.copy() for v in _gvs]; _HP += [[_ix[v] for v in f.verts] for f in _gf]
_hb = BVHTree.FromPolygons(_HV, _HP)
_hid = 0; HID = {}
for v in bm.verts:
    sk = first_skin(_hb, HAIR_POLY, v.co.x, v.co.z)
    hit = (sk, None, None) if sk is not None and sk.y < v.co.y - 2e-4 else (None,)
    mi = v.link_faces[0].material_index if v.link_faces else -1
    if hit[0] is not None and mi not in (MAT['inner'], MAT['teeth'], MAT['skin'], MAT['grid']) and v not in PIN:
        _hid += 1
        HID.setdefault(mi, []).append(round(1000 * (v.co - hit[0]).length, 2))
print('FIG behind skin by part: %s' % {k: (len(d), max(d)) for k, d in HID.items()})
print('FIG sockets: %d head faces split, %d points pushed back; %d of %d eye points behind skin' % (socket_faces, socket_points, _hid, len(bm.verts)))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(PARTS, open(OUT.replace('.blend', '_parts2d.json'), 'w'))   # every part's outline in portrait pixels (to overlay)
bm.verts.index_update(); LINE_BY_INDEX = {v.index: LINE[v] for v in bm.verts if v in LINE}
FREE = {v.index for v in STEINER if v.is_valid}
COPY = {c_.index: h_ for c_, h_ in BRIDGE.items() if c_.is_valid}
GRIDW_BY_INDEX = {v.index: d_ for v, d_ in GRID['w'].items() if v.is_valid and d_}
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
for i, d_ in GRIDW_BY_INDEX.items(): W[i] = d_
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
for part, grey in (('white', 0.92), ('iris', 0.6), ('pupil', 0.08), ('highlight', 1.0), ('lid', 0.25), ('brow', 0.3), ('nose', 0.85), ('lip', 0.7), ('mouth', 0.9), ('inner', 0.1), ('teeth', 1.0), ('skin', 0.92), ('grid', 0.92)):
    nm = ('eye_' if MAT[part] < 5 else 'face_') + part
    mt = bpy.data.materials.get(nm) or bpy.data.materials.new(nm)
    mt.diffuse_color = (grey, grey, grey, 1.0); me.materials.append(mt)
print('FIG eyes built: %s; %d points; head triangle %.1f mm; %.3f px per mm' % (report, len(me.vertices), 1000 * EDGE, px_mm))
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

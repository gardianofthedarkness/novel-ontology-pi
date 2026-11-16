"""Smooth bends at the joints of a rigged figure, with each joint's blend zone sized from the limb itself.
usage: blender -b -P smooth_joints.py -- <figure.blend> <out.blend> <mesh>=<front-view-dir>=<back-view-dir> ...
  each vertex whose weight sits on a joint's two bones (thigh/shin, shin/foot, upper arm/forearm, shoulder/upper arm,
  hips/thigh) is blended across the joint: along the child bone's axis, from all-parent to all-child over a zone of
  +-R around the joint (a smooth step), instead of switching at once, which folds the limb like a hinge.
  R is the limb's own radius at the joint (measured on the mesh, separately for skin and for cloth: a loose sleeve is
  wider than the arm, so it bends over a wider zone) times one ratio per joint; points outside the limb's radius take a
  share that fades (Cauchy) with their distance outside it over a scale. Ratio and scale are searched per joint for the
  test bends (a right angle each way about two axes across the bone) that leave the fewest edges stretched or squeezed
  past 1.25 x (check_head.py's measure); a joint where no blend beats the rig's own weights keeps them. Cloth is
  the picture's colour regions that are neither skin nor hair, laid onto the mesh by registering the picture's figure
  outline onto the mesh's (view_register.py), each point read from the view that sees it."""
import bpy, json, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from view_register import register
argv = sys.argv[sys.argv.index('--') + 1:]
pos = [a for a in argv if not a.startswith('--')]
SRC, OUT = pos[:2]; MESHES = [p.split('=', 2) for p in pos[2:]]
BEND = np.pi / 2          # the test bend at each joint: a right angle, both ways about both axes across the bone
LIMIT = np.log(1.25)      # check_head.py's stretch limit, taken both ways (a squeezed edge folds the limb as a stretched one tears it)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; bones = rig.data.bones
head = bpy.data.objects.get('Head')
PAIRS = [('hips', 'upper_leg.{s}'), ('upper_leg.{s}', 'lower_leg.{s}'), ('lower_leg.{s}', 'foot.{s}'),
         ('shoulder.{s}', 'upper_arm.{s}'), ('upper_arm.{s}', 'lower_arm.{s}')]
def smooth(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)
def cauchy(r, scale): return 1 / (1 + (np.asarray(r) / max(scale, 1e-12)) ** 2)
def wmedian(x, w):
    o = np.argsort(x); c = np.cumsum(w[o]); return float(x[o][np.searchsorted(c, c[-1] / 2)])
def segdist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.outer(t, ab) - p, axis=1)
report = {}
for name, fview, bview in MESHES:
    ob = bpy.data.objects[name]; me = ob.data
    co = np.array([v.co[:] for v in me.vertices]); n = len(co)
    E = np.array([e.vertices[:] for e in me.edges]); L0 = np.linalg.norm(co[E[:, 0]] - co[E[:, 1]], axis=1)
    STEP = float(np.median(L0)); ok = L0 > 0.5 * STEP          # check_head.py: edges under half the median say little
    # where is cloth: each point read from the picture of the view that sees it (a ray from the point to the camera side
    # meets nothing of the figure); a point neither view sees (between the legs, under the arms) takes the label of the
    # nearest point one does. The picture is laid onto the mesh by its figure outline (the back picture mirrored)
    allco = co if head is None else np.concatenate([co, np.array([v.co[:] for v in head.data.vertices])])
    polys = [tuple(p.vertices) for p in me.polygons]
    if head is not None: polys += [tuple(i + n for i in p.vertices) for p in head.data.polygons]
    bvh = BVHTree.FromPolygons([tuple(c) for c in allco.tolist()], polys)
    cloth = np.zeros(n, bool); seen = np.zeros(n, bool); regs = {}
    for vdir, back in ((fview, False), (bview, True)):
        v = json.load(open(os.path.join(vdir, 'view.json'))); lab = np.load(os.path.join(vdir, 'labels.npy'))
        sgn = -1.0 if back else 1.0
        reg = register(np.load(os.path.join(vdir, 'mask.npy')), allco * [sgn, 1, 1]); regs['back' if back else 'front'] = reg.report
        px, py = reg.to_img(sgn * co[:, 0], co[:, 2])
        px = np.clip(np.round(px).astype(int), 0, lab.shape[1] - 1); py = np.clip(np.round(py).astype(int), 0, lab.shape[0] - 1)
        l = lab[py, px]; is_cloth = (l != v['skin']) & (l != v['hair']) & (l != 255)
        look = Vector((0, -sgn, 0))                               # front camera on -y: the ray runs towards -y
        for i in range(n):
            if seen[i]: continue
            o = Vector(co[i]) + look * (STEP * 1e-3)               # off the surface by a sliver of the mesh step (epsilon)
            if bvh.ray_cast(o, look)[0] is None: cloth[i] = is_cloth[i]; seen[i] = True
    if seen.any() and not seen.all():
        kd = KDTree(int(seen.sum())); idx = np.nonzero(seen)[0]
        for j, i in enumerate(idx): kd.insert(co[i], j)
        kd.balance()
        for i in np.nonzero(~seen)[0]: cloth[i] = cloth[idx[kd.find(co[i])[1]]]
    gid = {g.name: g.index for g in ob.vertex_groups}; G = max(gid.values()) + 1
    W = np.zeros((n, G))
    for v in me.vertices:
        for g in v.groups: W[v.index, g.group] = g.weight
    W0 = W.copy()
    isbone = np.zeros(G, bool)
    for g, i in gid.items(): isbone[i] = g in bones
    def dominant(): return np.where(W.sum(1) > 0, W.argmax(1), -1)
    # the thigh is not the skirt: a skirt fix that hangs everything near the hem from the hips also takes the thigh skin
    # under it, which then stays behind when the leg lifts (the thigh looks broken). Points around the thigh bone follow
    # the thigh (the hip joint's blend below smooths it into the hips); the share moved is a Cauchy weight of how far a
    # point lies outside the thigh's own radius (the median distance of the thigh's points from its bone) over the spread
    # of those distances (their median deviation): the thigh's skin moves, the skirt's shell outside it keeps hanging
    freed = 0.0; thighs = {}
    for s in 'LR':
        th = f'upper_leg.{s}'
        if th in gid and 'hips' in gid and th in bones:
            a, b = np.array(bones[th].head_local[:]), np.array(bones[th].tail_local[:]); thighs[s] = (segdist(co, a, b), a, b)
    dom = dominant()
    for s, (d, a, b) in thighs.items():
        th = gid[f'upper_leg.{s}']; hp = gid['hips']; mine = dom == th
        if not mine.any(): continue
        r = float(np.median(d[mine])); mad = float(np.median(np.abs(d[mine] - r)))
        near = np.ones(n, bool)
        for s2, (d2, _, _) in thighs.items():
            if s2 != s: near &= d < d2                              # this thigh's side: nearer its bone than the other's
        c = np.where(near, cauchy(np.maximum(0, d - r), mad), 0.0); mv = c * W[:, hp]
        W[:, th] += mv; W[:, hp] -= mv; freed += float(mv.sum())
        print('FIG', name, s, 'thigh radius %.3f spread %.3f' % (r, mad), flush=True)
    def bend_score(Wt, J, sub, axes):
        """edges past the limit, both ways, over the test bends: the subtree's share of each point turns about the joint"""
        tot = Wt[:, isbone].sum(1); sh = np.where(tot > 0, Wt[:, sub].sum(1) / np.maximum(tot, 1e-12), 0.0)
        out = 0
        for u in axes:
            for ang in (BEND, -BEND):
                K = np.array([[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]])
                R = np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K
                P = co + sh[:, None] * ((co - J) @ R.T + J - co)
                L = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1); q = np.abs(np.log(np.maximum(L, 1e-12) / np.maximum(L0, 1e-12)))
                out += int((q[ok] > LIMIT).sum())
        return out
    joints = {}; changed = 0
    for s in 'LR':
        for pa, ch in PAIRS:
            pa, ch = pa.format(s=s), ch.format(s=s)
            if pa not in gid or ch not in gid or ch not in bones or pa not in bones: continue
            J = np.array(bones[ch].head_local[:]); ax = np.array(bones[ch].tail_local[:]) - J; ax /= np.linalg.norm(ax)
            dv = co - J; t = dv @ ax; rad = np.linalg.norm(dv - np.outer(t, ax), axis=1)
            dom = dominant(); ip, ic = gid[pa], gid[ch]
            # the limb's radius at the joint: the child's points' distance from its axis, a median weighted by a Cauchy
            # weight of their distance along the axis from the joint (over its median), per class (skin, cloth)
            kid = dom == ic
            if not kid.any(): continue
            wt = cauchy(np.abs(t), float(np.median(np.abs(t[kid]))))
            rk = {}
            for cls in (False, True):
                m = kid & (cloth == cls)
                if m.any(): rk[cls] = wmedian(rad[m], wt[m])
            for cls in (False, True): rk.setdefault(cls, rk[not cls])
            rv = np.where(cloth, rk[True], rk[False])
            dom2 = (dom == ip) | (dom == ic); tot = W[:, ip] + W[:, ic]
            sub = np.zeros(G, bool)
            for bn in [ch] + [c.name for c in bones[ch].children_recursive]:
                if bn in gid: sub[gid[bn]] = True
            u1 = np.cross(ax, np.eye(3)[np.argmin(np.abs(ax))])      # two axes across the bone (any pair; from the world
            u1 /= np.linalg.norm(u1); u2 = np.cross(ax, u1); axes = (u1, u2)   # axis least along it, to stay well defined)
            def blended(k, s):
                """zone k x the radius; the share a point takes is its own (dominant on the joint's two bones) times a
                Cauchy weight of how far it lies outside the limb's radius over s (a skirt's hem or the torso beside
                the joint keep their weights)"""
                R = k * rv; mem = dom2 * cauchy(np.maximum(0, rad - rv), s)
                inz = (mem > 0) & (np.abs(t) < R); c = np.where(inz, mem, 0.0)
                f = smooth((t + R) / (2 * np.maximum(R, 1e-12))); Wt = W.copy()
                Wt[:, ip] = (1 - c) * W[:, ip] + c * tot * (1 - f); Wt[:, ic] = (1 - c) * W[:, ic] + c * tot * f
                return Wt, inz
            # both found by search: the zone's ratio in steps of one mesh step of zone (on the thinner class), the fade's
            # scale in steps of one mesh step, each up to the shorter of the two bones
            span = min(bones[pa].length, bones[ch].length); rmin = min(rk.values())
            ks = np.arange(1, int(span / STEP) + 1) * STEP / rmin; ss = np.arange(1, int(span / STEP) + 1) * STEP
            if not len(ks): continue
            base = bend_score(W, J, sub, axes)
            grid = {(k, s): bend_score(blended(k, s)[0], J, sub, axes) for k in ks for s in ss}
            (k, s), best = min(grid.items(), key=lambda kv: kv[1])
            # a blend no candidate improves on is not applied: the rig's own weights stay (Akane's hips: every zone
            # stretched more edges than dress_rig's weights did)
            if best < base:
                W, inz = blended(k, s); changed += int(inz.sum())
            joints[ch] = {'radius_skin': round(rk[False], 3), 'radius_cloth': round(rk[True], 3), 'ratio': round(float(k), 2),
                          'zone_skin': round(float(k) * rk[False], 3), 'zone_cloth': round(float(k) * rk[True], 3), 'fade': round(float(s), 3),
                          'edges_past_limit_before': base, 'after': min(base, best), 'applied': bool(best < base)}
            print('FIG', name, ch, joints[ch], flush=True)
    # the weights written back where they changed
    diff = np.nonzero(np.abs(W - W0).max(1) > 0)[0]
    names = {i: g for g, i in gid.items()}
    for i in diff:
        for g in np.nonzero((W[i] != W0[i]))[0]:
            if W[i, g] > 0: ob.vertex_groups[names[g]].add([int(i)], float(W[i, g]), 'REPLACE')
            else: ob.vertex_groups[names[g]].remove([int(i)])
    report[name] = {'vertices': n, 'cloth_share': round(float(cloth.mean()), 3), 'seen_share': round(float(seen.mean()), 3),
                    'registration': regs, 'thigh_weight_freed_from_hips': round(freed, 1), 'blended_at_joints': changed, 'joints': joints}
    print('FIG', name, {k: v for k, v in report[name].items() if k != 'joints'}, flush=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

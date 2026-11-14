"""Smooth bends at the joints of a rigged figure, with cloth bending more softly than skin.
usage: blender -b -P smooth_joints.py -- <figure.blend> <out.blend> <mesh>=<front-view-dir>=<back-view-dir> ... [--skin=0.05] [--cloth=0.09]
  each vertex whose weight sits on a joint's two bones (thigh/shin, shin/foot, upper arm/forearm, shoulder/upper arm,
  hips/thigh) is blended across the joint: along the child bone's axis, from all-parent to all-child over a zone of
  +-R around the joint (a smooth step), instead of switching at once, which folds the limb like a hinge
  R is wider on cloth (the picture's colour regions that are neither skin nor hair, projected onto the mesh front and
  back): cloth bends with the joint instead of blocking it"""
import bpy, json, os, sys
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
pos = [a for a in argv if not a.startswith('--')]
SRC, OUT = pos[:2]; MESHES = [p.split('=', 2) for p in pos[2:]]
R_SKIN, R_CLOTH = float(flags.get('skin', 0.05)), float(flags.get('cloth', 0.09)); H = 1.6
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; bones = rig.data.bones
head = bpy.data.objects.get('Head')
PAIRS = [('hips', 'upper_leg.{s}', 1.0), ('upper_leg.{s}', 'lower_leg.{s}', 1.4), ('lower_leg.{s}', 'foot.{s}', 0.8),
         ('shoulder.{s}', 'upper_arm.{s}', 1.0), ('upper_arm.{s}', 'lower_arm.{s}', 1.0)]
def smooth(x): return x * x * (3 - 2 * x)
report = {}
for name, fview, bview in MESHES:
    ob = bpy.data.objects[name]; me = ob.data
    co = np.array([v.co[:] for v in me.vertices]); no = np.array([v.normal[:] for v in me.vertices])
    # where is cloth: the picture's labels (front for front-facing points, the back picture mirrored for the rest)
    allco = co if head is None else np.concatenate([co, np.array([v.co[:] for v in head.data.vertices])])
    lo, hi = allco.min(0), allco.max(0)
    cloth = np.zeros(len(co), bool)
    for vdir, back in ((fview, False), (bview, True)):
        v = json.load(open(os.path.join(vdir, 'view.json'))); lab = np.load(os.path.join(vdir, 'labels.npy'))
        bx0, by0, bx1, by1 = v['bbox']
        xs = (hi[0] - co[:, 0]) if back else (co[:, 0] - lo[0])
        px = np.clip((bx0 + xs / (hi[0] - lo[0]) * (bx1 - bx0)).round().astype(int), 0, lab.shape[1] - 1)
        py = np.clip((by1 - (co[:, 2] - lo[2]) / (hi[2] - lo[2]) * (by1 - by0)).round().astype(int), 0, lab.shape[0] - 1)
        l = lab[py, px]; is_cloth = (l != v['skin']) & (l != v['hair']) & (l != 255)
        facing = (no[:, 1] > 0.0) if back else (no[:, 1] <= 0.0)
        cloth[facing] = is_cloth[facing]
    gid = {g.name: g.index for g in ob.vertex_groups}
    # the thigh is not the skirt: a skirt fix that hangs everything near the hem from the hips also takes the thigh skin
    # under it, which then stays behind when the leg lifts (the thigh looks broken). Everything within the thigh's own
    # radius of the thigh bone follows the thigh (the hip joint's blend below smooths it into the hips); only the skirt
    # shell outside that radius keeps hanging from the hips
    freed = 0
    def segdist(p, a, b):
        ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.outer(t, ab) - p, axis=1)
    for s in 'LR':
        th = f'upper_leg.{s}'
        if th not in gid or 'hips' not in gid: continue
        a = np.array(bones[th].head_local[:]); b = np.array(bones[th].tail_local[:])
        d = segdist(co, a, b)
        dom = np.array([max(v.groups, key=lambda g: g.weight).group == gid[th] if v.groups else False for v in me.vertices])
        mid = dom & (co[:, 2] < a[2] - 0.12) & (co[:, 2] > b[2] + 0.05)          # the bare middle of the thigh
        r = float(np.median(d[mid])) * 1.2 if mid.sum() > 20 else 0.075
        for v in me.vertices:
            i = v.index
            if d[i] > r or co[i, 2] > a[2] + 0.02 or co[i, 2] < b[2]: continue
            if (co[i, 0] > 0) != (a[0] > 0) and abs(co[i, 0]) > 0.02: continue  # the other leg's side
            ws = {g.group: g.weight for g in v.groups}
            hw, lw = ws.get(gid['hips'], 0.0), ws.get(gid[th], 0.0)
            if hw <= lw: continue
            ob.vertex_groups[th].add([i], hw + lw, 'REPLACE'); ob.vertex_groups['hips'].remove([i]); freed += 1
        print('FIG', name, s, 'thigh radius', round(r, 3), flush=True)
    changed = 0
    for s in 'LR':
        for pa, ch, k in PAIRS:
            pa, ch = pa.format(s=s), ch.format(s=s)
            if pa not in gid or ch not in gid or ch not in bones: continue
            J = np.array(bones[ch].head_local[:]); ax = np.array(bones[ch].tail_local[:]) - J; ax /= np.linalg.norm(ax)
            gp, gc = ob.vertex_groups[pa], ob.vertex_groups[ch]
            for v in me.vertices:
                ws = {g.group: g.weight for g in v.groups}
                wp, wc = ws.get(gid[pa], 0.0), ws.get(gid[ch], 0.0)
                tot = wp + wc
                if tot < 0.5: continue                            # mostly another bone's: leave it
                R = (R_CLOTH if cloth[v.index] else R_SKIN) * k
                d = np.array(v.co[:]) - J; t = float(d @ ax)
                if abs(t) >= R: continue
                if np.linalg.norm(d - t * ax) > 0.16: continue   # far off the limb's axis (a skirt's hem, the torso)
                f = smooth((t + R) / (2 * R))
                gp.add([v.index], tot * (1 - f), 'REPLACE'); gc.add([v.index], tot * f, 'REPLACE'); changed += 1
    report[name] = {'vertices': len(co), 'cloth_share': round(float(cloth.mean()), 3), 'thigh_freed_from_hips': freed, 'blended_at_joints': changed}
    print('FIG', name, report[name], flush=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

"""Lock the skull (v0.7 step 1): the head owns the whole head; the neck owns only the column under the jaw; the shoulders,
arms and chest own nothing above the collar. Same formula on both sides of the Head-to-outfit seam.
usage: blender -b <figure.blend> -P head_lock.py -- <out.blend> [--tilt=0.035] [--band=0.015] [--column=1.2]
  The jaw line is found from the Head mesh's own front profile (the chin's underside: where the midline jumps forward from
  the neck's front); the neck column is the neck's cross-section (measured on LayerBody, which has no hair), widened by
  --column. In the column, below a plane that runs from the chin's underside and rises --tilt metres to the back of the
  neck, a point is the neck's; above it (and everywhere outside the column) the head's, blended over --band metres.
  In the column the head's share rises from --ramp-from above the neck's base to the plane, so a turn twists the whole
  neck, not a band under the chin. Outfits and LayerBody (thin cloth rides LayerBody in the viewer, so it needs the same
  fix): in the column above the ramp's start and everywhere at the seam's height, the Head's formula exactly; above the
  collar no weight on shoulders, arms, hands, chest or spine (it moves to the neck); in the column the arms fade out under it.
  Writes the jaw line and column to the armature (figure_face) for the later steps, limits to 4 influences, exports VRM."""
import bpy, json, os, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]
TILT, BAND, COLUMN = float(flags.get('tilt', 0.035)), float(flags.get('band', 0.015)), float(flags.get('column', 1.1))
RAMP = float(flags.get('ramp-from', 0.01))   # where the head's share starts rising in the column: this far above the neck's base
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; B = rig.data.bones
head_z, neck_z = B['head'].head_local.z, B['neck'].head_local.z
RAMP_FROM = neck_z + RAMP
seam_z = float(rig.get('neck_seam_z', head_z))   # where Head and the bodies overlap (kept apart from the pivot)
FRONT = -1.0   # VRM in Blender faces -Y

def co(ob): return np.array([v.co[:] for v in ob.data.vertices])
def smooth(t): t = np.clip(t, 0.0, 1.0); return t * t * (3 - 2 * t)

head = bpy.data.objects['Head']; layer = bpy.data.objects.get('LayerBody')
H = co(head)
# the neck's cross-section, from the hairless base body just under the head joint
ref = co(layer) if layer else H
# an ellipse: depth on the midline, width across the neck's centre (a T-pose's arms and shoulder tops are at this height)
bx = B['head'].head_local.x
ring = ref[(ref[:, 2] > head_z - 0.025) & (ref[:, 2] < head_z - 0.005)]
mid_ring = ring[np.abs(ring[:, 0] - bx) < 0.02]
y0, y1 = float(mid_ring[:, 1].min()), float(mid_ring[:, 1].max())
cx, cy, ry = bx, (y0 + y1) / 2, (y1 - y0) / 2
across = ring[(np.abs(ring[:, 1] - cy) < 0.015) & (np.abs(ring[:, 0] - bx) < 0.09)]
rx = float(np.percentile(np.abs(across[:, 0] - bx), 90)) if len(across) else ry
r = ry
def rad(P): return np.hypot((P[:, 0] - cx) / rx, (P[:, 1] - cy) / ry)   # 1 on the neck's surface
# the chin's underside: on the Head's midline, the lowest height where the front jumps forward past the neck's front
mid = H[np.abs(H[:, 0] - cx) < 0.012]
bins = np.arange(mid[:, 2].min(), mid[:, 2].min() + 0.12, 0.004)
front = [(z, float((mid[(mid[:, 2] >= z) & (mid[:, 2] < z + 0.004), 1] * FRONT).max())) for z in bins if ((mid[:, 2] >= z) & (mid[:, 2] < z + 0.004)).any()]
neck_front = float(np.median([f for _, f in front[:3]]))
chin = next(((z, f) for z, f in front if f > neck_front + 0.025), None)
if chin is None: raise SystemExit('FIG no chin found on the Head midline')
z_chin, chin_front = chin
y_front = cy + FRONT * r          # the neck's front surface, where the jaw plane starts
print('FIG neck axis (%.3f, %.3f) half-width %.3f half-depth %.3f; chin underside z %.3f, chin %.3f m ahead of the axis' % (cx, cy, rx, ry, z_chin, chin_front - cy * FRONT))

def plane(P):
    """height of the jaw plane over each point: from the chin's underside at the neck's front, rising TILT to the back"""
    back = np.clip((P[:, 1] - y_front) * -FRONT / (2 * r), 0.0, 1.0)
    return z_chin + TILT * back
def column(P): return rad(P) < COLUMN + 0.3
def head_share(P):
    """the head's share of each point by the jaw rule: in the neck column it rises from the head's pivot to the jaw plane
    (the neck turns along its length); across the column's edge it rises to 1 over 0.3 of the neck's size"""
    zp = plane(P); lo = np.minimum(RAMP_FROM, zp - BAND)
    up = smooth((P[:, 2] - lo) / np.maximum(zp - lo, BAND))
    out = smooth((rad(P) - COLUMN) / 0.3)
    return np.maximum(up, out)

ARMS = ('shoulder', 'upper_arm', 'lower_arm', 'hand')
BODY = ('chest', 'spine', 'hips', 'upper_chest')
def rewrite(ob, rule):
    names = {g.index: g.name for g in ob.vertex_groups}
    for n in ('head', 'neck'):
        if n not in ob.vertex_groups: ob.vertex_groups.new(name=n)
    P = np.array([(ob.matrix_world @ v.co)[:] for v in ob.data.vertices])
    new = rule(ob, P, names)
    groups = {g.name: g for g in ob.vertex_groups}
    changed = 0
    for i, ws in new.items():
        v = ob.data.vertices[i]
        for gi in [g.group for g in v.groups]: groups[names[gi]].remove([i])
        for n, w in ws.items():
            if w > 1e-4: groups[n].add([i], float(w), 'REPLACE')
        changed += 1
    return changed

def head_rule(ob, P, names):
    hs = head_share(P)
    return {i: {'head': float(hs[i]), 'neck': float(1 - hs[i])} for i in range(len(P))}

CLOTH_FADE = float(flags.get('cloth-fade', 0.5))   # in units of the neck's size
CLOTH_HEAD = flags.get('cloth-head', '0') == '1'    # 1: the cloth's neck column follows the Head's formula too (it dragged the collar)
def cloth_rule(ob, P, names):
    out = {}; hs = head_share(P); rad_ = rad(P); col = rad_ < COLUMN + CLOTH_FADE
    for i, v in enumerate(ob.data.vertices):
        z = P[i, 2]
        if z < neck_z - 0.04: continue
        ws = {names[g.group]: g.weight for g in v.groups if g.weight > 0}
        if not ws: continue
        # only the neck column: in a T-pose the arms and shoulders lie at the collar's height, so a rule by height alone
        # took their arm weight (v0.7's first build: the arms and shoulders ballooned once the arms came down)
        # and softly: full inside the neck's own size, fading to nothing by CLOTH_FADE outside it (a hard edge shears the
        # cloth when the head turns)
        f = float(smooth((COLUMN + CLOTH_FADE - rad_[i]) / CLOTH_FADE))
        if f <= 0: continue
        if z > RAMP_FROM and CLOTH_HEAD:
            new = {'head': float(hs[i]), 'neck': float(1 - hs[i])}   # the column above the ramp's start: the Head's formula
        else:
            arm = sum(w for n, w in ws.items() if n.startswith(ARMS))
            t_arm = smooth((z - (neck_z - 0.03)) / 0.04)    # the arms fade out of the neck from its base up
            if t_arm <= 0 or arm <= 0: continue
            new = {n: (w * (1 - t_arm) if n.startswith(ARMS) else w) for n, w in ws.items()}
            new['neck'] = new.get('neck', 0.0) + arm * t_arm
        tot = sum(ws.values())
        out[i] = {n: f * new.get(n, 0.0) + (1 - f) * ws.get(n, 0.0) / tot for n in set(new) | set(ws)}
    return out

print('FIG Head rewritten', rewrite(head, head_rule))
# the clothes and the base body keep v0.6's weights unless --cloth=1: every change tried there (the Head's formula up the
# neck, arm weight taken off the collar) made the body stretch more in neck poses than v0.6, and in a T-pose a rule by
# height also caught the arms (the first v0.7 build ballooned the arms and shoulders)
if flags.get('cloth', '0') == '1':
    for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Head' and o.vertex_groups]:
        print('FIG', ob.name, 'rewritten', rewrite(ob, cloth_rule))
for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o.vertex_groups and (o.name == 'Head' or flags.get('cloth', '0') == '1')]:
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
face = {'neck_axis': [cx, cy], 'neck_radius': r, 'neck_half': [rx, ry], 'column': COLUMN, 'chin_underside_z': z_chin, 'neck_front_y': y_front, 'tilt': TILT, 'band': BAND, 'front': FRONT, 'pivot_z': head_z, 'ramp_from': RAMP_FROM}
rig['figure_face'] = json.dumps(face)
rig['neck_seam_z'] = seam_z
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
open(os.path.join(os.path.dirname(OUT), 'face.json'), 'w').write(json.dumps(face, indent=1))

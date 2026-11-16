"""Put the head bust (shaped from the high-resolution portrait) on the rigged body, in place of the body's own head.
usage: blender -b -P head_swap.py -- <holo.blend> <bust.glb> <portrait-view-dir> <out.blend> --marks-body=<body.json>
         --marks-bust=<bust.json> [--body=<object> --outfit=<name>]
  Placement: marks/fit.py place(): both heads' 3D landmarks (marks/landmarks.py, seven angles each) and both surfaces,
  every pair weighted by its own measured miss; the body's head is what the rig weights mostly to the head or neck bone.
  Middle: the trunk's mirror plane (the points the rig weights mostly to the hips, spine, chest or neck) is the figure's
  middle; the neck and head bones are set on it.
  Cut: the body gives up its faces above the neck seam (rig['neck_seam_z'], measured by the rig step) that the rig weights
  mostly to the head or neck; the bust keeps its faces above the seam whose nearest body point is the body's head. The two
  overlap by one of the body's own median edges, so no gap opens at rest.
  Detail: the bust is reduced to the body's own triangle size (the body's head triangles' median area), so the head and the
  body are drawn with the same density in the hologram.
  Weights: each bust point takes the head and neck weights of its nearest body point (the skull-lock step refines them).
  Writes bust_map (the portrait's figure box, the bust's bounds at import, the placement) for the organ step."""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'marks'))
from fit import place, mirror_plane, tree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
BODY, BUST, PVIEW, OUT = [a for a in argv if not a.startswith('--')][:4]
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=BODY)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects[flags.get('body', 'Body')]
old_head = bpy.data.objects.get('Head') if flags.get('body') else None     # a composed figure's earlier head
HEADISH = ('head', 'neck'); TRUNK = ('hips', 'spine', 'chest', 'upper_chest', 'neck')   # STRUCTURAL: VRM bone names

def dominant(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    return np.array([names[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in ob.data.vertices])
bco = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices]); bdom = dominant(body)
if old_head is not None:
    bco = np.concatenate([bco, np.array([(old_head.matrix_world @ v.co)[:] for v in old_head.data.vertices])])
    bdom = np.concatenate([bdom, np.full(len(old_head.data.vertices), 'head')]); bpy.data.objects.remove(old_head, do_unlink=True)
is_head = np.isin(bdom, HEADISH)
seam = float(rig['neck_seam_z'])
E = np.array([e.vertices[:] for e in body.data.edges]); B0 = np.array([v.co[:] for v in body.data.vertices])
edge = float(np.median(np.linalg.norm(B0[E[:, 0]] - B0[E[:, 1]], axis=1)))     # the body's own detail
print('FIG body: %d points, %d the head\'s or neck\'s by the rig; median edge %.1f mm; neck seam z %.3f' % (len(bco), is_head.sum(), edge * 1000, seam))

# ---- the bust, placed -------------------------------------------------------------------------------------------
before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=BUST)
new = [o for o in sc.objects if o not in before]; ms = [o for o in new if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
head = ms[0]
for o in new:
    if o != head and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
head.parent = None
with bpy.context.temp_override(active_object=head, selected_editable_objects=[head], object=head):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hco = np.empty(len(head.data.vertices) * 3); head.data.vertices.foreach_get('co', hco); hco = hco.reshape(-1, 3); hlo, hhi = hco.min(0), hco.max(0)
M, rep = place(hco, bco, is_head, json.load(open(flags['marks-body'])), json.load(open(flags['marks-bust'])), edge)
head.data.transform(Matrix(M.tolist())); rig['head_fit'] = json.dumps(rep)

# ---- one middle: the trunk's mirror plane; the neck and head bones on it ---------------------------------------
nB, dB, eB = mirror_plane(bco[np.isin(bdom, TRUNK)])
def on_plane(p): q = np.array(p[:]); return q - (q @ nB - dB) * nB
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT'); moved = {}
for name in ('neck', 'head'):
    b = rig.data.edit_bones[name]; h0 = b.head.copy(); b.head = Vector(on_plane(b.head)); b.tail = Vector(on_plane(b.tail)); moved[name] = (b.head - h0).length * 1000
bpy.ops.object.mode_set(mode='OBJECT')
rig['figure_middle'] = json.dumps({'normal': nB.tolist(), 'offset': dB})
print('FIG middle: the trunk\'s mirror plane (pair spread %.1f mm); neck and head bones moved onto it by %s mm' % (eB * 1000, {k: round(v, 1) for k, v in moved.items()}))
# the bust was shaped from the portrait seen from the front: a portrait pixel lies on the bust straight behind it, through
# the portrait's figure box and the bust's bounds at import, then the placement; the organ step places the face this way
rig['bust_map'] = json.dumps({'bbox': json.load(open(os.path.join(PVIEW, 'view.json')))['bbox'], 'lo': hlo.tolist(),
                              'hi': hhi.tolist(), 'M': M.tolist()})

# ---- the bust at the body's triangle size (before the cut: the bust comes with over a million points) -----------------------------------
def tri_area(ob):
    me = ob.data; me.calc_loop_triangles()
    V = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)
    T = np.empty(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('vertices', T); T = T.reshape(-1, 3); return 0.5 * np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1), T
ab, Tb = tri_area(body); body_head_tri = np.isin(Tb[:, 0], np.nonzero(is_head[:len(body.data.vertices)])[0])
target = float(np.median(ab[body_head_tri])) if body_head_tri.any() else float(np.median(ab))
ah, _ = tri_area(head); tris = max(1, int(round(ah.sum() / target)))
dc = head.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, tris / max(1, len(ah))); dc.use_collapse_triangulate = True
head.modifiers.new('tri', 'TRIANGULATE')
dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(head.evaluated_get(dg))
old = head.data; head.modifiers.clear(); head.data = me; bpy.data.meshes.remove(old)
for p in me.polygons: p.use_smooth = False
# ---- the cut ----------------------------------------------------------------------------------------------------
near_body = tree(bco)
def cut(ob, keep_face):
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me)
    C = np.array([list(sum((v.co for v in f.verts), Vector()) / len(f.verts)) for f in bm.faces])
    k = keep_face(C, bm); kill = [f for f, kk in zip(bm.faces, k) if not kk]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(me); bm.free(); me.update()
    return len(kill)
def bust_keep(C, bm): return (C[:, 2] > seam - edge) & is_head[near_body(C)[0]]
def body_keep(C, bm):
    faces = list(bm.faces)
    headish = np.array([np.mean([is_head[v.index] for v in f.verts]) > 0.5 for f in faces])
    return ~((C[:, 2] > seam + edge) & headish)
print('FIG cut: the bust lost %d faces (under the seam or nearest the body\'s shoulders and collar)' % cut(head, bust_keep))
def largest_piece(ob):
    """only the bust's largest connected piece: the cut leaves bits of the bust's collar and shoulders standing loose"""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table(); seen = set(); pieces = []
    for f0 in bm.faces:
        if f0.index in seen: continue
        stack = [f0]; piece = []; seen.add(f0.index)
        while stack:
            f = stack.pop(); piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); stack.append(g)
        pieces.append(piece)
    big = max(pieces, key=lambda p: sum(f.calc_area() for f in p)); keep = set(f.index for f in big)
    kill = [f for f in bm.faces if f.index not in keep]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return len(pieces), len(kill)
print('FIG cut: the bust in %d pieces; kept the largest, dropped %d faces' % largest_piece(head))
if old_head is None: print('FIG cut: the body lost %d faces (its own head)' % cut(body, body_keep))

# ---- the body's head and neck weights on the bust
bnames = {g.index: g.name for g in body.vertex_groups}
hb_idx = np.nonzero(is_head[:len(body.data.vertices)])[0]; q_head = tree(bco[hb_idx])
H = np.array([v.co[:] for v in me.vertices]); nn, _ = q_head(H)
gh = head.vertex_groups.new(name='head'); gn = head.vertex_groups.new(name='neck')
for i, j in enumerate(hb_idx[nn]):
    ws = {bnames[g.group]: g.weight for g in body.data.vertices[int(j)].groups if bnames[g.group] in HEADISH}
    tot = sum(ws.values()) or 1.0
    if ws.get('head', 0) > 0: gh.add([i], ws['head'] / tot, 'REPLACE')
    if ws.get('neck', 0) > 0: gn.add([i], ws['neck'] / tot, 'REPLACE')
head.parent = rig; am = head.modifiers.new('Armature', 'ARMATURE'); am.object = rig
me.materials.clear(); me.materials.append(body.data.materials[0])
head.name = me.name = 'Head'
if body.name == 'Body': body.name = body.data.name = 'Outfit_' + flags.get('outfit', 'main')
print('FIG head %d triangles (the bust\'s area over the body\'s median head triangle %.1f mm2); body %d' % (len(me.polygons), target * 1e6, len(body.data.polygons)))
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)

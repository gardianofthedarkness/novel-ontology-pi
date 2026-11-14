"""Joint tracks + body-surface extremes from SMPL-H FBX clips (HY-Motion), for physics checks.
usage: blender -b -P t2m_extract.py -- <clips-dir>     writes <slug>.npz next to each .fbx
  P[F,J,3] joint world positions (m, Z up), names[J], fps,
  low[F]  lowest point of the whole body surface, lowL/lowR[F] lowest point of each leg's surface,
  handLow[F] lowest point of the hands/arms surface"""
import bpy, glob, os, sys
import numpy as np
d = sys.argv[sys.argv.index('--') + 1]
for path in sorted(glob.glob(os.path.join(d, '*.fbx'))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    sc = bpy.context.scene
    arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
    act = arm.animation_data.action; f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    names = [b.name for b in arm.pose.bones]
    meshes = [o for o in sc.objects if o.type == 'MESH']
    leg = [o for o in meshes if o.name == 'leg']; armm = [o for o in meshes if o.name == 'arm']
    # which leg vertices belong to the left leg: x > 0 in the rest pose (SMPL left is +x)
    dg = bpy.context.evaluated_depsgraph_get()
    sc.frame_set(f0)
    P, low, lowL, lowR, handLow = [], [], [], [], []
    left_mask = None
    for f in range(f0, f1 + 1):
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        mw = arm.matrix_world
        P.append([(mw @ pb.head)[:] for pb in arm.pose.bones])
        zs = []
        for o in meshes:
            ev = o.evaluated_get(dg); me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            M = np.array(o.matrix_world); co = co @ M[:3, :3].T + M[:3, 3]
            zs.append(co[:, 2].min())
            if o in leg:
                if left_mask is None:
                    pel = np.array(P[-1][names.index('Pelvis')]); left_mask = co[:, 0] > pel[0]
                lowL.append(co[left_mask, 2].min()); lowR.append(co[~left_mask, 2].min())
            if o in armm: handLow.append(co[:, 2].min())
            ev.to_mesh_clear()
        low.append(min(zs))
    out = path[:-4] + '.npz'
    np.savez(out, P=np.array(P), names=np.array(names), fps=sc.render.fps, low=np.array(low), lowL=np.array(lowL),
             lowR=np.array(lowR), handLow=np.array(handLow))
    print('T2M', os.path.basename(out), len(P), 'frames', 'fps', sc.render.fps, 'low', round(min(low), 3), 'max', round(max(low), 3))

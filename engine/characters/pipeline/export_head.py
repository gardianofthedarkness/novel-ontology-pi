"""Export a figure's head for fitting (fit_template.py): head.obj, and head.json with each point's free-hair share (how
much it belongs to the hair chains, hair_rig.py) and the 68 face points (face_rig.py's figure_face.marks).
usage: blender -b <figure.blend> -P export_head.py -- <out-dir>"""
import bpy, json, os, sys
OUT = sys.argv[sys.argv.index('--') + 1]; os.makedirs(OUT, exist_ok=True)
rig = bpy.data.objects['Armature']; head = bpy.data.objects.get('Head') or bpy.data.objects['Head_quad']
names = {g.index: g.name for g in head.vertex_groups}
free = [sum(g.weight for g in v.groups if names[g.group].startswith('hair_')) for v in head.data.vertices]
M = head.matrix_world
lines = ['v %.6f %.6f %.6f' % tuple(M @ v.co) for v in head.data.vertices] + ['f ' + ' '.join(str(i + 1) for i in p.vertices) for p in head.data.polygons]
open(os.path.join(OUT, 'head.obj'), 'w').write('\n'.join(lines) + '\n')
face = json.loads(rig['figure_face'])
json.dump({'free_hair': [round(x, 3) for x in free], 'marks': face['marks'], 'pivot': face.get('pivot'), 'hinge': face.get('hinge')},
          open(os.path.join(OUT, 'head.json'), 'w'))
print('FIG exported', len(head.data.vertices), 'points,', len(head.data.polygons), 'faces,', sum(1 for x in free if x > 0.3), 'free hair points')

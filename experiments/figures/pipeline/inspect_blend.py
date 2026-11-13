import bpy, collections
ob = bpy.data.objects['Body']; me = ob.data
print('INSPECT slots', [m.name if m else None for m in me.materials])
print('INSPECT material_index', collections.Counter(p.material_index for p in me.polygons).most_common())

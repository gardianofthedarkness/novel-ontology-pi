"""StdGEN on a HF Space, stage by stage: any pose -> A-pose -> multiview -> layered mesh (-> refined).
usage: stdgen_run.py <input.png> <out-dir> [space] [--from-apose]"""
import os, shutil, sys, time
from gradio_client import Client, handle_file
src, out = sys.argv[1], sys.argv[2]
space = next((a for a in sys.argv[3:] if not a.startswith('--')), 'fabioma/StdGEN')
os.makedirs(out, exist_ok=True)
c = Client(space, verbose=False)
def p(x): return x if isinstance(x, str) else (x.get('path') if isinstance(x, dict) else x)
t = time.time()
if '--from-apose' in sys.argv:
    apose = src
else:
    apose = p(c.predict(image=handle_file(src), seed=52, api_name='/arbitrary_to_apose'))
    shutil.copy(apose, os.path.join(out, 'apose.png')); print('apose', round(time.time() - t), 's', flush=True)
views = c.predict(apose_img=handle_file(apose), seed=50, api_name='/apose_to_multiview')
paths = []
for i, v in enumerate(views):
    q = p(v['image']); dst = os.path.join(out, f'view{i}.png'); shutil.copy(q, dst); paths.append(q)
print('views', len(paths), round(time.time() - t), 's', flush=True)
meshes = c.predict(images=[{'image': handle_file(q), 'caption': None} for q in paths], api_name='/multiview_to_mesh')
names = ['mesh_1', 'mesh_2', 'mesh_3', 'whole']
for n, m in zip(names, meshes):
    m = p(m); shutil.copy(m, os.path.join(out, n + os.path.splitext(m)[1]))
print('meshes', round(time.time() - t), 's', flush=True)
if '--refine' in sys.argv:
    ref = c.predict(mesh1=handle_file(p(meshes[0])), mesh2=handle_file(p(meshes[1])), mesh3=handle_file(p(meshes[2])), seed=50, api_name='/refine_mesh')
    for n, m in zip(['refined_3', 'refined_1', 'refined_2', 'refined_whole'], ref):
        m = p(m); shutil.copy(m, os.path.join(out, n + os.path.splitext(m)[1]))
    print('refined', round(time.time() - t), 's')
print('done', out)

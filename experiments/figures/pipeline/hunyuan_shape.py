"""Hunyuan3D-2.1 shape (untextured) from one front image or front/back/left/right views, on its HF Space.
usage: hunyuan_shape.py <out.glb> <front.png> [back.png left.png right.png]"""
import shutil, sys, time
from gradio_client import Client, handle_file
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
argv = [a for a in sys.argv if not a.startswith('--')]
out, front = argv[1], argv[2]
mv = argv[3:6] + [None] * (3 - len(argv[3:6]))
c = Client('tencent/Hunyuan3D-2.1', verbose=False, httpx_kwargs={'timeout': 180})
t = time.time()
try:
    c.predict(value=flags.get('mode', 'Turbo'), api_name='/on_gen_mode_change')
except Exception as e:
    print('mode', e)
r = c.predict(image=handle_file(front), mv_image_front=None, mv_image_back=handle_file(mv[0]) if mv[0] else None,
              mv_image_left=handle_file(mv[1]) if mv[1] else None, mv_image_right=handle_file(mv[2]) if mv[2] else None,
              steps=int(flags.get('steps', 8)), guidance_scale=5.0, seed=1234, octree_resolution=int(flags.get('octree', 256)), check_box_rembg=True, num_chunks=8000,
              randomize_seed=False, api_name='/shape_generation')
f = r[0] if isinstance(r[0], str) else r[0].get('path', r[0].get('value'))
shutil.copy(f, out); print('saved', out, r[2], round(time.time() - t), 's')


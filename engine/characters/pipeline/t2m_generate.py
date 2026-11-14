"""Generate text-to-motion clips on the HY-Motion Space (SMPL-H skeleton, FBX, 30 fps).
usage: t2m_generate.py <out-dir> <slug>=<seconds>=<prompt> ...   (seed 0, one clip per prompt)"""
import os, shutil, sys, time
from gradio_client import Client
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
c = Client('tencent/HY-Motion-1.0', verbose=False)
for spec in sys.argv[2:]:
    slug, secs, prompt = spec.split('=', 2)
    dst = os.path.join(out, slug + '.fbx')
    if os.path.exists(dst): print('have', slug); continue
    t = time.time()
    for attempt in range(3):
        try:
            _, files = c.predict(original_text=prompt, rewritten_text=prompt, seed_input='0', motion_duration=float(secs),
                                 cfg_scale=5.0, api_name='/generate_motion_func'); break
        except Exception as e:
            print('retry', slug, type(e).__name__, str(e)[:120], flush=True); time.sleep(15)
    else:
        print('FAILED', slug); continue
    fbx = [f if isinstance(f, str) else f['path'] for f in files if str(f).endswith('.fbx') or (isinstance(f, dict) and f.get('path', '').endswith('.fbx'))][0]
    shutil.copy(fbx, dst); print('ok', slug, round(time.time() - t), 's', flush=True)

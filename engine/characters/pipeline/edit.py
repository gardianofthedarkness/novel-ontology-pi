"""One image edit on the kulkas2pintu/QWEN_EDIT_IMAGE Space (Qwen-Image-Edit, works anonymously).
usage: edit.py <out.png> <image> <prompt or @prompt-file> [image2] [--seed=N] [--pose=<pose_ref.png>]"""
import shutil, sys, time
from gradio_client import Client, handle_file
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
out, img, prompt = args[0], args[1], args[2]
if prompt.startswith('@'): prompt = open(prompt[1:], encoding='utf-8').read().strip()
img2 = args[3] if len(args) > 3 else None
seed = int(flags.get('seed', 7))
c = Client('kulkas2pintu/QWEN_EDIT_IMAGE', verbose=False)
t = time.time()
for attempt in range(3):
    try:
        if 'pose' in flags:
            r = c.predict(image=handle_file(img), pose_ref=handle_file(flags['pose']), prompt=prompt, seed=seed, randomize_seed=False,
                          guidance_scale=1.0, steps=4, identity_strength=80, output_size=1280, fix_hands=True, lock_face_hair=False, api_name='/pose_still')
        else:
            r = c.predict(image=handle_file(img), prompt=prompt, lora_adapter='', image2=handle_file(img2) if img2 else None, seed=seed,
                          randomize_seed=False, guidance_scale=1.0, steps=int(flags.get('steps', 4)), preserve_identity=True,
                          identity_strength=int(flags.get('strength', 65)), output_size=int(flags.get('size', 1280)), fix_hands=False,
                          lock_face_hair=flags.get('lock') == '1', api_name='/edit')
        break
    except Exception as e:
        print('retry', attempt, type(e).__name__, str(e)[:160], flush=True); time.sleep(20)
else:
    sys.exit(1)
first = r[0] if isinstance(r, (list, tuple)) else r
if isinstance(first, list): first = first[0]
if isinstance(first, dict): first = first.get('image', first); first = first if isinstance(first, str) else first.get('path')
shutil.copy(first, out); print('OK', out, round(time.time() - t), 's')

"""One image edit on MiniMax's H3-Image Space (MiniMaxAI/minimax-h3-image, ZeroGPU; the model's licence excludes the US,
the EU, the UK and South Korea). The same interface as edit.py, so make_figure.py --editor=h3 can use it for every redraw.
usage: edit_h3.py <out.png> <image> <prompt or @prompt-file> [image2] [--seed=N] [--size=1280] [--resolution=1 MP]
  Every image goes in as a reference (the first is the one to redraw). The result is scaled to --size (square inputs give
  square results), the size the rest of the pipeline was built on with edit.py."""
import shutil, sys, time
from gradio_client import Client, handle_file
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
out, img, prompt = args[0], args[1], args[2]
if prompt.startswith('@'): prompt = open(prompt[1:], encoding='utf-8-sig').read().strip()
imgs = [img] + args[3:4]
seed = int(flags.get('seed', 7))
c = Client('MiniMaxAI/minimax-h3-image', verbose=False)
t = time.time()
for attempt in range(3):
    try:
        r = c.predict(prompt=prompt, images=[{'image': handle_file(p), 'caption': None} for p in imgs], aspect='auto',
                      resolution=flags.get('resolution', '1 MP'), seed=float(seed), randomize=False, enhance=False,
                      reasoning_effort='low', api_name='/generate')
        break
    except Exception as e:
        print('retry', attempt, type(e).__name__, str(e)[:160], flush=True); time.sleep(20)
else:
    sys.exit(1)
size = int(flags.get('size', 1280))
try:
    import cv2
    im = cv2.imread(r[0]); h, w = im.shape[:2]; k = size / max(h, w)
    cv2.imwrite(out, cv2.resize(im, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC))
except ImportError:
    shutil.copy(r[0], out)
print('OK', out, round(time.time() - t), 's')

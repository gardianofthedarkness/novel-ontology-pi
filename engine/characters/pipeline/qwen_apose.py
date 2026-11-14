"""A clean, full-body, A-pose front view of a character from reference images, with Qwen-Image-Edit-2511 (HF Space).
usage: qwen_apose.py <out.png> <prompt-file> <ref1> [ref2 ...]"""
import shutil, sys, time
from gradio_client import Client, handle_file
out, prompt_file, refs = sys.argv[1], sys.argv[2], sys.argv[3:]
prompt = open(prompt_file, encoding='utf-8').read().strip()
c = Client(sys.argv[0] and __import__('os').environ.get('QWEN_SPACE','linoyts/Qwen-Image-Edit-2511-Fast'), verbose=False)
t = time.time()
res, seed = c.predict(images=[{'image': handle_file(r), 'caption': None} for r in refs], prompt=prompt, seed=7, randomize_seed=False,
                      true_guidance_scale=1.0, num_inference_steps=8, height=1024, width=768, rewrite_prompt=False, api_name='/infer')
path = res[0]['image'] if isinstance(res[0]['image'], str) else res[0]['image']['path']
shutil.copy(path, out)
print('saved', out, 'seed', seed, 'in', round(time.time() - t), 's')


"""Re-pose a character into the pose of another image (Qwen-Image-Edit-2511 AnyPose, HF Space).
usage: anypose.py <out.png> <reference.png> <pose.png> [prompt]"""
import shutil, sys, time
from gradio_client import Client, handle_file
out, ref, pose = sys.argv[1:4]
prompt = sys.argv[4] if len(sys.argv) > 4 else ''
c = Client('linoyts/Qwen-Image-Edit-2511-AnyPose', verbose=False)
t = time.time()
res, seed = c.predict(reference_image=handle_file(ref), pose_image=handle_file(pose), prompt=prompt, seed=11, randomize_seed=False,
                      true_guidance_scale=1.0, num_inference_steps=4, height=1024, width=640, rewrite_prompt=False, api_name='/infer')
img = res[0]['image']; path = img if isinstance(img, str) else img['path']
shutil.copy(path, out); print('saved', out, round(time.time() - t), 's')

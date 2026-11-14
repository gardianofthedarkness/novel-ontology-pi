"""Gather and downscale the overnight results into E:/figures/page for the review page."""
import json, os, shutil
import cv2, numpy as np
from PIL import Image
P = r'E:\figures\page'; os.makedirs(os.path.join(P, 'img'), exist_ok=True)
M = r'E:\figures\misaka'
def jpg(src, name, width):
    im = Image.open(src).convert('RGB')
    if im.width > width: im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(os.path.join(P, 'img', name), quality=86); return name
# the pipeline steps
jpg(rf'{M}\plates\OPS_images_094111226566.jpg', 'ref_book_cover.jpg', 900)
jpg(rf'{M}\gen\psp_left.png', 'ref_anime_promo.jpg', 400)
jpg(rf'{M}\gen\apose_qwen.png', 'apose_front.jpg', 900)
jpg(rf'{M}\gen\front_prep\blocks.png', 'colour_blocks.jpg', 900)
# joints drawn on the A-pose
v = json.load(open(rf'{M}\gen\front_prep\view.json')); img = cv2.imread(rf'{M}\gen\apose_qwen.png')
J = v['joints']; pairs = [('l_sho', 'r_sho'), ('l_sho', 'l_elb'), ('l_elb', 'l_wri'), ('r_sho', 'r_elb'), ('r_elb', 'r_wri'), ('l_sho', 'l_hip'),
                         ('r_sho', 'r_hip'), ('l_hip', 'r_hip'), ('l_hip', 'l_knee'), ('l_knee', 'l_ank'), ('r_hip', 'r_knee'), ('r_knee', 'r_ank'), ('nose', 'l_eye'), ('nose', 'r_eye')]
for a, b in pairs:
    cv2.line(img, tuple(int(c) for c in J[a][:2]), tuple(int(c) for c in J[b][:2]), (255, 140, 30), 4, cv2.LINE_AA)
for k, (x, y, s) in J.items(): cv2.circle(img, (int(x), int(y)), 7, (40, 40, 230), -1, cv2.LINE_AA)
cv2.imwrite(rf'{M}\gen\joints.png', img); jpg(rf'{M}\gen\joints.png', 'joints.jpg', 900)
jpg(rf'{M}\gen\hunyuan_psp.png', 'shape_from_action_pose.jpg', 1600)
jpg(rf'{M}\gen\hunyuan_apose.png', 'shape_from_apose.jpg', 1600)
for f in ('toon_rest', 'toon_walk', 'holo_rest', 'holo_walk'):
    jpg(rf'{M}\figA\{f}.png', f'A_{f}.jpg', 1600)
    if os.path.exists(rf'{M}\figC\{f}.png'): jpg(rf'{M}\figC\{f}.png', f'C_{f}.jpg', 1600)
jpg(rf'{M}\out\front.png', 'procedural_doll.jpg', 500)
shutil.copy(rf'{M}\figA\Misaka.vrm', os.path.join(P, 'misaka_A.glb'))
shutil.copy(rf'{M}\figC\Misaka_inflated.vrm', os.path.join(P, 'misaka_C.glb'))
for f in sorted(os.listdir(os.path.join(P, 'img'))): print(f, os.path.getsize(os.path.join(P, 'img', f)) // 1024, 'KB')

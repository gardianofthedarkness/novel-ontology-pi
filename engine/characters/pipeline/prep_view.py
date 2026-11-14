"""Read a clean front view of a character: its outline, its joints, its flat colour blocks.
usage: prep_view.py <front.png> <out-dir> [--k=8]
Writes view.json (bbox, joints, palette, which colour is hair and skin) and labels.png (a palette index per pixel,
every pixel filled with its nearest figure colour so projection never lands on the background)."""
import json, os, sys
import cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
K = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--k=')), 8))
os.makedirs(out, exist_ok=True)
img = cv2.imread(src, cv2.IMREAD_COLOR); h, w = img.shape[:2]
# background: near-white pixels connected to the border (white clothes inside the line art stay)
white = (img.min(axis=2) > 232).astype(np.uint8)
ff = white.copy(); mask = np.zeros((h + 2, w + 2), np.uint8)
for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] + [(x, 0) for x in range(0, w, 40)] + [(x, h - 1) for x in range(0, w, 40)]:
    if ff[y, x] == 1: cv2.floodFill(ff, mask, (x, y), 2)
fg = (ff != 2).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(fg)
keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])); fg = (lab == keep).astype(np.uint8)
ys, xs = np.nonzero(fg); bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
# palette: k-means in Lab on the figure, then merge near colours
labimg = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
pix = labimg[fg == 1]
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
_, lbl, cent = cv2.kmeans(pix, K, None, crit, 4, cv2.KMEANS_PP_CENTERS)
lbl = lbl.ravel()
def merge(cent, lbl, thr=14.0):
    changed = True
    while changed:
        changed = False
        for i in range(len(cent)):
            for j in range(i + 1, len(cent)):
                if np.linalg.norm(cent[i] - cent[j]) < thr:
                    lbl[lbl == j] = i; cent[i] = pix[lbl == i].mean(axis=0) if (lbl == i).any() else cent[i]
                    cent = np.delete(cent, j, 0); lbl[lbl > j] -= 1; changed = True; break
            if changed: break
    return cent, lbl
MERGE = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--merge=')), 14))
cent, lbl = merge(cent.copy(), lbl.copy(), MERGE)
L = np.full((h, w), 255, np.uint8); L[fg == 1] = lbl
# wipe the line art and specks: a mode filter keeps big flat regions
def mode_filter(L, k=7, iters=2):
    for _ in range(iters):
        votes = np.stack([cv2.blur((L == i).astype(np.float32), (k, k)) for i in range(len(cent))], -1)
        best = votes.argmax(-1).astype(np.uint8); L = np.where(fg == 1, best, 255).astype(np.uint8)
    return L
L = mode_filter(L)
counts = np.array([(L == i).sum() for i in range(len(cent))])
# drop colours that cover almost nothing (left-over line art): reassign to the neighbourhood's best
small = [i for i in range(len(cent)) if counts[i] < 0.002 * fg.sum()]
if small:
    keepi = [i for i in range(len(cent)) if i not in small]
    votes = np.stack([cv2.blur((L == i).astype(np.float32), (15, 15)) for i in keepi], -1)
    repl = np.array(keepi, np.uint8)[votes.argmax(-1)]
    for i in small: L = np.where(L == i, repl, L)
    remap = {old: new for new, old in enumerate(keepi)}; cent = cent[keepi]
    L = np.where(L == 255, 255, np.vectorize(lambda v: remap.get(v, 0))(L)).astype(np.uint8)
counts = np.array([(L == i).sum() for i in range(len(cent))])
# fold drawn shadow tones into their base colour: same hue (a, b close), darker, and lying next to it
def fold_shades(L, cent):
    while True:
        done = True
        order = np.argsort(-cent[:, 0])
        for j in range(len(cent)):           # j: the darker candidate
            mj = (L == j)
            if not mj.any(): continue
            # a drawn shadow is thin scattered patches; a region (hair, shoes) has one big patch: never fold those
            ncc, cc, st, _ = cv2.connectedComponentsWithStats(mj.astype(np.uint8))
            if ncc > 1 and st[1:, cv2.CC_STAT_AREA].max() > 0.006 * fg.sum(): continue
            best = None
            for i in order:                  # i: a brighter base of the same hue, lying next to j
                if i == j: continue
                dL = (cent[i, 0] - cent[j, 0]) * 100 / 255; dab = np.linalg.norm(cent[i, 1:] - cent[j, 1:])
                if 6 < dL < 50 and dab < 18 and (L == i).sum() > mj.sum():
                    share = cv2.dilate((L == i).astype(np.uint8), np.ones((13, 13), np.uint8)).astype(bool)[mj].mean()
                    # chroma must agree too: a grey base never takes a brown shade
                    ci, cj = np.linalg.norm(cent[i, 1:] - 128), np.linalg.norm(cent[j, 1:] - 128)
                    if share > 0.3 and abs(ci - cj) < 12 and (best is None or dab < best[0]): best = (dab, i)
            if best:
                L = np.where(mj, best[1], L).astype(np.uint8); done = False; break
        if done: break
    used = [i for i in range(len(cent)) if (L == i).any()]
    remap = np.full(256, 255, np.uint8); remap[used] = np.arange(len(used)); return remap[L], cent[used]
L, cent = fold_shades(L, cent)
counts = np.array([(L == i).sum() for i in range(len(cent))])
# joints (RTMPose body, any drawing style)
from rtmlib import Body
kps, scores = Body(mode='balanced', backend='onnxruntime', device='cpu')(img)
NAMES = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_sho', 'r_sho', 'l_elb', 'r_elb', 'l_wri', 'r_wri', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ank', 'r_ank']
joints = {n: [float(x), float(y), float(s)] for n, (x, y), s in zip(NAMES, kps[0], scores[0])}
# which colour is hair (the top of the head) and skin (around the nose)
top = bbox[1]; cx = int((joints['l_ear'][0] + joints['r_ear'][0]) / 2)
hair_patch = L[top + 3: top + 25, max(cx - 15, 0): cx + 15]
hair = int(np.bincount(hair_patch[hair_patch != 255].ravel(), minlength=len(cent)).argmax())
nx, ny = int(joints['nose'][0]), int(joints['nose'][1])
skin_patch = L[ny - 6: ny + 6, nx - 25: nx + 25]
skin = int(np.bincount(skin_patch[skin_patch != 255].ravel(), minlength=len(cent)).argmax())
# fill the background with the nearest figure colour (projection never misses)
_, near = cv2.distanceTransformWithLabels((fg == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
fyx = np.argwhere(fg == 0)  # zero pixels of the input = the figure
lookup = np.zeros(near.max() + 1, np.int64); fill = L[fg == 1]
# map label ids of figure pixels to their palette value
idx = near[fg == 1]; lookup[idx] = fill
Lfull = np.where(fg == 1, L, lookup[near]).astype(np.uint8)
cv2.imwrite(os.path.join(out, 'labels.png'), Lfull); np.save(os.path.join(out, 'labels.npy'), Lfull); np.save(os.path.join(out, 'mask.npy'), fg.astype(np.uint8))
rgb = cv2.cvtColor(cent.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_LAB2RGB).reshape(-1, 3)
palette = ['#%02x%02x%02x' % tuple(int(c) for c in col) for col in rgb]
# a preview of the flat colour blocks
prev = np.full((h, w, 3), 255, np.uint8); prev[fg == 1] = rgb[L[fg == 1]][:, ::-1]
cv2.imwrite(os.path.join(out, 'blocks.png'), prev)
json.dump({'image': os.path.abspath(src), 'size': [w, h], 'bbox': bbox, 'joints': joints, 'palette': palette,
           'coverage': [round(float(c) / fg.sum(), 4) for c in counts], 'hair': hair, 'skin': skin}, open(os.path.join(out, 'view.json'), 'w'), indent=1)
print('palette', palette, 'hair', hair, palette[hair], 'skin', skin, palette[skin], 'bbox', bbox)





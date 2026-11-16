"""3D landmarks on a raw body with no rig: python marks_raw.py <body.glb> <bust-marks.json | -> <out-dir>
  1. the model stood as a body (1.6 m, feet down, centred) and rendered whole; RTMW points triangulated (as marks/landmarks.py)
  2. the head and shoulders framed as the bust frames itself: under the model top, down past its own shoulders (the
     shoulder points of pass 1) by the bust's own reach below its shoulders; rendered and triangulated again
  Writes <out>/body_n.glb, whole.json, head.json."""
import json, os, subprocess, sys
import cv2, numpy as np
from rtmlib import Wholebody
HERE = os.path.dirname(os.path.abspath(__file__)); BLENDER = os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.3\blender.exe'
SRC, BUSTJ, OUT = sys.argv[1:4]; os.makedirs(OUT, exist_ok=True); model = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')
def render(src, rd, *flags):
    r = subprocess.run([BLENDER, '-b', '-P', os.path.join(HERE, 'render_any.py'), '--', src, rd] + list(flags), capture_output=True, text=True)
    if 'FIG raw renders' not in r.stdout: print(r.stdout[-1500:], r.stderr[-1500:]); raise SystemExit('renders failed')
    return json.load(open(os.path.join(rd, 'cams.json')))
def marks(C):
    rays = {}
    for cam in C['cams']:
        img = cv2.imread(cam['file']); kps, scores = model(img)
        if not len(kps): continue
        i = int(np.argmax([s.mean() for s in scores])); k, s = kps[i], scores[i]; px = cam['px']; m = cam['width_m'] / px
        L, R, U, Bk = (np.array(cam[n]) for n in ('loc', 'right', 'up', 'back'))
        for j in range(len(k)):
            if not (0 <= k[j][0] < px and 0 <= k[j][1] < px) or s[j] <= 0: continue
            rays.setdefault(j, []).append((L + R * (k[j][0] - px / 2) * m + U * (px / 2 - k[j][1]) * m, -Bk, float(s[j])))
    out = {}
    for j, rs in rays.items():
        if len(rs) < 2: continue
        A = np.zeros((3, 3)); b = np.zeros(3)
        for o, d, w in rs: Pm = np.eye(3) - np.outer(d, d); A += w * Pm; b += w * Pm @ o
        if np.linalg.cond(A) > 1 / np.finfo(float).eps ** 0.5: continue
        p = np.linalg.solve(A, b); miss = [float(np.linalg.norm((np.eye(3) - np.outer(d, d)) @ (p - o))) for o, d, w in rs]; ws = np.array([w for _, _, w in rs])
        out[str(j)] = {'p': p.round(6).tolist(), 'views': len(rs), 'score': round(float((ws * ws).sum() / ws.sum()), 4), 'spread': round(float(np.median(miss)), 6)}
    return out
norm = os.path.join(OUT, 'body_n.glb')
C = render(SRC, os.path.join(OUT, 'whole_views'), '--norm=' + norm); W = marks(C)
json.dump({'points': W, 'bounds': C['bounds']}, open(os.path.join(OUT, 'whole.json'), 'w'), indent=1)
print('RAW whole body: %d points; shoulders %s nose %s' % (len(W), [W[k]['p'] for k in ('5', '6')], W['0']['p']))
if BUSTJ == '-': raise SystemExit(0)            # a body with no bust to frame for: the whole-body points are all that is wanted
bm = json.load(open(BUSTJ)); bp = bm['points']; b_sh = float(np.mean([bp[k]['p'][2] for k in ('5', '6')])); b_lo, b_hi = bm['bounds']
reach = (b_sh - b_lo[2]) / (b_hi[2] - b_sh)
zs = float(np.mean([W[k]['p'][2] for k in ('5', '6')])); z1 = C['bounds'][1][2]; z0 = zs - reach * (z1 - zs)
head = np.array([W[str(k)]['p'] for k in range(5) if str(k) in W]); cx = float(np.mean([W[k]['p'][0] for k in ('5', '6')])); cy = float(head[:, 1].mean())
C2 = render(norm, os.path.join(OUT, 'head_views'), '--frame=%f,%f,%f,%f' % (cx, cy, (z0 + z1) / 2, z1 - z0)); H = marks(C2)
json.dump({'mode': 'body', 'points': H, 'bounds': C['bounds']}, open(os.path.join(OUT, 'head.json'), 'w'), indent=1)
print('RAW head framed z %.3f..%.3f (bust reach %.2f): %d of 133 points; nose %s score %.2f spread %.1f mm' % (z0, z1, reach, len(H), H['0']['p'], H['0']['score'], 1000 * H['0']['spread']))

"""3D landmarks on a head and shoulders, from several angles: the portrait's bust, or the body's own head.
usage: python landmarks.py <out.json> --mode=bust --bust=<bust.glb>
       python landmarks.py <out.json> --mode=body --blend=<holo.blend> --bust-marks=<bust.json>   (the bust's first)
  Renders the model (render.py), finds the whole-body pose model's 133 points in each render (RTMW, rtmlib: body joints,
  68 face points, feet, hands), and triangulates each point from the rays of the views that saw it, each ray weighted by
  the detector's own confidence (no score cut-off: a doubtful point simply counts little). A point's 3D place is where its
  rays come closest together; the spread (how far they miss it) is kept with it, so a point the views disagree on can be
  weighted down later. No surface hit is needed (an ear behind the hair still has rays that meet)."""
import json, os, subprocess, sys
import cv2
import numpy as np
from rtmlib import Wholebody
HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
OUTJ = os.path.abspath(args[0]); RD = os.path.splitext(OUTJ)[0] + '_views'
BLENDER = flags.get('blender', r'C:\Program Files\Blender Foundation\Blender 5.3\blender.exe')
mode = flags['mode']
cmd = [BLENDER, '-b'] + ([flags['blend']] if mode == 'body' else []) + ['-P', os.path.join(HERE, 'render.py'), '--', RD, '--mode=' + mode] + \
      (['--bust=' + flags['bust']] if mode == 'bust' else ['--bust-marks=' + flags['bust-marks']])
r = subprocess.run(cmd, capture_output=True, text=True)
if 'FIG marks renders' not in r.stdout: print(r.stdout[-1500:], r.stderr[-1500:]); raise SystemExit('renders failed')
for line in r.stdout.splitlines():
    if line.startswith('FIG'): print(line)
C = json.load(open(os.path.join(RD, 'cams.json')))
model = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')
rays = {}     # point index -> list of (origin, direction, score)
for cam in C['cams']:
    img = cv2.imread(cam['file']); kps, scores = model(img)
    if not len(kps): continue
    i = int(np.argmax([s.mean() for s in scores]))                 # the figure: the detection the model is surest of
    k, s = kps[i], scores[i]; px = cam['px']; m = cam['width_m'] / px
    L, R, U, Bk = (np.array(cam[n]) for n in ('loc', 'right', 'up', 'back'))
    for j in range(len(k)):
        if not (0 <= k[j][0] < px and 0 <= k[j][1] < px) or s[j] <= 0: continue   # off the picture: no ray
        o = L + R * (k[j][0] - px / 2) * m + U * (px / 2 - k[j][1]) * m
        rays.setdefault(j, []).append((o, -Bk, float(s[j])))
out = {}
for j, rs in rays.items():
    if len(rs) < 2: continue                                              # one ray has no depth
    A = np.zeros((3, 3)); b = np.zeros(3)
    for o, d, w in rs:
        Pm = np.eye(3) - np.outer(d, d); A += w * Pm; b += w * Pm @ o
    if np.linalg.cond(A) > 1 / np.finfo(float).eps ** 0.5: continue      # NUMERIC: rays (nearly) parallel
    p = np.linalg.solve(A, b)
    miss = [float(np.linalg.norm((np.eye(3) - np.outer(d, d)) @ (p - o))) for o, d, w in rs]
    ws = np.array([w for _, _, w in rs])
    out[j] = {'p': p.round(6).tolist(), 'views': len(rs), 'score': round(float((ws * ws).sum() / ws.sum()), 4),
              'spread': round(float(np.median(miss)), 6)}
json.dump({'mode': mode, 'points': out, 'views': RD, 'bounds': C.get('bounds')}, open(OUTJ, 'w'), indent=1)
NAMES = {0: 'nose', 1: 'l_eye', 2: 'r_eye', 3: 'l_ear', 4: 'r_ear', 5: 'l_sho', 6: 'r_sho'}
print('FIG marks %s: %d of 133 points in 3D; %s' % (mode, len(out), {NAMES[j]: (out[j]['views'], round(out[j]['score'], 2)) for j in NAMES if j in out}))

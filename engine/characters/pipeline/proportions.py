"""Body proportions from each picture's joints, relative to the first (the base). usage: proportions.py <view-dir> ..."""
import json, os, sys
import numpy as np
def L(J, a, b): return float(np.linalg.norm(np.array(J[a][:2]) - np.array(J[b][:2])))
rows = []
for d in sys.argv[1:]:
    v = json.load(open(os.path.join(d, 'view.json'))); J = v['joints']; H = v['bbox'][3] - v['bbox'][1]
    mid = lambda a, b: (np.array(J[a][:2]) + np.array(J[b][:2])) / 2
    torso = float(np.linalg.norm(mid('l_sho', 'r_sho') - mid('l_hip', 'r_hip')))
    m = {'height px': H, 'shoulder width': L(J, 'l_sho', 'r_sho') / torso, 'hip width': L(J, 'l_hip', 'r_hip') / torso,
         'upper arm': (L(J, 'l_sho', 'l_elb') + L(J, 'r_sho', 'r_elb')) / 2 / torso, 'forearm': (L(J, 'l_elb', 'l_wri') + L(J, 'r_elb', 'r_wri')) / 2 / torso,
         'thigh': (L(J, 'l_hip', 'l_knee') + L(J, 'r_hip', 'r_knee')) / 2 / torso, 'shin': (L(J, 'l_knee', 'l_ank') + L(J, 'r_knee', 'r_ank')) / 2 / torso,
         'head (nose to shoulders)': float(np.linalg.norm(np.array(J['nose'][:2]) - mid('l_sho', 'r_sho'))) / torso,
         'stance (ankle gap)': L(J, 'l_ank', 'r_ank') / torso}
    rows.append((os.path.basename(d), m))
base = rows[0][1]
print(f"{'measure (÷ torso)':26s}" + ''.join(f'{n[5:] if n.startswith("prep_") else n:>11s}' for n, _ in rows))
for k in base:
    print(f'{k:26s}' + ''.join((f'{m[k]:11.0f}' if k == 'height px' else f'{m[k]:7.2f}{(m[k] / base[k] - 1) * 100:+4.0f}%' if n != rows[0][0] else f'{m[k]:11.2f}') for n, m in rows))

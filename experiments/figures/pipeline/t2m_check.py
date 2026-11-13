"""Physics / biology checks on text-to-motion clips (SMPL-H joint tracks from t2m_extract.py), on the source body and
retargeted onto a target rig's proportions. usage: t2m_check.py <clips-dir> <target-rig.json> <out-dir>"""
import glob, json, os, sys
import numpy as np, cv2
D, RIG, OUT = sys.argv[1], sys.argv[2], sys.argv[3]; os.makedirs(OUT, exist_ok=True)
rig = {k: (np.array(v[0]), np.array(v[1])) for k, v in json.load(open(RIG)).items()}
def blen(n): h, t = rig[n]; return float(np.linalg.norm(t - h))
TGT = {'thigh': (blen('upper_leg.L') + blen('upper_leg.R')) / 2, 'shank': (blen('lower_leg.L') + blen('lower_leg.R')) / 2,
       'hip_h': float(rig['upper_leg.L'][0][2]), 'ankle_h': float(rig['foot.L'][0][2])}
# segment masses (Dempster, fraction of body mass) between joints, for the centre of mass
SEG = [('Pelvis', 'Spine3', .497), ('Neck', 'Head', .081)] + [(f'{s}_{a}', f'{s}_{b}', m) for s in 'LR' for a, b, m in
       (('Shoulder', 'Elbow', .028), ('Elbow', 'Wrist', .016), ('Hip', 'Knee', .100), ('Knee', 'Ankle', .0465), ('Ankle', 'Foot', .0145))]
res = {}
def hull_dist(p, pts):
    """how far the point p (2D) is outside the convex hull of pts (0 if inside)"""
    if len(pts) < 3: return float(np.min(np.linalg.norm(pts - p, axis=1))) if len(pts) else 9.9
    hull = cv2.convexHull(pts.astype(np.float32)).reshape(-1, 2)
    d = cv2.pointPolygonTest(hull.reshape(-1, 1, 2), (float(p[0]), float(p[1])), True)
    return max(0.0, -d)
for path in sorted(glob.glob(os.path.join(D, '*.npz'))):
    z = np.load(path); P = z['P']; n = list(z['names']); fps = int(z['fps']); F = len(P); dt = 1 / fps
    J = lambda k: P[:, n.index(k)]
    r = {'frames': F, 'seconds': round(F / fps, 1)}
    # 1. the floor: lowest body point per frame
    r['lowest_body_cm'] = [round(float(z['low'].min()) * 100, 1), round(float(z['low'].max()) * 100, 1)]
    r['hand_below_floor_cm'] = round(float(min(0, z['handLow'].min())) * 100, 1)
    # 2. foot contact and skating: a planted foot's lowest joint must not slide
    skate = {}; contact = {}
    for s, low in (('L', z['lowL']), ('R', z['lowR'])):
        a, f = J(f'{s}_Ankle'), J(f'{s}_Foot')
        lowj = np.where((a[:, 2] < f[:, 2])[:, None], a, f)
        v = np.r_[0, np.linalg.norm(np.diff(lowj[:, :2], axis=0), axis=1)] / dt
        # planted: the foot's surface touches the floor and the foot is not in a swing (slower than 1 m/s)
        c = (low < 0.015) & (v < 1.0); contact[s] = c
        skate[s] = (float((v * dt)[c].sum()) * 100, float(v[c].max()) if c.any() else 0)
    r['foot_skate_cm'] = round(sum(x[0] for x in skate.values()), 1); r['max_planted_foot_speed'] = round(max(x[1] for x in skate.values()), 2)
    air = ~(contact['L'] | contact['R'])
    runs, cur = [], 0
    for a_ in air: cur = cur + 1 if a_ else 0; runs.append(cur)
    r['longest_airborne_s'] = round(max(runs) * dt, 2)
    # ballistic test: while nothing touches the floor the centre of mass must fall at g (fit a parabola to each flight)
    gs = []
    lowb = z['low'] > 0.01
    i = 0
    while i < F:
        if lowb[i]:
            j = i
            while j < F and lowb[j]: j += 1
            if j - i >= 6:
                tt = np.arange(i, j) * dt; cz = (sum(m * (J(a) + J(b)) / 2 for a, b, m in SEG) / sum(m for _, _, m in SEG))[i:j, 2]
                gs.append(round(-2 * float(np.polyfit(tt, cz, 2)[0]), 1))
            i = j
        else: i += 1
    r['flight_g'] = gs
    # 3. balance: centre of mass over the feet while (nearly) still
    com = sum(m * (J(a) + J(b)) / 2 for a, b, m in SEG) / sum(m for _, _, m in SEG)
    comv = np.r_[0, np.linalg.norm(np.diff(com, axis=0), axis=1)] / dt
    out_d = []
    for i in range(F):
        pts = [J(f'{s}_{k}')[i, :2] for s in 'LR' if contact[s][i] for k in ('Ankle', 'Foot')]
        if comv[i] < 0.25 and pts and z['low'][i] < 0.02:
            out_d.append(hull_dist(com[i, :2], np.array(pts)) - 0.05)
    out_d = np.array(out_d) if out_d else np.zeros(1)
    r['still_frames_COM_off_feet'] = int((out_d > 0.0).sum()); r['worst_COM_off_feet_cm'] = round(float(out_d.max()) * 100, 1)
    r['pelvis_height_m'] = [round(float(J('Pelvis')[:, 2].min()), 2), round(float(J('Pelvis')[:, 2].max()), 2)]
    # 4. joints: knee bending backwards; bones keeping their length
    hyper = 0
    for s in 'LR':
        hp, kn, an, ft = J(f'{s}_Hip'), J(f'{s}_Knee'), J(f'{s}_Ankle'), J(f'{s}_Foot')
        fwd = np.cross(J('L_Hip') - J('R_Hip'), np.array([0, 0, 1.0])); fwd /= np.linalg.norm(fwd, axis=1, keepdims=True) + 1e-9
        u = an - hp; t = np.sum((kn - hp) * u, 1) / np.sum(u * u, 1); off = kn - (hp + u * t[:, None])
        bend = np.degrees(np.arccos(np.clip(np.sum(((kn - hp) / np.linalg.norm(kn - hp, axis=1, keepdims=True)) * ((an - kn) / np.linalg.norm(an - kn, axis=1, keepdims=True)), 1), -1, 1)))
        hyper += int(((np.sum(off * fwd, 1) < -0.01) & (bend > 10) & (J('Pelvis')[:, 2] > 0.6)).sum())
    r['knee_bent_backwards_frames'] = hyper
    bl = [np.ptp(np.linalg.norm(J(b) - J(a), axis=1)) for a, b, _ in SEG]
    r['bone_length_drift_mm'] = round(float(max(bl)) * 1000, 2)
    # 5. smoothness: joint accelerations beyond what a body produces outside impacts
    acc = np.linalg.norm(np.diff(P, 2, axis=0), axis=2) / dt ** 2
    r['frames_acc_over_80'] = int((acc.max(1) > 80).sum())
    # 6. self-intersection: a hand inside the torso, the knees passing through each other
    def segdist(p, a, b):
        ab = b - a; t = np.clip(np.sum((p - a) * ab, 1) / np.sum(ab * ab, 1), 0, 1); return np.linalg.norm(a + ab * t[:, None] - p, axis=1)
    torso = [segdist(J(f'{s}_Wrist'), J('Pelvis'), J('Spine3')) for s in 'LR']
    r['hand_inside_torso_frames'] = int(sum((d < 0.07).sum() for d in torso))
    r['knees_through_each_other_frames'] = int((np.linalg.norm(J('L_Knee') - J('R_Knee'), axis=1) < 0.08).sum())
    # 7. continuity: what state the clip starts and ends in
    yaw = lambda i: float(np.degrees(np.arctan2(*(J('L_Hip')[i, :2] - J('R_Hip')[i, :2])[::-1])))
    r['start'] = {'pelvis_h': round(float(J('Pelvis')[0, 2]), 2), 'yaw': round(yaw(0))}
    r['end'] = {'pelvis_h': round(float(J('Pelvis')[-1, 2]), 2), 'yaw': round(yaw(-1)),
                'travel_m': round(float(np.linalg.norm(J('Pelvis')[-1, :2] - J('Pelvis')[0, :2])), 2)}
    # 8. on the target body: same joint directions, the target's bone lengths; root copied as-is vs scaled
    k = (TGT['thigh'] + TGT['shank']) / float(np.mean(np.linalg.norm(J('L_Knee') - J('L_Hip'), axis=1) + np.linalg.norm(J('L_Ankle') - J('L_Knee'), axis=1)))
    tg = {}
    for mode in ('root_copied', 'root_scaled'):
        sk, pen, flo = 0.0, 0.0, 0.0
        for s in 'LR':
            hp_s = J(f'{s}_Hip'); pel = J('Pelvis')
            root = pel * (k if mode == 'root_scaled' else 1.0); root[:, 2] = pel[:, 2] * k   # height always fitted to the legs
            hip = root + (hp_s - pel) * k
            kn = hip + TGT['thigh'] * (J(f'{s}_Knee') - hp_s) / np.linalg.norm(J(f'{s}_Knee') - hp_s, axis=1, keepdims=True)
            an = kn + TGT['shank'] * (J(f'{s}_Ankle') - J(f'{s}_Knee')) / np.linalg.norm(J(f'{s}_Ankle') - J(f'{s}_Knee'), axis=1, keepdims=True)
            c = contact[s]
            v = np.r_[0, np.linalg.norm(np.diff(an[:, :2], axis=0), axis=1)]
            sk += float(v[c].sum())
            sole = an[:, 2] - TGT['ankle_h'] * (J(f'{s}_Ankle')[:, 2] / max(1e-3, float(np.mean(J(f'{s}_Ankle')[:5, 2]))))
            if c.any(): pen = min(pen, float(sole[c].min())); flo = max(flo, float(sole[c].max()))
        tg[mode] = {'foot_skate_cm': round(sk * 100, 1), 'planted_foot_below_floor_cm': round(pen * 100, 1), 'planted_foot_above_floor_cm': round(flo * 100, 1)}
    r['on_target'] = tg; r['scale_k'] = round(k, 3)
    res[os.path.basename(path)[:-4]] = r
    # filmstrip: side view, 6 frames, planted feet green, problems red
    W, H = 1500, 330; img = np.full((H, W, 3), 18, np.uint8)
    BONES = [('Pelvis', 'Spine3'), ('Spine3', 'Neck'), ('Neck', 'Head')] + [(f'{s}_{a}', f'{s}_{b}') for s in 'LR' for a, b in
             (('Collar', 'Shoulder'), ('Shoulder', 'Elbow'), ('Elbow', 'Wrist'), ('Hip', 'Knee'), ('Knee', 'Ankle'), ('Ankle', 'Foot'))] + [('Pelvis', 'L_Hip'), ('Pelvis', 'R_Hip'), ('Spine3', 'L_Collar'), ('Spine3', 'R_Collar')]
    idx = np.linspace(0, F - 1, 6).astype(int); sc = 140
    cv2.line(img, (0, H - 30), (W, H - 30), (90, 90, 90), 1)
    for j, i in enumerate(idx):
        ox = 125 + j * 250; cx = float(J('Pelvis')[i, 1])
        to = lambda p: (int(ox + (p[1] - cx) * -sc), int(H - 30 - p[2] * sc))
        for a, b in BONES:
            cv2.line(img, to(J(a)[i]), to(J(b)[i]), (230, 200, 120), 2, cv2.LINE_AA)
        cv2.circle(img, to(J('Head')[i]), 9, (230, 200, 120), 2, cv2.LINE_AA)
        for s in 'LR':
            col = (90, 220, 90) if contact[s][i] else (200, 200, 200)
            cv2.circle(img, to(J(f'{s}_Ankle')[i]), 4, col, -1)
        cm = com[i]; cv2.drawMarker(img, to(cm), (60, 60, 240), cv2.MARKER_CROSS, 12, 2)
        cv2.line(img, (to(cm)[0], to(cm)[1]), (to(cm)[0], H - 30), (60, 60, 240), 1)
        if z['low'][i] > 0.03: cv2.putText(img, f"air {z['low'][i]*100:.0f}cm", (ox - 50, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80, 80, 250), 1, cv2.LINE_AA)
        cv2.putText(img, f'{i / fps:.1f}s', (ox - 15, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (160, 160, 160), 1, cv2.LINE_AA)
    cv2.putText(img, os.path.basename(path)[:-4], (8, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.imwrite(os.path.join(OUT, os.path.basename(path)[:-4] + '.png'), img)
json.dump(res, open(os.path.join(OUT, 'checks.json'), 'w'), indent=1)
print('target', {k: round(v, 3) for k, v in TGT.items()})
for k, r in res.items():
    print(f"{k:10s} body {r['lowest_body_cm']} air {r['longest_airborne_s']}s skate {r['foot_skate_cm']}cm (max {r['max_planted_foot_speed']}m/s) "
          f"COMoff {r['still_frames_COM_off_feet']}f/{r['worst_COM_off_feet_cm']}cm pelvis {r['pelvis_height_m']} kneeBack {r['knee_bent_backwards_frames']} "
          f"acc80 {r['frames_acc_over_80']} handInTorso {r['hand_inside_torso_frames']} kneeX {r['knees_through_each_other_frames']} hand<floor {r['hand_below_floor_cm']} "
          f"g {r['flight_g']} start {r['start']} end {r['end']} | k {r['scale_k']} copied {r['on_target']['root_copied']} scaled {r['on_target']['root_scaled']}")

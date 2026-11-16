"""The build's judge: the figure in its test poses, looked at by Jev (the project's decision model), beside the measured checks.
usage: python judge.py <build-dir> [--blend=organs.blend] [--model=jev-1.14.0] [--shots-only]
  Renders the poses (pose_shots.py in Blender), asks Jev fixed questions about each pose's pictures (yes-or-no with a
  probability, a score, a box on the worst fault), and writes <build>/judge/judge.json with Jev's answers, check.json's
  numbers and one score per build (0..1, higher is better) for comparing builds and for an optimiser to maximise.
  Nothing here is a pass/fail line: the score ranks builds; which build wins is decided by comparing scores.
  Jev's key is read from the vault (Windows Credential Manager), never printed or written."""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
D = os.path.abspath(args[0]); OUT = os.path.join(D, 'judge'); os.makedirs(OUT, exist_ok=True)
BLENDER = flags.get('blender', r'C:\Program Files\Blender Foundation\Blender 5.3\blender.exe')
MODEL = flags.get('model', 'jev-1.14.0'); ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

blend = os.path.join(D, flags.get('blend', 'organs.blend'))
r = subprocess.run([BLENDER, '-b', blend, '-P', os.path.join(HERE, 'pose_shots.py'), '--', os.path.join(OUT, 'shots')], capture_output=True, text=True)
if r.returncode or 'FIG shots' not in r.stdout: print(r.stdout[-1500:], r.stderr[-1500:]); raise SystemExit('pose renders failed')
shots = json.load(open(os.path.join(OUT, 'shots', 'shots.json')))
if 'shots-only' in flags: print('shots in', os.path.join(OUT, 'shots')); raise SystemExit(0)

from vault import get
KEY = get('jev')
if not KEY: raise SystemExit('no Jev key in the vault (python vault.py list)')
def b64(p): return base64.b64encode(open(p, 'rb').read()).decode()
def ask(state, images, questions):
    body = {'model': MODEL, 'state': {'state': state, **{n: n + '_image' for n in images}},
            'assets': {n + '_image': {'type': 'image', 'format': 'png', 'data_base64': b64(p)} for n, p in images.items()},
            'questions': questions}
    req = urllib.request.Request(ENDPOINT, json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY,
                                                                      'TypeSafe-Danger-Zone-Images': 'true'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as res: return json.loads(res.read())['answers']
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode('utf-8', 'replace')
            if e.code < 500 and e.code != 429: raise SystemExit('Jev refused: %d %s' % (e.code, msg))
        except (urllib.error.URLError, TimeoutError): pass
        time.sleep(1 + 2 * attempt)
    raise SystemExit('Jev failed 3 times')

STATE = ('Three renders of one 3D anime figure in one pose, flat grey with no colour: "head" is the head seen from the '
         'front, "head_q" the head from three-quarters, "body" the whole figure. The figure was built automatically from '
         'drawings; we are checking the 3D model for construction faults, not judging the art style.')
NECK = ['1 broken', '2 bad', '3 passable', '4 good', '5 clean']
Q = {
    'spike': {'type': 'noul', 'instructions': 'Does something thin and sharp stick out of the figure where it should not: a spike, '
              'needle, blade, shard or flat fin, especially around the head, neck, shoulders or face?',
              'criteria': {'true': 'at least one stray spike, shard or fin is visible', 'false': 'every protrusion belongs to the hair or clothes'}},
    'tear': {'type': 'noul', 'instructions': 'Is the surface torn, split, stretched into long streaks, or does it show a hole or gap, '
             'most likely where the head meets the neck or the neck meets the body?',
             'criteria': {'true': 'a tear, gap, hole or stretched streak is visible', 'false': 'the surface is whole and evenly shaped'}},
    'neck': {'type': 'score', 'instructions': 'How natural is the neck and the join between the head and the body in this pose?',
             'criteria': NECK},
    'worst': {'type': 'box', 'instructions': 'In the "head" picture, the worst construction fault (a spike, tear, hole or misplaced part).'},
}
Q_REST = {
    'organs': {'type': 'noul', 'instructions': 'Are the eyes, eyebrows, nose and mouth on the face where they belong: centred on the '
               'face, level, and of a size that fits the face?',
               'criteria': {'true': 'the face parts sit where a face has them', 'false': 'a face part is off to one side, tilted, too big or misplaced'}},
    'head_size': {'type': 'choice', 'instructions': 'In the "body" picture, is the head the right size for this anime figure\'s body?',
                  'criteria': {'too small': 'too small', 'right': 'right', 'too big': 'too big'}},
}
res = {}
for pose, f in shots.items():
    qs = dict(Q, **(Q_REST if pose == 'rest' else {}))
    t0 = time.time(); a = ask(STATE + ' Pose: ' + pose.replace('_', ' ') + '.', {'head': f['head'], 'head_q': f['head_q'], 'body': f['body']}, qs)
    row = {}
    for k, q in qs.items():
        x = a.get(k, {})
        if q['type'] == 'noul': row[k] = round(float(x.get('noul', 0)), 3)
        elif q['type'] == 'score':
            row[k] = round(float(x.get('score', 0)), 2)   # the expected level, 0 (the first) .. len-1 (the last)
        elif q['type'] == 'choice': row[k] = x.get('choice'); row[k + '_p'] = x.get('probabilities')
        else: row[k] = x.get('box'); row[k + '_conf'] = x.get('confidence')
    res[pose] = row; print('%-10s %s  (%.1f s)' % (pose, {k: v for k, v in row.items() if not k.endswith('_p') and k != 'worst'}, time.time() - t0))
# one score per build: the mean, over poses, of (no spike) x (no tear) x (neck quality 0..1); the rest pose's face and
# head-size answers multiply in once. Products, so one bad answer cannot be averaged away.
def nk(v): return float(v) / (len(NECK) - 1) if isinstance(v, (int, float)) else 0.5
per = [(1 - r['spike']) * (1 - r['tear']) * nk(r['neck']) for r in res.values()]
rest = res.get('rest', {}); hs = (rest.get('head_size_p') or {}).get('right', 0.5)
score = sum(per) / len(per) * rest.get('organs', 0.5) * hs
check = json.load(open(os.path.join(D, 'check.json'))) if os.path.exists(os.path.join(D, 'check.json')) else {}
out = {'build': D, 'model': MODEL, 'score': round(score, 4), 'per_pose': res,
       'measured': {p: {k: v for k, v in c.items() if k in ('seam_open_mm', 'head_edges_over_1.25', 'body_edges_over_1.25')} for p, c in check.items() if isinstance(c, dict)}}
json.dump(out, open(os.path.join(OUT, 'judge.json'), 'w'), indent=1)
print('JUDGE score %.4f  (%s)' % (score, os.path.join(OUT, 'judge.json')))

"""Make a character's figure from one setting picture: the raw-merge pipeline (rawmerge/README.md), in order, resumable.
usage: python make_figure.py <setting.png> <out-dir> --name=<Name> [--portrait=<head.png>] [--full=<full-length.png>]
        [--remove="<what to leave out>"]
        [--seed=11] [--editor=h3|qwen] [--blender=<blender.exe>] [--python=<python.exe>] [--from=<step>] [--only=<step>]
  <setting.png>: one picture of the character, any pose (a full body is best). --portrait: a separate, sharper picture of
  the head (else the head is cut from the T-pose redraw, above its arms). --remove: things in the picture that are not the character
  ("the bag and its strap", "the cat"). --full: a second picture of the character at full length, for an outfit the
  setting picture cuts off. Every step writes into <out-dir> and is skipped when its output is there, so a run can be
  resumed; --from reruns from a step on, --only runs one step. Tokens come from the system's credential store (vault.py),
  never from a file. --editor: the image model for the redraws: h3 (MiniMax H3-Image, edit_h3.py, the default; its licence
  excludes the US, the EU, the UK and South Korea) or qwen (Qwen-Image-Edit, edit.py).
  Remote calls: four image edits (T-pose, its back, the base layer, the portrait), one Hunyuan3D-2.1 shape (the head bust)
  and one paid TRELLIS.2 job on Hugging Face (the dressed body and the base body together).
  In order: redraws -> bust -> TRELLIS.2 bodies -> the bust merged onto the body raw, the neck as one tube -> reduced, the
  head finer -> the base body laid inside by elastic bone matching -> a filled solid, the skeleton and weights on it ->
  weights onto the reduced figure -> the base body packed as the hidden layer for soft cloth.
  The result: <out-dir>/layers_m.vrm (+ .blend) and figure_m.txt (gzip+base64, for the viewer).
  Not in this pipeline yet (their scripts wait in this folder to be moved onto the merged figure): the head lock and jaw
  (head_lock.py, face_rig.py), hair springs (hair_rig.py), face organs (eye_shapes.py, eye_parts.py, face28.py), joint
  smoothing (smooth_joints.py), the checks (check_head.py, judge.py). The path that had them (the bust grafted after the
  rig, on a Hunyuan body) is at tag figures-raw-steady-1 and before."""
import base64, gzip, json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
# the pipeline's own Python (OpenCV, gradio_client, rtmlib): started from another one, the build re-runs itself there
# (--python or FIG_PYTHON, else the usual place) instead of failing at its first step
try:
    import cv2, gradio_client, rtmlib   # noqa: F401
except ImportError as e:
    _py = next((a[9:] for a in sys.argv if a.startswith('--python=')), None) or os.environ.get('FIG_PYTHON')         or os.path.join('E:' + os.sep, 'splat', '.venv', 'Scripts', 'python.exe')
    if os.path.exists(_py) and os.path.abspath(_py) != os.path.abspath(sys.executable):
        print('this Python lacks %s; running under %s' % (e.name, _py), flush=True)
        raise SystemExit(subprocess.call([_py, os.path.abspath(__file__)] + sys.argv[1:]))
    raise SystemExit('the pipeline needs OpenCV, gradio_client and rtmlib (missing: %s); give --python=<its python.exe>' % e.name)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
if len(args) < 2 or not flags.get('name'): raise SystemExit(__doc__)
SRC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1]); NAME = flags['name']
BLENDER = flags.get('blender') or os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.3\blender.exe'
PY = sys.executable; SEED = flags.get('seed', '11'); EDITOR = flags.get('editor', 'h3')
REMOVE = flags.get('remove', '').strip()
FULL = os.path.abspath(flags['full']) if flags.get('full') else None   # a second picture showing the whole length of the outfit
os.makedirs(OUT, exist_ok=True)
P = lambda *p: os.path.join(OUT, *p)
RAW = lambda name: os.path.join(os.path.dirname(HERE), 'rawmerge', name)   # the raw merge's scripts
LOG = open(P('build.log'), 'a', encoding='utf-8')
def log(msg):
    line = time.strftime('%H:%M:%S ') + msg; print(line, flush=True); LOG.write(line + '\n'); LOG.flush()

def run(cmd, hf=False):
    """one tool; its FIG lines go to the log; a failure stops the build"""
    if hf: cmd = [PY, '-I', os.path.join(HERE, 'vault.py'), 'run'] + cmd
    t = time.time(); r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    for line in (r.stdout + r.stderr).splitlines():
        if line.split(' ')[0] in ('FIG', 'BASE', 'LAYERS', 'OUTER', 'RAW', 'SKIN', 'SOLID') or 'saved' in line[:12] or 'Error' in line or 'Traceback' in line: LOG.write('    ' + line + '\n')
    LOG.flush()
    if r.returncode != 0: log('FAILED (%s): %s' % (r.returncode, (r.stdout + r.stderr)[-1500:])); raise SystemExit(1)
    return round(time.time() - t)
def blender(script, *a, blend=None):
    cmd = [BLENDER, '-b'] + ([blend] if blend else []) + ['-P', os.path.join(HERE, script), '--'] + list(a)
    return run(cmd)
def prompt(name):
    text = open(os.path.join(HERE, 'prompts', name + '.txt'), encoding='utf-8-sig').read()
    text = text.replace('{remove}', ('Leave out %s. ' % REMOVE) if REMOVE else '')
    text = text.replace('{design}', ("The second image is the character's original design: take the face, the eyes, the hair, the hair "
                        "accessories and the clothes at the neck and shoulders exactly from it, but not its pose. ") if name == 'portrait' else
                        "The second image is the character's original design: take the hair, the accessories and the outfit from it, but not its pose. ")
    text = text.replace('{full}', "The second image shows the same character at full length: take the outfit's full length, hems and shoes from it. " if FULL else '')
    path = P('prompt_%s.txt' % name); open(path, 'w', encoding='utf-8').write(text); return '@' + path
def edit(out, img, name, img2=None, seed=None):
    if EDITOR == 'h3':
        return run([PY, os.path.join(HERE, 'edit_h3.py'), out, img, prompt(name)] + ([img2] if img2 else []) + ['--seed=' + str(seed or SEED)], hf=True)
    return run([PY, os.path.join(HERE, 'edit.py'), out, img, prompt(name)] + ([img2] if img2 else []) + ['--seed=' + str(seed or SEED), '--lock=1', '--strength=65'], hf=True)
TRIES = 3   # STRUCTURAL: remote redraws at most per portrait
def portrait():
    """the head-and-shoulders redraw, checked for hands (the redraw tends to add them at the shoulders, and they become lumps
    on the head's bust): up to TRIES seeds (STRUCTURAL: a budget of remote calls); if every one has hands, the one whose
    hands the detector is least sure of is kept"""
    import json as _j; tries = []
    for k in range(TRIES):
        # the head crop sets the pose; the original picture, as a second reference, carries the details a small head in the
        # T-pose has lost (a bow, a hair clip, the face's own lines)
        edit(P('portrait.png'), P('head_crop.png'), 'portrait', img2=P('in', 'setting_sq.png'), seed=int(SEED) + k)
        r = subprocess.run([PY, os.path.join(HERE, 'hands_check.py'), P('portrait.png')], capture_output=True, text=True, encoding='utf-8', errors='replace')
        found = [l for l in r.stdout.splitlines() if l.startswith('FIG')]
        LOG.write('    ' + (found[0] if found else 'FIG hands check gave nothing') + '\n'); LOG.flush()
        if r.returncode == 0: return
        line = found[0] if found else ''; hands = _j.loads(line.split(':', 1)[1]) if line.strip().endswith(']') else []
        sure = max([h.get('median_score', 1.0) for h in hands] or [1.0])
        keep = P('portrait_seed%d.png' % k); shutil.copy(P('portrait.png'), keep); tries.append((sure, keep))
        log('portrait: hands in it (seed %d, sureness %.2f), redrawing' % (int(SEED) + k, sure))
    best = min(tries); shutil.copy(best[1], P('portrait.png'))
    log('portrait: hands in every seed; kept the one the detector is least sure of (%.2f)' % best[0])
def shape(out, *imgs, octree=384, model='2.1'):
    return run([PY, os.path.join(HERE, 'hunyuan_shape.py'), out] + list(imgs) + ['--model=' + model, '--mode=Standard', '--steps=30', '--octree=%d' % octree], hf=True)
def prep(img, d): return run([PY, os.path.join(HERE, 'prep_view.py'), img, d])

def pad_white(src, out):
    """the portrait on a white margin before the bust is shaped (a portrait whose hair reaches the picture's edges came back
    as a flat card): padded until its figure fills the frame as much as the T-pose's figure fills the T-pose picture,
    which the shape model turns into a body without fail"""
    import cv2, numpy as np
    sys.path.insert(0, HERE); from prep_view import figure_mask
    def fill(path):
        m = figure_mask(cv2.imread(path))[0]; ys, xs = np.nonzero(m); H, W = m.shape
        return max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1) / max(H, W), m
    share_t, _ = fill(P('tpose.png')); share_p, _ = fill(src)
    im = cv2.imread(src); h, w = im.shape[:2]
    m = max(0, int(round((max(h, w) * share_p / share_t - max(h, w)) / 2)))
    log('portrait pad: its figure fills %.2f of the frame, the T-pose %.2f: %d px of white on each side' % (share_p, share_t, m))
    cv2.imwrite(out, cv2.copyMakeBorder(im, m, m, m, m, cv2.BORDER_CONSTANT, value=(255, 255, 255)))
def check_bust(path):
    """a head is about as deep as it is wide; a card is not (the shape model sometimes returns the whole picture as a plane)"""
    import trimesh
    m = trimesh.load(path, force='mesh'); ext = m.bounds[1] - m.bounds[0]; depth, width = sorted(ext)[0], sorted(ext)[1]
    log('bust: %.3f x %.3f x %.3f (depth %.0f%% of width)' % (*ext, 100 * depth / width))
    if depth < 0.35 * width:
        os.remove(path); log('FAILED: the bust is a flat card, not a head'); raise SystemExit(1)
def pad_square():
    import cv2, numpy as np
    im = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)
    if im.ndim == 2: im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 4:          # a see-through picture (a PNG or WebP cut-out): onto white, not the hidden colour under it
        a = im[:, :, 3:4].astype(np.float32) / 255.0
        im = (im[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)).round().astype(np.uint8)
    # square, no more: in a T-pose the arms span about the figure's height (the arm span equals the height), so a square as
    # tall as the picture holds the spread arms with the picture's own margin above and below on each side too
    h, w = im.shape[:2]; s = max(h, w)
    out = cv2.copyMakeBorder(im, (s - h) // 2, s - h - (s - h) // 2, (s - w) // 2, s - w - (s - w) // 2, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    cv2.imwrite(P('in', 'setting_sq.png'), out); shutil.copy(SRC, P('in', 'setting' + os.path.splitext(SRC)[1]))

STEPS = [
    # name, output that marks it done, what it does
    ('square', P('in', 'setting_sq.png'), lambda: (os.makedirs(P('in'), exist_ok=True), pad_square())),
    ('tpose', P('tpose.png'), lambda: edit(P('tpose.png'), P('in', 'setting_sq.png'), 'tpose', FULL)),
    ('back', P('tback.png'), lambda: edit(P('tback.png'), P('tpose.png'), 'back')),
    # the same T-pose in a plain base layer: the base body under the clothes is shaped from it
    ('base', P('base.png'), lambda: edit(P('base.png'), P('tpose.png'), 'base')),
    ('head_crop', P('head_crop.png'), lambda: run([PY, os.path.join(HERE, 'crop_head.py'), flags['portrait'], P('head_crop.png')]) if flags.get('portrait')
                                       else run([PY, os.path.join(HERE, 'crop_head.py'), P('tpose.png'), P('head_crop.png'), '--above-shoulders'])),
    ('portrait', P('portrait.png'), portrait),
    ('bust', P('bust.glb'), lambda: (pad_white(P('portrait.png'), P('portrait_pad.png')), shape(P('bust.glb'), P('portrait_pad.png'), octree=512), check_bust(P('bust.glb')))),
    ('prep', P('prep', 'view.json'), lambda: (prep(P('tpose.png'), P('prep')), prep(P('tback.png'), P('prep_back')), prep(P('portrait.png'), P('prep_portrait')))),
    ('marks_bust', P('marks', 'bust.json'), lambda: run([sys.executable, os.path.join(os.path.dirname(HERE), 'marks', 'landmarks.py'), P('marks', 'bust.json'), '--mode=bust', '--bust=' + P('bust.glb')])),
    # the raw merge (rawmerge/README.md): a second body from the T-pose front alone on TRELLIS.2 (a paid job on the account's
    # credit), the Hunyuan bust merged onto it before any rig with the neck as one tube, then reduced for the hologram.
    ('body_cut', P('base_rgba.png'), lambda: (run([PY, RAW('cutout.py'), P('tpose.png'), P('body_rgba.png')]), run([PY, RAW('cutout.py'), P('base.png'), P('base_rgba.png')]))),
    # the dressed body and its base body (the same T-pose in a plain base layer) in one job: the model loads once
    ('body_t2', P('base_t2.glb'), lambda: run([PY, RAW('trellis_body.py'), P('body_rgba.png'), P('body_t2.glb'), P('base_rgba.png'), P('base_t2.glb')])),
    ('raw_merge', P('merged.glb'), lambda: run([PY, RAW('merge_raw.py'), P('body_t2.glb'), P('bust.glb'), P('marks', 'bust.json'), P('raw'), P('merged.glb'), '--blender=' + BLENDER])),
    ('reduce', P('reduced.glb'), lambda: run([BLENDER, '-b', '-P', RAW('reduce.py'), '--', P('merged.glb'), P('reduced.glb'), P('reduced.json'), '--head=' + P('raw', 'head_region.glb')])),
    # the base body under the clothes, raw first (rawmerge/README.md): its joints found, its closed outer skin taken, then laid
    # inside the merged figure with no head by elastic bone matching (the dressed figure is the reference); the figure's layer
    # thickness is its distance to that body. Then reduced: the base to the figure's body tolerance, the thickness carried over.
    ('base_marks', P('raw_base', 'whole.json'), lambda: run([PY, RAW('marks_raw.py'), P('base_t2.glb'), '-', P('raw_base')])),
    ('base_skin', P('raw_base', 'base_outer.glb'), lambda: (run([BLENDER, '-b', '-P', RAW('skin.py'), '--', 'skin', P('raw_base', 'body_n.glb'), P('raw_base', 'base_skin.glb'), '%r' % json.load(open(P('raw', 'merge.json')))['grid_m']]),
                                                             run([PY, RAW('outer.py'), P('raw_base', 'base_skin.glb'), P('raw_base', 'base_outer.glb')]))),
    ('base_raw', P('raw_base', 'thick.npy'), lambda: run([PY, RAW('base_raw.py'), P('merged.glb'), P('raw', 'whole.json'), P('raw', 'tube.json'), P('raw_base', 'base_outer.glb'), P('raw_base', 'whole.json'), P('raw_base')])),
    ('base_reduce', P('base_reduced.glb'), lambda: run([BLENDER, '-b', '-P', RAW('reduce.py'), '--', P('raw_base', 'base_fit.glb'), P('base_reduced.glb'), P('base_reduced.json'),
                                                         '--tol=%r' % (json.load(open(P('reduced.json')))['body']['tolerance_mm'] / 1000)])),
    ('solid', P('merged_solid.glb'), lambda: run([PY, RAW('solid.py'), P('merged.glb'), P('merged_solid.glb')])),
    ('rig_m', P('rig_m', NAME + '.blend'), lambda: blender('dress_rig.py', P('merged_solid.glb'), P('prep'), P('rig_m'), '--back=' + P('prep_back'), '--name=' + NAME, '--marks=' + P('raw', 'whole.json'))),
    ('holo_m', P('holo_m.vrm'), lambda: blender('holo_detail.py', P('rig_m', NAME + '.blend'), P('reduced.glb'), P('holo_m.blend'), '--asis=1', '--vrm=1')),
    # the base body (laid inside the figure raw, reduced) packed as the hidden layer, the head split off as its own rigid mesh
    ('layers_m', P('layers_m.vrm'), lambda: blender(os.path.join('..', 'rawmerge', 'layer_raw.py'), P('base_reduced.glb'), P('rig_m', NAME + '.blend'), P('raw', 'head_region.glb'), P('layers_m.blend'), blend=P('holo_m.blend'))),
    ('page_m', P('figure_m.txt'), lambda: open(P('figure_m.txt'), 'w').write(base64.b64encode(gzip.compress(open(P('layers_m.vrm'), 'rb').read(), 9)).decode())),
]

names = [s[0] for s in STEPS]
start = names.index(flags['from']) if flags.get('from') else 0
log('== %s from %s into %s (steps %s)' % (NAME, SRC, OUT, ', '.join(names[start:] if not flags.get('only') else [flags['only']])))
for i, (name, done, do) in enumerate(STEPS):
    if flags.get('only') and name != flags['only']: continue
    if i < start: continue
    if os.path.exists(done) and not flags.get('from') and not flags.get('only'): continue
    # a step that runs starts without its old output: a failed rerun must not leave an earlier run's file looking done
    if os.path.isfile(done): os.remove(done)
    t = time.time(); do()
    if not os.path.exists(done):     # Blender exits 0 even when its script fails: the step's output is the proof
        log('FAILED: %s wrote no %s (its messages are above)' % (name, done)); raise SystemExit(1)
    log('%-12s %4d s' % (name, round(time.time() - t)))
log('== done: %s' % P('layers_m.vrm'))

"""Make a character's figure from one setting picture: the whole pipeline (VERSIONS.md, v0.8), in order, resumable.
usage: python make_figure.py <setting.png> <out-dir> --name=<Name> [--portrait=<head.png>] [--full=<full-length.png>]
        [--remove="<what to leave out>"]
        [--seed=11] [--blender=<blender.exe>] [--from=<step>] [--only=<step>]
  <setting.png>: one picture of the character, any pose (a full body is best). --portrait: a separate, sharper picture of
  the head (else the head is cut from the T-pose redraw, above its arms). --remove: things in the picture that are not the character
  ("the bag and its strap", "the cat"). --full: a second picture of the character at full length, for an outfit the
  setting picture cuts off (the T-pose takes its length, hems and shoes from it). With many pictures of a character (a
  book's colour plates), pick the sharpest front view as the setting picture, a calm front close-up as --portrait and a
  standing full-length one as --full. Every step writes into <out-dir> and is skipped when its output is there, so a run
  can be resumed; --from reruns from a step on, --only runs one step. The Hugging Face token comes from the system's
  credential store (vault.py), never from a file. Seven GPU calls in all (four image edits, three shapes).
  The result: <out-dir>/organs.vrm (+ .blend; figure.vrm is the same without the carved eyes), check.json (check_head.py),
  figure.txt (gzip+base64, for the viewer). --portrait-py: the Python with anime-face-detector (for the eyes)."""
import base64, gzip, json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
if len(args) < 2 or not flags.get('name'): raise SystemExit(__doc__)
SRC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1]); NAME = flags['name']
BLENDER = flags.get('blender') or os.environ.get('BLENDER') or r'C:\Program Files\Blender Foundation\Blender 5.3\blender.exe'
PY = sys.executable; SEED = flags.get('seed', '11')
# the Python with anime-face-detector (the album portrait tool's, tools/album-portraits): --portrait-py or FIG_PORTRAIT_PY
PORTRAIT_PY = flags.get('portrait-py') or os.environ.get('FIG_PORTRAIT_PY') or os.path.join('E:' + os.sep, 'figures', 'portrait-venv', 'Scripts', 'python.exe')
REMOVE = flags.get('remove', '').strip()
FULL = os.path.abspath(flags['full']) if flags.get('full') else None   # a second picture showing the whole length of the outfit
os.makedirs(OUT, exist_ok=True)
P = lambda *p: os.path.join(OUT, *p)
LOG = open(P('build.log'), 'a', encoding='utf-8')
def log(msg):
    line = time.strftime('%H:%M:%S ') + msg; print(line, flush=True); LOG.write(line + '\n'); LOG.flush()

def run(cmd, hf=False):
    """one tool; its FIG lines go to the log; a failure stops the build"""
    if hf: cmd = [PY, '-I', os.path.join(HERE, 'vault.py'), 'run'] + cmd
    t = time.time(); r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    for line in (r.stdout + r.stderr).splitlines():
        if line.startswith('FIG') or 'saved' in line[:12] or 'Error' in line or 'Traceback' in line: LOG.write('    ' + line + '\n')
    LOG.flush()
    if r.returncode != 0: log('FAILED (%s): %s' % (r.returncode, (r.stdout + r.stderr)[-1500:])); raise SystemExit(1)
    return round(time.time() - t)
def blender(script, *a, blend=None):
    cmd = [BLENDER, '-b'] + ([blend] if blend else []) + ['-P', os.path.join(HERE, script), '--'] + list(a)
    return run(cmd)
def prompt(name):
    text = open(os.path.join(HERE, 'prompts', name + '.txt'), encoding='utf-8-sig').read()
    text = text.replace('{remove}', ('Leave out %s. ' % REMOVE) if REMOVE else '')
    text = text.replace('{full}', "The second image shows the same character at full length: take the outfit's full length, hems and shoes from it. " if FULL else '')
    path = P('prompt_%s.txt' % name); open(path, 'w', encoding='utf-8').write(text); return '@' + path
def edit(out, img, name, img2=None):
    return run([PY, os.path.join(HERE, 'edit.py'), out, img, prompt(name)] + ([img2] if img2 else []) + ['--seed=' + SEED, '--lock=1', '--strength=65'], hf=True)
def shape(out, *imgs, octree=384):
    return run([PY, os.path.join(HERE, 'hunyuan_shape.py'), out] + list(imgs) + ['--mode=Standard', '--steps=30', '--octree=%d' % octree], hf=True)
def prep(img, d): return run([PY, os.path.join(HERE, 'prep_view.py'), img, d])

def pad_square():
    import cv2
    im = cv2.imread(SRC); h, w = im.shape[:2]; s = int(max(h, w) * 1.15)
    out = cv2.copyMakeBorder(im, (s - h) // 2, s - h - (s - h) // 2, (s - w) // 2, s - w - (s - w) // 2, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    cv2.imwrite(P('in', 'setting_sq.png'), out); shutil.copy(SRC, P('in', 'setting' + os.path.splitext(SRC)[1]))

STEPS = [
    # name, output that marks it done, what it does
    ('square', P('in', 'setting_sq.png'), lambda: (os.makedirs(P('in'), exist_ok=True), pad_square())),
    ('tpose', P('tpose.png'), lambda: edit(P('tpose.png'), P('in', 'setting_sq.png'), 'tpose', FULL)),
    ('back', P('tback.png'), lambda: edit(P('tback.png'), P('tpose.png'), 'back')),
    ('base', P('base.png'), lambda: edit(P('base.png'), P('tpose.png'), 'base')),
    ('base_back', P('base_back.png'), lambda: edit(P('base_back.png'), P('base.png'), 'back')),
    # the head from the T-pose redraw, cut off above the shoulders (its arms, at shoulder height, read as hands at the neck):
    # the same colours and costume as the body by construction (a portrait from another picture can disagree: a green-tinted
    # cover gave Index green hair and no hood); --portrait gives a sharper picture instead, at that risk
    ('head_crop', P('head_crop.png'), lambda: run([PY, os.path.join(HERE, 'crop_head.py'), flags['portrait'], P('head_crop.png')]) if flags.get('portrait')
                                       else run([PY, os.path.join(HERE, 'crop_head.py'), P('tpose.png'), P('head_crop.png'), '--above-shoulders'])),
    ('portrait', P('portrait.png'), lambda: edit(P('portrait.png'), P('head_crop.png'), 'portrait')),
    ('shape', P('shape.glb'), lambda: shape(P('shape.glb'), P('tpose.png'), P('tback.png'))),
    ('base_shape', P('base.glb'), lambda: shape(P('base.glb'), P('base.png'), P('base_back.png'))),
    ('bust', P('bust.glb'), lambda: shape(P('bust.glb'), P('portrait.png'), octree=512)),
    ('prep', P('prep', 'view.json'), lambda: (prep(P('tpose.png'), P('prep')), prep(P('tback.png'), P('prep_back')), prep(P('base.png'), P('prep_base')),
                                               prep(P('base_back.png'), P('prep_base_back')), prep(P('portrait.png'), P('prep_portrait')))),
    ('rig', P('rig', NAME + '.blend'), lambda: blender('dress_rig.py', P('shape.glb'), P('prep'), P('rig'), '--back=' + P('prep_back'), '--name=' + NAME)),
    ('holo', P('holo.blend'), lambda: blender('holo_detail.py', P('rig', NAME + '.blend'), P('shape.glb'), P('holo.blend'))),
    ('head', P('headswap.blend'), lambda: blender('head_swap.py', P('holo.blend'), P('prep'), P('bust.glb'), P('prep_portrait'), P('headswap.blend'))),
    ('joints', P('smooth.blend'), lambda: blender('smooth_joints.py', P('headswap.blend'), P('smooth.blend'), 'Outfit_main=%s=%s' % (P('prep'), P('prep_back')))),
    ('base_rig', P('base_rig', 'Base.blend'), lambda: blender('dress_rig.py', P('base.glb'), P('prep_base'), P('base_rig'), '--back=' + P('prep_base_back'), '--name=Base')),
    ('base_holo', P('base_detail.blend'), lambda: blender('holo_detail.py', P('base_rig', 'Base.blend'), P('base.glb'), P('base_detail.blend'))),
    ('mannequin', P('base_smooth.blend'), lambda: blender('mannequin.py', P('base_detail.blend'), P('base_smooth.blend'))),
    ('layers', P('layers.blend'), lambda: blender('layer_pack.py', P('smooth.blend'), P('base_smooth.blend'), P('layers.blend'))),
    ('lock', P('lock.blend'), lambda: blender('head_lock.py', P('lock.blend'), blend=P('layers.blend'))),
    ('face_render', P('face', 'views.json'), lambda: blender('face_render.py', P('face'), blend=P('lock.blend'))),
    ('face_marks', P('face', 'marks.json'), lambda: run([PY, os.path.join(HERE, 'face_marks.py'), P('face'), '--portrait=' + P('portrait.png')])),
    ('face_rig', P('face.blend'), lambda: blender('face_rig.py', P('face'), P('face.blend'), blend=P('lock.blend'))),
    ('hair', P('figure.blend'), lambda: blender('hair_rig.py', P('prep_portrait'), P('face'), P('figure.blend'), blend=P('face.blend'))),
    # the eyes (v0.8): read from the portrait with an anime face detector (in the portrait tool's Python), then carved as
    # quad parts on the head, a socket cut for them
    ('eyes_read', P('eyes', 'eyes.json'), lambda: run([PORTRAIT_PY, os.path.join(HERE, 'eye_shapes.py'), P('portrait.png'), P('eyes')])),
    ('eyes', P('organs.blend'), lambda: blender('eye_parts.py', P('eyes', 'eyes.json'), P('face'), P('organs.blend'), blend=P('figure.blend'))),
    ('check', P('check.json'), lambda: blender('check_head.py', '--json=' + P('check.json'), blend=P('organs.blend'))),
    ('page', P('figure.txt'), lambda: open(P('figure.txt'), 'w').write(base64.b64encode(gzip.compress(open(P('organs.vrm'), 'rb').read(), 9)).decode())),
]
names = [s[0] for s in STEPS]
start = names.index(flags['from']) if flags.get('from') else 0
log('== %s from %s into %s (steps %s)' % (NAME, SRC, OUT, ', '.join(names[start:] if not flags.get('only') else [flags['only']])))
for i, (name, done, do) in enumerate(STEPS):
    if flags.get('only') and name != flags['only']: continue
    if i < start: continue
    if os.path.exists(done) and not flags.get('from') and not flags.get('only'): continue
    t = time.time(); do()
    if not os.path.exists(done):     # Blender exits 0 even when its script fails: the step's output is the proof
        log('FAILED: %s wrote no %s (its messages are above)' % (name, done)); raise SystemExit(1)
    log('%-12s %4d s' % (name, round(time.time() - t)))
log('== done: %s' % P('organs.vrm'))

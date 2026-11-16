# /// script
# requires-python = "==3.11.*"
# dependencies = ["torch>=2.4", "torchvision", "huggingface_hub>=1.0", "numpy<2"]
# ///
"""ARDY (nv-tlabs/ardy, text-to-motion) as a Hugging Face Job: its own generate.py, one run per prompt.
Reads IO_REPO (a private dataset), PROMPTS (JSON list of [name, text, seconds]), MODEL (ARDY's nickname: core, soma, ...),
ARDY_REV (the commit of the code); writes <name>.npz beside nothing else. No post-processing: ARDY's foot-contact correction is a
C++ extension, skipped here (ARDY_SKIP_MOTION_CORRECTION), so some foot sliding is the model's own."""
import json, os, subprocess, sys, time
from huggingface_hub import HfApi
t0 = time.time()
def say(*a): print('AJ %4d s' % (time.time() - t0), *a, flush=True)
os.system('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader')
os.environ['ARDY_SKIP_MOTION_CORRECTION'] = '1'
def sh(cmd, **k):
    r = subprocess.run(cmd, capture_output=True, text=True, **k)
    if r.returncode != 0: say('FAILED', ' '.join(cmd)[:120]); print((r.stdout + r.stderr)[-3000:], flush=True)
    return r
sh(['git', 'clone', '-q', 'https://github.com/nv-tlabs/ardy.git', '/tmp/ardy']); sh(['git', 'checkout', '-q', os.environ['ARDY_REV']], cwd='/tmp/ardy')
r = sh(['uv', 'pip', 'install', '--python', sys.executable, '-q', '-e', '/tmp/ardy']); say('ardy installed', r.returncode)
repo = os.environ['IO_REPO']; api = HfApi(); model = os.environ.get('MODEL', 'core')
for name, text, seconds in json.loads(os.environ['PROMPTS']):
    out = '/tmp/out/' + name
    r = sh([sys.executable, 'scripts/generate.py', text, '--model', model, '--duration', str(seconds), '--seed', '0', '--output', out, '--no-postprocess'], cwd='/tmp/ardy')
    path = out + '.npz'
    if r.returncode == 0 and os.path.exists(path):
        api.upload_file(path_or_fileobj=path, path_in_repo=name + '.npz', repo_id=repo, repo_type='dataset'); say(name, 'saved', os.path.getsize(path), 'bytes')
    else: say(name, 'no result')
say('done')

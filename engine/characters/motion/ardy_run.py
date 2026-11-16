"""Motions from ARDY for a list of prompts, as one Hugging Face Job (paid by the second from the account's credit):
python ardy_run.py <out-dir> <name>="<prompt>"[@<seconds>] ...
The results pass through a private dataset on the user's own account and are deleted from it afterwards. The account needs
access to meta-llama/Meta-Llama-3-8B-Instruct (ARDY's text encoder is built on it)."""
import json, os, shutil, sys, tempfile, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'pipeline'))
from vault import get
from huggingface_hub import HfApi, hf_hub_download
FLAVOR = 'a10g-large'                          # STRUCTURAL: a 24 GB GPU holds the 8-billion-parameter text encoder at half precision (16 GB) beside the motion model
IMAGE = 'ghcr.io/astral-sh/uv:python3.12-trixie'
REV = 'e706e27'                                # the ARDY commit read and tried (2026-11-16)
MODEL = 'core'                                 # ARDY's 27-joint skeleton, the nearest to a VRM humanoid's bones
SECONDS = 5.0                                  # ARDY's own default clip length, when a prompt gives none
LIMIT = '40m'; POLL = 10; GIVE_UP = 2700       # NUMERIC: the job's time limit, seconds between status reads, seconds before it is cancelled from here
out = sys.argv[1]; os.makedirs(out, exist_ok=True); prompts = []
for a in sys.argv[2:]:
    name, text = a.split('=', 1); text, _, sec = text.partition('@'); prompts.append([name, text, float(sec) if sec else SECONDS])
tok = get('huggingface'); api = HfApi(token=tok); me = api.whoami()['name']; repo = me + '/figure-jobs'
api.create_repo(repo, repo_type='dataset', private=True, exist_ok=True); os.chdir(HERE)
job = api.run_uv_job('ardy_job.py', image=IMAGE, flavor=FLAVOR, timeout=LIMIT, secrets={'HF_TOKEN': tok},
                     env={'IO_REPO': repo, 'PROMPTS': json.dumps(prompts), 'MODEL': MODEL, 'ARDY_REV': REV})
t = time.time(); last = None
while True:
    s = api.inspect_job(job_id=job.id).status.stage
    if s != last: print('FIG motion job %4d s %s' % (time.time() - t, s), flush=True); last = s
    if s in ('COMPLETED', 'ERROR', 'CANCELED', 'DELETED'): break
    if time.time() - t > GIVE_UP: api.cancel_job(job_id=job.id); print('FIG motion job cancelled: over its time'); break
    time.sleep(POLL)
logs = [str(l) for l in api.fetch_job_logs(job_id=job.id)]
for l in ([l for l in logs if l.startswith('AJ') or 'rror' in l][-30:] or logs[-30:]): print('FIG motion job |', l.replace(me, '<you>')[:300])
got = 0
with tempfile.TemporaryDirectory() as d:
    for name, _, _ in prompts:
        try: shutil.copy(hf_hub_download(repo, name + '.npz', repo_type='dataset', token=tok, local_dir=d), os.path.join(out, name + '.npz')); api.delete_file(name + '.npz', repo_id=repo, repo_type='dataset'); got += 1
        except Exception as e: print('FIG motion: no result for', name, type(e).__name__)
print('FIG %d of %d motions from ARDY (%s) on %s; the job ran %.1f minutes' % (got, len(prompts), MODEL, FLAVOR, (time.time() - t) / 60))

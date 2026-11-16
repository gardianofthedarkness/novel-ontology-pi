"""One cut-out picture through TRELLIS.2 as a Hugging Face Job (paid by the second from the account's pre-paid credit):
python trellis_body.py <cut-out.png> <out.glb> [<cut-out2.png> <out2.glb> ...]     (several pictures share one job: the model loads once)
The picture and the model pass through a private dataset on the user's own account; the token comes from the system's
credential store (pipeline/vault.py). The job is trellis_job.py: the microsoft/TRELLIS.2 Space's own packages and calls."""
import os, shutil, sys, tempfile, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(HERE), "pipeline"))
from vault import get
from huggingface_hub import HfApi, hf_hub_download
FLAVOR = "rtx-pro-6000"                      # STRUCTURAL: the one job GPU the Space's prebuilt packages run on (found by trying: L40S has no kernel image for them)
IMAGE = "ghcr.io/astral-sh/uv:python3.12-trixie"   # STRUCTURAL: the base image whose C++ runtime those packages need
RES, FACES = "1024", "300000"                # the Space's own defaults: its cascade resolution and its export face count
LIMIT = "40m"; POLL = 10; GIVE_UP = 2700     # NUMERIC: the job's own time limit, seconds between status reads, seconds before it is cancelled from here
pairs = list(zip(sys.argv[1::2], sys.argv[2::2])); tok = get("huggingface"); api = HfApi(token=tok); me = api.whoami()["name"]; repo = me + "/figure-jobs"
names = ["pic%d_%d" % (i, int(time.time())) for i in range(len(pairs))]
api.create_repo(repo, repo_type="dataset", private=True, exist_ok=True)
for (src, _), name in zip(pairs, names): api.upload_file(path_or_fileobj=src, path_in_repo=name + ".png", repo_id=repo, repo_type="dataset")
os.chdir(HERE)                               # the job script goes by its relative path (the job's label takes the path, and has a length limit)
job = api.run_uv_job("trellis_job.py", image=IMAGE, flavor=FLAVOR, timeout=LIMIT, secrets={"HF_TOKEN": tok},
                     env={"IO_REPO": repo, "IN_FILES": ",".join(n + ".png" for n in names), "RES": RES, "FACES": FACES})
t = time.time(); last = None
while True:
    s = api.inspect_job(job_id=job.id).status.stage
    if s != last: print("FIG body job %4d s %s" % (time.time() - t, s), flush=True); last = s
    if s in ("COMPLETED", "ERROR", "CANCELED", "DELETED"): break
    if time.time() - t > GIVE_UP: api.cancel_job(job_id=job.id); print("FIG body job cancelled: over its time"); break
    time.sleep(POLL)
if last != "COMPLETED":
    logs = [str(l) for l in api.fetch_job_logs(job_id=job.id)]
    for l in ([l for l in logs if l.startswith("TJ") or "rror" in l][-20:] or logs[-20:]): print("FIG body job |", l.replace(me, "<you>")[:260])
    raise SystemExit(1)
with tempfile.TemporaryDirectory() as d:
    for (_, dst), name in zip(pairs, names): shutil.copy(hf_hub_download(repo, name + ".glb", repo_type="dataset", token=tok, local_dir=d), dst)
for name in names:
    for f in (name + ".png", name + ".glb"): api.delete_file(f, repo_id=repo, repo_type="dataset")   # nothing of the character stays on the hub
print("FIG %d shape(s) from TRELLIS.2 on %s: %s bytes, the job ran %.1f minutes" % (len(pairs), FLAVOR, [os.path.getsize(d) for _, d in pairs], (time.time() - t) / 60))

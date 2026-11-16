"""The head bust merged onto the body before any rig, the neck as one continuous tube: every step of the raw merge in order.
python merge_raw.py <body.glb> <bust.glb> <bust-marks.json> <work-dir> <merged.glb> [--blender=<blender.exe>]
  marks   3D landmarks on the raw body (marks_raw.py)                      -> body_n.glb, whole.json, head.json
  place   the bust placed and sized on the body's own head (place_raw.py)   -> place.json
  skins   both models as closed outer skins on one grid (skin.py skin); the grid's step is the geometric mean of the two
          models' own edge lengths (place.json measures both)
  tube    the neck tube, the body cut, the bust's head region (tube_raw.py) -> body_cut.glb, bust_plain.glb, tube.glb, head_region.glb
  merge   the parts fused into one closed surface (skin.py merge5), loose pieces dropped (keep_main.py)
Writes <merged.glb> and <work-dir>/merge.json (the grid step and what each step reported)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
flags = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--")); BODY, BUST, BUSTJ, D, OUT = [a for a in sys.argv[1:] if not a.startswith("--")][:5]
BLENDER = flags.get("blender") or os.environ.get("BLENDER") or r"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"
os.makedirs(D, exist_ok=True); P = lambda n: os.path.join(D, n); said = []
TAGS = ("RAW", "MERGE", "SKIN", "NECK", "TUBE", "MERGE5", "MAIN")       # the tags the steps put before what they report
def run(cmd, proof):
    if os.path.isfile(proof): os.remove(proof)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [l for l in r.stdout.splitlines() if l.split(" ")[0] in TAGS]
    for l in lines: print("FIG raw " + l, flush=True)
    said.extend(lines)
    if r.returncode != 0 or not os.path.exists(proof): print((r.stdout + r.stderr)[-2000:]); raise SystemExit("raw merge: no %s" % proof)
py = lambda s, *a: [sys.executable, os.path.join(HERE, s)] + list(a)
bl = lambda *a: [BLENDER, "-b", "-P", os.path.join(HERE, "skin.py"), "--"] + list(a)
run(py("marks_raw.py", BODY, BUSTJ, D), P("head.json"))
run(py("place_raw.py", D, BUST, BUSTJ), P("place.json"))
pl = json.load(open(P("place.json"))); vox = "%.6f" % (pl["spacing"] * pl["bust_edge"]) ** 0.5
print("FIG raw grid step %.2f mm (body edge %.2f mm, bust edge %.2f mm)" % (float(vox) * 1000, pl["spacing"] * 1000, pl["bust_edge"] * 1000), flush=True)
run(bl("skin", P("body_n.glb"), P("body_skin.glb"), vox), P("body_skin.glb"))
run(bl("skin", BUST, P("bust_skin.glb"), vox, P("place.json")), P("bust_skin.glb"))
run(py("tube_raw.py", D, BUST, BUSTJ), P("tube.json"))
run(bl("merge5", P("body_cut.glb"), P("bust_plain.glb"), P("head_region.glb"), P("tube.glb"), P("fused.glb"), vox), P("fused.glb"))
run(py("keep_main.py", P("fused.glb"), OUT), OUT)
json.dump({"grid_m": float(vox), "body_edge_m": pl["spacing"], "bust_edge_m": pl["bust_edge"], "said": said}, open(P("merge.json"), "w"), indent=1)
print("FIG raw merge done: %s" % OUT)

"""Find a face's points in pictures (v0.7 step 4): the 68 face points of RTMW (rtmlib's whole-body model, Apache-2.0) on
each rendered view of the head and on the portrait it was made from.
usage: python face_marks.py <render-dir> [--portrait=<portrait.png>] [--min=0.3]
  Writes marks.json: per picture, the 68 points (x, y, score), how many passed --min, and the hit rate. The points follow
  the 300-W layout: 0-16 jaw contour (0 and 16 at the ears), 17-26 brows, 27-35 nose, 36-47 eyes, 48-67 mouth."""
import json, os, sys
import cv2
import numpy as np
from rtmlib import Wholebody
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
DIR = args[0]; MIN = float(flags.get('min', 0.3))
views = json.load(open(os.path.join(DIR, 'views.json')))['views']
model = Wholebody(mode='balanced', backend='onnxruntime', device='cpu')
def detect(path):
    img = cv2.imread(path)
    kps, scores = model(img)
    if len(kps) == 0: return None
    best = int(np.argmax(scores[:, 23:91].mean(1)))      # the person whose face is surest
    pts = kps[best][23:91]; sc = scores[best][23:91]
    return {'points': [[float(x), float(y), float(s)] for (x, y), s in zip(pts, sc)], 'found': int((sc >= MIN).sum()), 'mean_score': float(sc.mean()), 'size': [img.shape[1], img.shape[0]]}
out = {'min': MIN, 'views': {}}
for v in views:
    r = detect(v['file']); out['views'][str(int(v['angle']))] = r
    print('FIG view %+d: %s' % (v['angle'], 'no face' if r is None else '%d of 68 points at >= %.2f (mean %.2f)' % (r['found'], MIN, r['mean_score'])))
if flags.get('portrait'):
    r = detect(flags['portrait']); out['portrait'] = r
    print('FIG portrait: %s' % ('no face' if r is None else '%d of 68 points (mean %.2f)' % (r['found'], r['mean_score'])))
json.dump(out, open(os.path.join(DIR, 'marks.json'), 'w'), indent=1)

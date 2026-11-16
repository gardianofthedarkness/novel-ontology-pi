"""The 28 anime face points of a picture (anime-face-detector, MIT; run in the portrait tool's Python), for front mapping:
the head crop's points tie the portrait to the T-pose drawing the 3D shape was made from.
usage: python face28.py <picture.png> <out.json>"""
import json, sys
import cv2
from anime_face_detector import create_detector
img = cv2.imread(sys.argv[1])
preds = create_detector('yolov3', device='cpu')(img)
if not preds: raise SystemExit('FIG no face found in ' + sys.argv[1])
p = max(preds, key=lambda q: q['bbox'][4])
json.dump({'points28': p['keypoints'][:, :2].round(1).tolist(), 'scores': p['keypoints'][:, 2].round(3).tolist(), 'bbox': p['bbox'].round(1).tolist()}, open(sys.argv[2], 'w'))
print('FIG face points in %s: 28, mean score %.2f' % (sys.argv[1], float(p['keypoints'][:, 2].mean())))

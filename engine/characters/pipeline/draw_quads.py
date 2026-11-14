"""Draw a quad mesh's edges, front and side, coloured by region (for checking templates and fits).
usage: python draw_quads.py <mesh.obj> <out.png> [--json=<template.json>] [--marks]"""
import json, sys
import cv2
import numpy as np
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
V, F = [], []
for line in open(args[0]):
    p = line.split()
    if not p: continue
    if p[0] == 'v': V.append([float(x) for x in p[1:4]])
    elif p[0] == 'f': F.append([int(x.split('/')[0]) - 1 for x in p[1:]])
V = np.array(V); meta = json.load(open(flags['json'])) if flags.get('json') else None
COL = [(200, 200, 200), (60, 160, 255), (60, 160, 255), (80, 220, 120), (255, 200, 60), (180, 120, 255)]
S = 700
def panel(ax_x, ax_y, flip_x=1):
    img = np.full((S, S, 3), 25, np.uint8)
    lo, hi = V.min(0), V.max(0); c = (lo + hi) / 2; sc = 0.9 * S / max(hi - lo)
    P = lambda v: (int(S / 2 + flip_x * (v[ax_x] - c[ax_x]) * sc), int(S / 2 - (v[ax_y] - c[ax_y]) * sc))
    # back faces first, dimmer (depth along the remaining axis)
    depth_ax = 3 - ax_x - ax_y
    order = sorted(range(len(F)), key=lambda i: -np.mean(V[F[i], depth_ax]) * (-1 if depth_ax == 1 else 1))
    for i in order:
        f = F[i]; col = COL[meta['regions'][i]] if meta else (200, 200, 200)
        front = np.mean(V[f, depth_ax]) < c[depth_ax] if depth_ax == 1 else np.mean(V[f, depth_ax]) > c[depth_ax]
        col = col if front else tuple(int(x * 0.3) for x in col)
        pts = np.array([P(V[k]) for k in f], np.int32)
        cv2.polylines(img, [pts], True, col, 1, cv2.LINE_AA)
    if meta and 'marks' in flags:
        for name, k in meta['marks'].items():
            cv2.circle(img, P(V[k]), 4, (0, 0, 255), -1); cv2.putText(img, name, P(V[k]), 0, 0.35, (0, 0, 255), 1)
    return img
front = panel(0, 2)             # x right, z up (the head faces -y, toward the viewer)
side = panel(1, 2, flip_x=-1)    # -y right (the face on the right), z up
cv2.imwrite(args[1], np.hstack([front, side]))

"""The figure of a drawn view cut out of its paper, for a shape model that wants a see-through picture:
python cutout.py <view.png> <out.png>     (the figure is prep_view.figure_mask: everything but the paper joined to the border)"""
import os, sys
import cv2, numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from prep_view import figure_mask
im = cv2.imread(sys.argv[1]); m = figure_mask(im)[0]
cv2.imwrite(sys.argv[2], np.dstack([im, (m * 255).astype(np.uint8)]))
print("FIG cut-out: the figure is %.0f%% of the picture" % (100 * m.mean()))

"""Contact sheet of pictures with labels. usage: contact_sheet.py <out.png> <height> <cols> <image> ..."""
import sys, os
from PIL import Image, ImageDraw
out, H, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); files = sys.argv[4:]
tiles = []
for f in files:
    try: im = Image.open(f).convert('RGB')
    except Exception: continue
    im = im.resize((max(1, round(im.width * H / im.height)), H)); tiles.append((f, im))
W = max(t.width for _, t in tiles); rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (W + 6), rows * (H + 22)), (20, 20, 20)); d = ImageDraw.Draw(sheet)
for i, (f, t) in enumerate(tiles):
    x, y = (i % cols) * (W + 6), (i // cols) * (H + 22)
    sheet.paste(t, (x, y + 20)); d.text((x + 2, y + 3), f'{i}: ' + os.path.basename(os.path.dirname(f))[-14:] + '/' + os.path.basename(f), fill=(255, 220, 120))
sheet.save(out); print('saved', out, len(tiles))

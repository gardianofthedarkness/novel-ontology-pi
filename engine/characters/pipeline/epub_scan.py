"""Scan EPUBs for a character: per volume, how often the name appears, the sentences near it that name clothing, and the
illustrations placed near those passages (extracted for viewing). Reads the books as data only.
usage: python -I epub_scan.py <out-dir> <name-regex> <epub> ..."""
import json, os, posixpath, re, sys, zipfile
from html import unescape
OUT, NAME = sys.argv[1], re.compile(sys.argv[2]); os.makedirs(OUT, exist_ok=True)
CLOTH = re.compile(r'制服|校服|夏季|冬季|冬装|冬裝|夏装|夏裝|毛衣|背心|外套|大衣|西装|西裝|夹克|夾克|风衣|風衣|裙|便服|私服|睡衣|浴衣|泳装|泳裝|体操服|體操服|运动服|運動服|围巾|圍巾|手套|靴|长袜|長襪|袜|襪|衬衫|襯衫|领结|領結|和服|女仆|女僕|斗篷|披风|披風|护目镜|護目鏡|衣服|服装|服裝|打扮|穿着|穿著|换上|換上|穿上')
res = {}
for path in sys.argv[3:]:
    vol = os.path.splitext(os.path.basename(path))[0]
    try: z = zipfile.ZipFile(path)
    except Exception as e: print('skip', vol, e); continue
    names = z.namelist()
    opf = next((n for n in names if n.endswith('.opf')), None)
    if not opf: continue
    o = z.read(opf).decode('utf-8', 'ignore'); base = posixpath.dirname(opf)
    man = {m.group(1): m.group(2) for m in re.finditer(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', o)}
    man.update({m.group(2): m.group(1) for m in re.finditer(r'<item[^>]*href="([^"]+)"[^>]*id="([^"]+)"', o)})
    spine = [man[i] for i in re.findall(r'<itemref[^>]*idref="([^"]+)"', o) if i in man]
    # a flat stream of paragraphs and images in reading order
    stream = []
    for href in spine:
        fp = posixpath.normpath(posixpath.join(base, href))
        if fp not in names: continue
        h = z.read(fp).decode('utf-8', 'ignore')
        for m in re.finditer(r'<img[^>]*src="([^"]+)"|<image[^>]*href="([^"]+)"|<p[^>]*>(.*?)</p>', h, re.S):
            if m.group(1) or m.group(2):
                stream.append(('img', posixpath.normpath(posixpath.join(posixpath.dirname(fp), m.group(1) or m.group(2)))))
            else:
                t = unescape(re.sub(r'<[^>]+>', '', m.group(3))).strip()
                if t: stream.append(('p', t))
    paras = [i for i, (k, _) in enumerate(stream) if k == 'p']
    hits = [i for i in paras if NAME.search(stream[i][1])]
    cloth = []
    for i in hits:
        for j in range(max(0, i - 1), min(len(stream), i + 2)):
            k, t = stream[j]
            if k == 'p' and CLOTH.search(t) and len(cloth) < 40: cloth.append(t[:160])
    near = set()
    for i in hits:
        for j in range(max(0, i - 6), min(len(stream), i + 7)):
            if stream[j][0] == 'img': near.add(stream[j][1])
    front = [v for k, v in stream[:80] if k == 'img']           # the colour plates at the front
    vdir = os.path.join(OUT, re.sub(r'[^\w]+', '_', vol)[:40]); os.makedirs(vdir, exist_ok=True)
    saved = []
    for n, img in enumerate(sorted(near | set(front))):
        if img in names and z.getinfo(img).file_size > 30000:
            ext = os.path.splitext(img)[1]; tag = ('F' if img in front else 'N') + ('N' if img in near else '')
            fn = f'{tag}_{n:02d}{ext}'; open(os.path.join(vdir, fn), 'wb').write(z.read(img)); saved.append(fn)
    res[vol] = {'mentions': len(hits), 'images_total': sum(1 for k, _ in stream if k == 'img'), 'saved': saved, 'cloth': cloth}
    print(f'{vol[:46]:46s} mentions {len(hits):4d} cloth {len(cloth):2d} near-images {len(near):2d} saved {len(saved):2d}', flush=True)
json.dump(res, open(os.path.join(OUT, 'scan.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

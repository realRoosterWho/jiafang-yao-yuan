#!/usr/bin/env python3
"""Turn illustrations into small transparent WebP sprites and write them out as one JS object (ART_IMG).

    python tools/make_art.py <out.js> name=path:width [name=path:width ...]

    python tools/make_art.py art_img.js aLogo=title.png:1040

Each source must have a transparent background. It is cropped to its painted area, scaled to the given width
(about twice the width it is drawn at) and saved as assets/<name>.<hash>.webp (the hash makes the server's one-year
cache safe). Paste the resulting `const ART_IMG = {...};` over the one in index.html and delete the old files from
assets/. Run it from the repo root. Needs Pillow and numpy.
"""
import hashlib, io, os, sys
import numpy as np
from PIL import Image

if len(sys.argv) < 3:
    sys.exit(__doc__)
out = sys.argv[1]
L = ['const ART_IMG = {']
total = 0
for spec in sys.argv[2:]:
    name, rest = spec.split('=', 1)
    path, width = rest.rsplit(':', 1)
    im = Image.open(path).convert('RGBA')
    a = np.array(im)[..., 3]
    ys, xs = np.where(a > 10)
    im = im.crop((max(xs.min() - 3, 0), max(ys.min() - 3, 0), min(xs.max() + 4, im.width), min(ys.max() + 4, im.height)))
    w = int(width)
    im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=84, alpha_quality=90, method=6)
    data = buf.getvalue()
    total += len(data)
    fn = 'assets/%s.%s.webp' % (name, hashlib.sha256(data).hexdigest()[:10])
    os.makedirs('assets', exist_ok=True)
    open(fn, 'wb').write(data)
    L.append("  %s: '%s'," % (name, fn))
    print('%-9s %4d x %-4d %6d bytes' % (name, im.width, im.height, len(data)))
L.append('};')
io.open(out, 'w', encoding='ascii', newline='\n').write('\n'.join(L) + '\n')
print('total', total, 'bytes')

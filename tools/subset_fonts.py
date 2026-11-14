#!/usr/bin/env python3
"""Cut the two UI fonts down to what the game uses and write them out as CSS (@font-face with the font inlined as base64).

    python tools/subset_fonts.py <MaokenAssortedSans.ttf> <Chewy-Regular.ttf> [out.css]

Without the third argument it rewrites the two `@font-face` lines in index.html in place; with it, it only writes that file.

The Chinese font (Maoken Assorted Sans, SIL OFL 1.1) is 12 MB with 31,000 characters; the game uses about 1,200 of them.
This keeps only the characters that appear in index.html and flow.js (plus ASCII), so re-run it whenever new copy is added:
a character that is not in the subset falls back to the next font in the stack and looks out of place.
Chewy (Apache 2.0) is small and is kept whole. Needs fontTools (`pip install fonttools`); add `brotli` to get WOFF2 instead of WOFF.
The source .ttf files are not in the repository (the Chinese one is 12 MB); get them from the fonts' own pages.
"""
import base64, io, os, re, sys
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if os.path.basename(os.path.dirname(os.path.abspath(__file__))) == 'tools' else None


def game_chars(root):
    text = ''.join(io.open(os.path.join(root, n), encoding='utf-8').read() for n in ('index.html', 'flow.js'))
    keep = {c for c in text if ord(c) > 0x7f}
    keep |= {chr(c) for c in range(0x20, 0x7f)}
    # punctuation a player-typed name or a later line of copy is likely to bring in
    keep |= set('、。，！？：；（）《》「」“”‘’…—·×★☆')
    return ''.join(sorted(keep))


def build(path, text, flavor):
    o = subset.Options()
    o.flavor = flavor
    o.hinting = False                      # canvas and modern browsers do not need the TrueType hints; they are a third of the file
    o.layout_features = ['kern']
    o.legacy_kern = True
    o.glyph_names = False
    o.notdef_outline = True
    o.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]   # keep the copyright and licence notices in the file (the OFL asks for that)
    o.drop_tables += ['FFTM', 'vhea', 'vmtx']
    font = subset.load_font(path, o)
    s = subset.Subsetter(o)
    if text is None:
        s.populate(unicodes=list(font.getBestCmap().keys()))
    else:
        s.populate(text=text)
    s.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, o)
    return buf.getvalue(), len(font.getBestCmap())


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    maoken, chewy = sys.argv[1], sys.argv[2]
    root = ROOT or os.environ.get('YUAN_ROOT') or os.getcwd()
    out = sys.argv[3] if len(sys.argv) > 3 else None
    try:
        import brotli  # noqa: F401
        flavor = 'woff2'
    except ImportError:
        flavor = 'woff'
    css = []
    for family, path, text in (('Chewy', chewy, None), ('Maoken Assorted Sans', maoken, game_chars(root))):
        data, n = build(path, text, flavor)
        b64 = base64.b64encode(data).decode('ascii')
        # one file covers every weight: without the range the browser fakes a bold by smearing the outline
        css.append('@font-face { font-family: "%s"; font-weight: 100 900; font-display: swap; src: url(data:font/%s;base64,%s) format("%s"); }' % (family, flavor, b64, flavor))
        print('%-22s %5d characters  %7d bytes as %s  (%d as base64)' % (family, n, len(data), flavor, len(b64)))
    if out:
        io.open(out, 'w', encoding='ascii', newline='\n').write('\n'.join(css) + '\n')
        print('wrote', out)
        return
    page = os.path.join(root, 'index.html')
    html = io.open(page, encoding='utf-8', newline='').read()
    for line in css:
        family = line.split('"')[1]
        html, n = re.subn(r'(?m)^@font-face \{ font-family: "%s";[^\r\n]*' % re.escape(family), lambda m: line, html)
        if n != 1:
            sys.exit('index.html has no @font-face line for "%s" to replace; pass an output file instead' % family)
    io.open(page, 'w', encoding='utf-8', newline='').write(html)
    print('updated the two @font-face lines in', page)


if __name__ == '__main__':
    main()

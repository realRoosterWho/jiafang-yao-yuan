#!/usr/bin/env python3
"""Cut the two contract fonts (flow.js) down to the characters the contract uses and save them in assets/.

    python tools/subset_contract_fonts.py <NotoSerifSC-VariableFont_wght.ttf> <LongCang-Regular.ttf>

Noto Serif SC is the variable font from Google Fonts; it is pinned to weights 500-700 (the contract uses 500 and 700)
so one file covers both. Long Cang is the handwriting font for the signature line. Both are OFL.
Characters a player types into the name field that are not in flow.js fall back to the system Kaiti fonts.
Prints the two @font-face lines to paste into flow.js (the FONT_CSS constant). Delete the old files in assets/ by hand.
Needs fonttools and brotli. Run it from the repo root and re-run it whenever the contract text changes.
"""
import hashlib, io, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

if len(sys.argv) < 3:
    sys.exit(__doc__)
serif_path, hand_path = sys.argv[1], sys.argv[2]
# 只取合同那一段：从随机名字表（RND_ZH）到 openContract 结束（showChoice 之前），合同外的字用不到这两款字体
src = io.open('flow.js', encoding='utf-8').read()
a, b = src.index('const RND_ZH'), src.index('function showChoice')
text = src[a:b] + ''.join(chr(c) for c in range(0x20, 0x7f)) + '·—…“”‘’「」《》、。，：；！？（）0123456789年月日'
text = ''.join(sorted(set(text)))


def build(path, name, wght=None):
    font = TTFont(path, lazy=False)
    o = subset.Options()
    o.flavor = 'woff2'
    o.layout_features = ['*']
    o.name_IDs = ['*']
    o.notdef_outline = True
    s = subset.Subsetter(o)
    s.populate(text=text)
    s.subset(font)
    if wght and 'fvar' in font:   # 先裁字再收窄字重：整套两万多字做 instancer 太慢
        font = instancer.instantiateVariableFont(font, {'wght': wght})
    buf = io.BytesIO()
    subset.save_font(font, buf, o)
    data = buf.getvalue()
    fn = 'assets/%s.%s.woff2' % (name, hashlib.sha256(data).hexdigest()[:10])
    os.makedirs('assets', exist_ok=True)
    open(fn, 'wb').write(data)
    print('%-12s %7d bytes -> %s' % (name, len(data), fn), file=sys.stderr)
    return fn


serif = build(serif_path, 'notoserif', (500, 700))
hand = build(hand_path, 'longcang')
print('@font-face { font-family: "Noto Serif SC"; font-weight: 500 700; font-display: swap; src: url(%s) format("woff2"); }' % serif)
print('@font-face { font-family: "Long Cang"; font-weight: 400; font-display: swap; src: url(%s) format("woff2"); }' % hand)

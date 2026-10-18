# Usage: npm pack @fontsource/noto-serif-sc@5.3.1 && tar xzf fontsource-noto-serif-sc-5.3.1.tgz
#        pip install fonttools brotli
#        python3 scripts/subset-font.py package . 600 vendor/fonts/planet-serif-600.woff2 [extra files...]
# Build one small woff2 holding only the glyphs the planet page uses, from Fontsource's split chunks.
import glob, os, re, sys
from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

pkg, repo, weight, out_name = sys.argv[1:5]
# Extra source files (e.g. the promo overlay) can be listed after the output path.
sources = ["planet.html", "planet/main.js", "planet/state.js"] + sys.argv[5:]
text = "".join(open(os.path.join(repo, f), encoding="utf8").read() for f in sources)
text += "0123456789%·：，。！？、—…「」“”"
chars = sorted({c for c in text if ord(c) > 32})
unicodes = [ord(c) for c in chars]
tmp = os.path.join(os.path.dirname(out_name), "_parts")
os.makedirs(tmp, exist_ok=True)
parts = []
for path in sorted(glob.glob(os.path.join(pkg, "files", f"noto-serif-sc-*-{weight}-normal.woff2"))):
    font = TTFont(path)
    cmap = font.getBestCmap()
    need = [u for u in unicodes if u in cmap]
    if not need:
        continue
    opts = subset.Options()
    opts.flavor = None
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=need)
    sub.subset(font)
    font.flavor = None
    p = os.path.join(tmp, os.path.basename(path).replace(".woff2", ".otf"))
    font.save(p)
    parts.append(p)
merged = Merger().merge(parts)
merged.flavor = "woff2"
merged.save(out_name)
for p in parts:
    os.remove(p)
os.rmdir(tmp)
print(len(chars), "chars,", len(parts), "chunks ->", os.path.getsize(out_name) // 1024, "KB")

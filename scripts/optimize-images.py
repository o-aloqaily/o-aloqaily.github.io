#!/usr/bin/env python3
"""Optional helper: shrink images for the blog.

    python3 scripts/optimize-images.py path/to/image.jpg [more...]

Writes a WebP (max 1400px wide, quality 84) next to the source in static/media/.
For a .gif it instead produces .mp4 + .webp poster via ffmpeg. Requires Pillow
(pip install pillow) and ffmpeg for GIFs. The build never calls this; it is
just the recipe used for the existing assets.
"""
import os, subprocess, sys
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'media')
for src in sys.argv[1:]:
    name = os.path.splitext(os.path.basename(src))[0]
    if src.lower().endswith('.gif'):
        even = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
        subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
                               '-vf', even, '-c:v', 'libx264', '-crf', '26', '-preset', 'veryslow', f'{OUT}/{name}.mp4'])
        subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-vframes', '1', '-vf', even, f'{OUT}/{name}.webp'])
        print(f'{name}.mp4 + {name}.webp')
        continue
    im = Image.open(src)
    w, h = im.size
    if w > 1400:
        im = im.resize((1400, round(h * 1400 / w)), Image.LANCZOS)
    im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
    im.save(f'{OUT}/{name}.webp', 'WEBP', quality=84, method=6)
    print(f'{name}.webp {im.size} {os.path.getsize(f"{OUT}/{name}.webp")} bytes')

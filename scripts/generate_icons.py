"""Derive every PWA icon size from a 1024px master.

Each entry in MASTERS is one icon design: a version tag plus its master file in
assets/. Everything else in assets/ is a generated derivative, so re-run this
after replacing a master:

    python scripts/generate_icons.py           # 全部版本
    python scripts/generate_icons.py v4b       # 只生成某一版

Filenames carry the version tag. Home-screen icons are cached hard by iOS and
Android -- reusing a filename after changing the artwork leaves stale icons on
devices that already installed the app, so add a new version whenever the
artwork changes and update index.html / manifest.webmanifest / vite.config.js
to match.

现役版本是 index.html 与 manifest.webmanifest 里引用的那一版；其余版本留在
assets/ 里供 icon-lab/ 的 A/B 对比页安装到手机桌面挑选。
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

# version tag -> master artwork
MASTERS = {
    "v3": "icon-1024.png",             # 水墨山水 + 金环 ¥
    "v4a": "icon-kedu-1024.png",       # 刻度细线 + 月份数字
    "v4b": "icon-kedu-bold-1024.png",  # 刻度粗线，无数字
}

# "any" icons keep the artwork edge to edge; the launcher draws its own mask.
ANY_SIZES = [192, 512]
# Apple's home screen applies a fixed squircle mask, no extra padding needed.
APPLE_SIZE = 180
# Maskable icons may be cropped to the central 80% circle, so the artwork is
# scaled down and the gap is filled with the master's own paper colour.
MASKABLE_SIZE = 512
MASKABLE_SAFE = 0.78


def paper_colour(image):
    """Sample the corner so padding matches the artwork's own background."""
    return image.convert("RGB").getpixel((4, 4))


def resized(image, size):
    return image.resize((size, size), Image.LANCZOS)


def maskable(image, size, safe):
    canvas = Image.new("RGB", (size, size), paper_colour(image))
    inner = int(size * safe)
    offset = (size - inner) // 2
    canvas.paste(resized(image, inner), (offset, offset))
    return canvas


def save(image, name):
    path = ASSETS / name
    image.convert("RGB").save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {image.width}x{image.height}")


def build(version, master_name):
    master_path = ASSETS / master_name
    if not master_path.exists():
        raise SystemExit(f"missing master icon: {master_path}")
    master = Image.open(master_path)
    if master.width != master.height:
        raise SystemExit(f"master must be square, got {master.width}x{master.height}")
    print(f"{version}: {master_name} {master.width}x{master.height}, paper {paper_colour(master)}")

    for size in ANY_SIZES:
        save(resized(master, size), f"pwa-icon-{size}-{version}.png")
    save(resized(master, APPLE_SIZE), f"apple-touch-icon-{version}.png")
    save(maskable(master, MASKABLE_SIZE, MASKABLE_SAFE), f"pwa-icon-maskable-{MASKABLE_SIZE}-{version}.png")
    save(resized(master, 64), f"favicon-64-{version}.png")


def main():
    wanted = sys.argv[1:] or list(MASTERS)
    unknown = [v for v in wanted if v not in MASTERS]
    if unknown:
        raise SystemExit(f"unknown version(s): {', '.join(unknown)}; have {', '.join(MASTERS)}")
    for version in wanted:
        build(version, MASTERS[version])


if __name__ == "__main__":
    main()

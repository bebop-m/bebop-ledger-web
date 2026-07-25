"""Derive every PWA icon size from the single 1024px master.

Source of truth is assets/icon-1024.png. Everything else in assets/ is a
generated derivative, so re-run this after replacing the master:

    python scripts/generate_icons.py

Filenames carry a version suffix (VERSION below). Home-screen icons are cached
hard by iOS and Android -- reusing a filename after changing the artwork leaves
stale icons on devices that already installed the app, so bump VERSION whenever
the master changes and update index.html / manifest.webmanifest / vite.config.js
to match.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MASTER = ASSETS / "icon-1024.png"
VERSION = "v3"

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


def main():
    if not MASTER.exists():
        raise SystemExit(f"missing master icon: {MASTER}")
    master = Image.open(MASTER)
    if master.width != master.height:
        raise SystemExit(f"master must be square, got {master.width}x{master.height}")
    print(f"master {MASTER.name} {master.width}x{master.height}, paper {paper_colour(master)}")

    for size in ANY_SIZES:
        save(resized(master, size), f"pwa-icon-{size}-{VERSION}.png")
    save(resized(master, APPLE_SIZE), f"apple-touch-icon-{VERSION}.png")
    save(maskable(master, MASKABLE_SIZE, MASKABLE_SAFE), f"pwa-icon-maskable-{MASKABLE_SIZE}-{VERSION}.png")
    save(resized(master, 64), f"favicon-64-{VERSION}.png")


if __name__ == "__main__":
    main()

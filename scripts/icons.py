"""Derive the extension's icons from Postulo's vector mark, with Postulo's own recipe.

    uv run --project ../postulo python scripts/icons.py
    uv run --project <core> python scripts/icons.py --core <core>   # a core elsewhere

The mark lives once, in the core repository, as a vector: `assets/brand/postulo.svg`. The
core's `scripts/brand.py` serves it as `src/postulo/static/brand/logo.svg` (minified and
framed on the mark) and renders every PNG it serves from that served copy, drawn by
Chromium (postulo/postulo#1238). This does the same for the extension by importing that
script rather than keeping a second recipe that could drift from it: the served vector is
drawn once at the core's master size by `draw()`, then trimmed, fitted into each square
without being stretched, and centred by `rendered()`.

What it writes into `src/icons/`:

- **`postulo.svg`**, the core's served `logo.svg` copied byte for byte: what the extension's
  own pages show (the popup, the review window, the captures page), sharp at any zoom and
  density, and the icon of the Firefox build, whose manifest takes SVG icons.
- **The PNGs**, only where a platform needs a raster. Chromium takes no SVG in `icons` or
  `action.default_icon`, and the toolbar's grey "offline" button has to be a raster to be
  greyed, so the coloured toolbar icon is one too, for the two to be the same picture.

It finds the core in the checkout beside this one (`../postulo`), which is where the
Postulo workspace keeps it, or wherever `--core` or the `POSTULO_CORE` environment variable
says. It runs in the core's own environment (Pillow, defusedxml and Playwright are its
dependencies) and needs the browser the core's browser tests use
(`uv run --project ../postulo playwright install chromium`). It refuses a `logo.svg` the
core's `assets/brand/brand.json` does not record, so the icons are never made from a served
copy that is out of date. The icons are committed, so building the extension needs neither
Python nor the core; only changing the mark does.

Which sizes, and why:

- **16 and 32** are the toolbar button. At that size the mark needs the whole square, as the
  core's favicons do.
- **Grey 16 and 32** are the same two with the colour taken out and the weight eased, for
  the toolbar button while Postulo cannot be reached or the testing switch is on. They are
  made from the images just written, so they are the same pixels in both browsers and
  readable on a light and a dark toolbar.
- **48 and 96** are the browsers' extension pages; Firefox asks for 96 on a high-density
  screen, which is why it is here though Chromium never uses it.
- **128** is the install dialog and the Chrome Web Store, whose guidelines ask for 96 pixels of
  artwork with 16 of transparent space on each side, so it is padded to exactly that.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / "src" / "icons"

#: The core's served vector, relative to the core's checkout.
SERVED = Path("src") / "postulo" / "static" / "brand" / "logo.svg"

#: size -> padding as a fraction of the side
SIZES = {16: 0.0, 32: 0.0, 48: 0.0, 96: 0.0, 128: 0.125}

#: how much of its opacity the grey button keeps
GREY_OPACITY = 0.7

GREY_SIZES = (16, 32)


def core_recipe(core: Path):
    """The core's brand script, loaded from its checkout."""
    path = core / "scripts" / "brand.py"
    if not path.exists():
        raise SystemExit(f"The core is not checked out at {core}; the mark lives there.")
    spec = importlib.util.spec_from_file_location("postulo_brand", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "draw"):
        raise SystemExit(
            f"The core at {core} still derives its icons from the raster; it needs "
            "postulo/postulo#1238, which renders them from the vector."
        )
    return module


def served_vector(brand, core: Path) -> bytes:
    """The core's served `logo.svg`, refused unless the core's record says it built it."""
    path = core / SERVED
    data = path.read_bytes()
    recorded = json.loads(brand.MANIFEST.read_text(encoding="utf-8")).get("derived", {})
    if recorded.get(path.name) != brand.digest(data):
        raise SystemExit(
            f"{path} is not what the core's scripts/brand.py last wrote; run it in the core "
            "(`uv run python scripts/brand.py`) first."
        )
    return data


def greyed(image: Image.Image) -> Image.Image:
    """The mark without its colour, a little more transparent."""
    grey = image.convert("LA")
    luminance, alpha = grey.split()
    alpha = alpha.point(lambda value: round(value * GREY_OPACITY))
    return Image.merge("LA", (luminance, alpha)).convert("RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--core",
        type=Path,
        default=Path(os.environ.get("POSTULO_CORE") or HERE.parent / "postulo"),
        help="the core's checkout (default: $POSTULO_CORE, else ../postulo)",
    )
    core = parser.parse_args().core.resolve()
    brand = core_recipe(core)
    vector = served_vector(brand, core)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            master = brand.draw(browser, vector, brand.MASTER)
        finally:
            browser.close()

    OUT.mkdir(parents=True, exist_ok=True)
    svg = OUT / "postulo.svg"
    svg.write_bytes(vector)
    print(f"{svg.relative_to(HERE)}  vector")
    for size, padding in SIZES.items():
        target = OUT / f"postulo-{size}.png"
        brand.rendered(master, size, padding, None).save(target, format="PNG", optimize=True)
        print(f"{target.relative_to(HERE)}  {size}px")
        if size in GREY_SIZES:
            grey = OUT / f"postulo-grey-{size}.png"
            greyed(Image.open(target)).save(grey, format="PNG", optimize=True)
            print(f"{grey.relative_to(HERE)}  {size}px")
    print(f"from {core / SERVED}  sha256 {brand.digest(vector)[:16]}")


if __name__ == "__main__":
    main()

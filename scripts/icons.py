"""Derive the extension's icons from Postulo's mark, with Postulo's own recipe.

    uv run --with pillow python scripts/icons.py

The mark lives once, in the core repository at `assets/brand/postulo.png`, and the core
derives everything it serves from it with `scripts/brand.py`. This does the same for the
extension, by importing that script's `rendered()` rather than keeping a second recipe that
could drift from it: the mark is trimmed of its transparent margins, fitted into the square
without being stretched, and centred.

It reads the core from the checkout beside this one (`../postulo`), which is where the
Postulo workspace keeps it. The icons are committed, so building the extension needs neither
Python nor the core; only changing the mark does.

Which sizes, and why:

- **16 and 32** are the toolbar button. At that size the mark needs the whole square, as the
  core's favicons do.
- **48 and 96** are the browsers' extension pages; Firefox asks for 96 on a high-density
  screen, which is why it is here though Chromium never uses it.
- **128** is the install dialog and the Chrome Web Store, whose guidelines ask for 96 pixels of
  artwork with 16 of transparent space on each side, so it is padded to exactly that.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
CORE = HERE.parent / "postulo"
OUT = HERE / "src" / "icons"

#: size -> padding as a fraction of the side
SIZES = {16: 0.0, 32: 0.0, 48: 0.0, 96: 0.0, 128: 0.125}


def core_recipe():
    """The core's brand script, loaded from the sibling checkout."""
    path = CORE / "scripts" / "brand.py"
    if not path.exists():
        raise SystemExit(f"The core is not checked out at {CORE}; the mark lives there.")
    spec = importlib.util.spec_from_file_location("postulo_brand", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    brand = core_recipe()
    source = Image.open(brand.SOURCE).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for size, padding in SIZES.items():
        target = OUT / f"postulo-{size}.png"
        brand.rendered(source, size, padding, None).save(target, format="PNG", optimize=True)
        print(f"{target.relative_to(HERE)}  {size}px")
    print(f"from {brand.SOURCE}  sha256 {brand.digest(brand.SOURCE.read_bytes())[:16]}")


if __name__ == "__main__":
    main()

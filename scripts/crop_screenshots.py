#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>
# SPDX-License-Identifier: GPL-2.0-or-later
"""Copy the rendered README frames and cut the instrument close-ups.

Geometry mirrors the screenshot configs in tests/render_layouts.qml:
2560x1440 frame, Moon scale 0.45, corner widgets 300 px with a 48 px margin.
Usage: crop_screenshots.py <render dir> <docs/screenshots dir>
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

W, H = 2560, 1440
SIZE, MARGIN = 300, 48
MOON = 0.45 * min(W, H)

FRAMES = [
    "hero_combined_2k.png",
    "bg_planisphere_2k.png",
    "bg_astrolabe_2k.png",
    "minimal_moon_only_2k.png",
    "clean_no_telemetry_2k.png",
]


def dial_box(cx, cy, half_w, half_h):
    return (round(cx - half_w), round(cy - half_h), round(cx + half_w), round(cy + half_h))


def main(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for name in FRAMES:
        shutil.copyfile(src / name, dst / name)

    hero = Image.open(src / "bg_planisphere_2k.png").convert("RGB")
    half = SIZE * 0.62

    # Dial centres: each widget's shader square sits at the top of its item.
    prayer = (W - MARGIN - SIZE / 2, MARGIN + SIZE / 2)
    orbit = (MARGIN + SIZE / 2, H - MARGIN - SIZE * 1.08 + SIZE / 2)
    earth = (W - MARGIN - SIZE / 2, H - MARGIN - SIZE * 1.08 + SIZE / 2)

    crops = {
        "closeup_prayer_clock.png": (dial_box(*prayer, half, half), (364, 364)),
        "closeup_orbit.png": (dial_box(*orbit, half, half), (364, 364)),
        "closeup_earth.png": (dial_box(*earth, half, half * 374 / 364), (364, 374)),
    }
    moon_half = MOON * 0.74
    crops["closeup_moon.png"] = (dial_box(W / 2, H / 2, moon_half, moon_half), (960, 960))

    for name, (box, size) in crops.items():
        hero.crop(box).resize(size, Image.LANCZOS).save(dst / name)
        print(f"{name}: {box} -> {size}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))

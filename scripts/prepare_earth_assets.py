#!/usr/bin/env python3
"""
prepare_earth_assets.py — build the right-sized, channel-packed Earth textures
used by the observer-centred Earth globe in the KDE Plasma 6 moon-phase wallpaper.

Inputs (NASA Earth Observatory / Visible Earth, public domain):
  * Blue Marble "land surface, shallow water and shaded topography"
    2048x1024 equirectangular TIFF (the 8192x4096 product is a fallback).
  * Black Marble 2016 colour map (13500x6750 "3 km", 3600x1800 fallback).
  * Black Marble 2016 grayscale map, same grid, used as the city-light
    intensity so the night texture has a true black floor.
  * GEBCO 08 Global Topography (gebco_08_rev_elev_21600x10800.png, 0..+6400 m).
  * GEBCO 08 Global Bathymetry (gebco_08_rev_bath_21600x10800.png, -8000..0 m).

Outputs (checked in, right-sized to 1024x512 for the 230x230 corner widget):
  contents/images/earth_day.png     1024x512 RGBA
      RGB = Blue Marble surface colour
      A   = continuous bathymetric depth & hypsometric elevation:
            ocean in [148..255] (0.58 = shallow shelf, 1.00 = deep trench)
            land  in [51..122]  (0.48 = sea-level coast, 0.20 = high peaks)
  contents/images/earth_normal.png  1024x512 RGB, channel-packed:
      R = tangent-space normal X (nx) from combined NASA GEBCO topo+bathymetry
      G = tangent-space normal Y (ny) from combined NASA GEBCO topo+bathymetry
      B = Black Marble nocturnal city-light luminance (gamma-encoded, 1/1.85)
"""

from __future__ import annotations

import argparse
import hashlib
import math
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, label, median_filter

Image.MAX_IMAGE_PIXELS = 300_000_000

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "contents" / "images"
DEFAULT_CACHE_DIR = Path("/tmp/opencode/earth_assets")
PROVENANCE_PATH = REPO_ROOT / "scripts" / "earth_assets_provenance.txt"

TEX_W, TEX_H = 2048, 1024
OUT_W, OUT_H = 1024, 512

ALPHA_OCEAN = 255
ALPHA_LAND = 38

WATER_BLUE_OVER_RED = 10
ICE_MIN_BRIGHTNESS = 195
ICE_MAX_CHROMA = 45
MIN_WATER_BLOB_PX = 24
MASK_BLUR_SIGMA = 1.1
MASK_SOFT_LO, MASK_SOFT_HI = 0.30, 0.70

ARCTIC_ICE_START_LAT = 73.0
ARCTIC_ICE_FULL_LAT = 82.0

NIGHT_GAMMA = 0.72
NIGHT_GAIN = 1.25
NIGHT_GATE_BLUR = 0.55

DAY_CANDIDATES = [
    {"name": "land_shallow_topo_2048.tif",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/"
            "land_shallow_topo_2048.tif",
     "min_bytes": 1_500_000, "expect": (2048, 1024)},
    {"name": "land_shallow_topo_8192.tif",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/"
            "land_shallow_topo_8192.tif",
     "min_bytes": 20_000_000, "expect": (8192, 4096)},
]

NIGHT_COLOR_CANDIDATES = [
    {"name": "BlackMarble_2016_3km.jpg",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/"
            "BlackMarble_2016_3km.jpg",
     "min_bytes": 5_000_000, "expect": (13500, 6750)},
    {"name": "BlackMarble_2016_01deg.jpg",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/"
            "BlackMarble_2016_01deg.jpg",
     "min_bytes": 500_000, "expect": (3600, 1800)},
]

NIGHT_GRAY_CANDIDATES = [
    {"name": "BlackMarble_2016_3km_gray.jpg",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144897/"
            "BlackMarble_2016_3km_gray.jpg",
     "min_bytes": 2_000_000, "expect": (13500, 6750)},
    {"name": "BlackMarble_2016_01deg_gray.jpg",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144897/"
            "BlackMarble_2016_01deg_gray.jpg",
     "min_bytes": 200_000, "expect": (3600, 1800)},
]

ELEV_CANDIDATES = [
    {"name": "gebco_elev.png",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/"
            "gebco_08_rev_elev_21600x10800.png",
     "min_bytes": 10_000_000, "expect": (21600, 10800)},
]

BATH_CANDIDATES = [
    {"name": "gebco_bath.png",
     "url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73963/"
            "gebco_08_rev_bath_21600x10800.png",
     "min_bytes": 20_000_000, "expect": (21600, 10800)},
]


def log(msg: str = "") -> None:
    print(msg, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, min_bytes: int, force: bool) -> bool:
    if dest.exists() and not force and dest.stat().st_size >= min_bytes:
        try:
            with Image.open(dest) as im:
                im.size
        except OSError:
            log(f"  cached file is corrupt, refetching {dest.name}")
        else:
            log(f"  cached  {dest.name}  ({dest.stat().st_size / 1e6:.1f} MB)")
            return True

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": "kde-moonphase-wallpaper/1.0 (earth asset build)"}

    for attempt in range(1, 4):
        try:
            log(f"  fetch   {dest.name}  (attempt {attempt}/3)")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as fh:
                shutil.copyfileobj(resp, fh, length=1024 * 1024)
            size = tmp.stat().st_size
            if size < min_bytes:
                raise ValueError(f"short download: {size} bytes")
            with Image.open(tmp) as im:
                im.verify()
            tmp.replace(dest)
            log(f"  ok      {dest.name}  ({size / 1e6:.1f} MB)")
            return True
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log(f"  failed  {exc}")
            tmp.unlink(missing_ok=True)
            time.sleep(1.5 * attempt)

    return False


def fetch_first(candidates, cache_dir: Path, force: bool) -> tuple[Path, dict] | None:
    for cand in candidates:
        dest = cache_dir / cand["name"]
        if download(cand["url"], dest, cand["min_bytes"], force):
            return dest, cand
    return None


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.size != (TEX_W, TEX_H):
            im = im.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS)
        return np.asarray(im, dtype=np.uint8).copy()


def load_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("L")
        if im.size != (TEX_W, TEX_H):
            im = im.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS)
        return np.asarray(im, dtype=np.uint8).copy()


def binary_median(mask: np.ndarray, size: int = 5) -> np.ndarray:
    pad = size // 2
    out = np.pad(mask.astype(np.uint8), ((pad, pad), (pad, pad)), mode="edge")
    out[:, :pad] = out[:, pad:2 * pad][:, ::-1]
    out[:, -pad:] = out[:, -2 * pad:-pad][:, ::-1]
    out = median_filter(out, size=size, mode="nearest")
    return out[pad:-pad, pad:-pad].astype(bool)


def ocean_alpha(rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)

    ice = (mx >= ICE_MIN_BRIGHTNESS) & ((mx - mn) <= ICE_MAX_CHROMA)
    water = ((b - r) > WATER_BLUE_OVER_RED) & ~ice
    raw_water_fraction = float(water.mean())

    lbl, ncomp = label(water)
    if ncomp:
        sizes = np.bincount(lbl.ravel())
        sizes[0] = TEX_W * TEX_H
        tiny = sizes < MIN_WATER_BLOB_PX
        tiny[0] = False
        if tiny.any():
            water &= ~tiny[lbl]

    water = binary_median(water, 5)

    field = gaussian_filter(water.astype(np.float32), sigma=MASK_BLUR_SIGMA,
                            mode=("nearest", "wrap"))
    t = np.clip((field - MASK_SOFT_LO) / (MASK_SOFT_HI - MASK_SOFT_LO), 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    alpha = ALPHA_LAND + (ALPHA_OCEAN - ALPHA_LAND) * t

    lat = 90.0 - (np.arange(TEX_H, dtype=np.float32) + 0.5) / TEX_H * 180.0
    ramp = np.clip((ARCTIC_ICE_FULL_LAT - lat) /
                   (ARCTIC_ICE_FULL_LAT - ARCTIC_ICE_START_LAT), 0.0, 1.0)
    alpha = ALPHA_LAND + (alpha - ALPHA_LAND) * ramp[:, None]
    alpha = np.clip(np.round(alpha), ALPHA_LAND, ALPHA_OCEAN).astype(np.uint8)

    stats = {
        "raw_water_fraction": raw_water_fraction,
        "final_water_fraction": float(water.mean()),
        "ice_fraction": float(ice.mean()),
        "components": int(ncomp),
    }
    return alpha, stats


def build_normal_and_depth_alpha(
    elev_path: Path, bath_path: Path, base_ocean_alpha: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(elev_path) as im:
        im_l = im.convert("L")
        elev_2k = np.asarray(im_l.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
        elev_4k = np.asarray(im_l.resize((4096, 2048), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
        elev_hi = elev_4k - gaussian_filter(elev_4k, sigma=2.2, mode=("nearest", "wrap"))
        elev_hi_2k = np.asarray(
            Image.fromarray(elev_hi, mode="F").resize((TEX_W, TEX_H), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )

    with Image.open(bath_path) as im:
        im_l = im.convert("L")
        bath_2k = np.asarray(im_l.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
        bath_4k = np.asarray(im_l.resize((4096, 2048), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
        bath_hi = bath_4k - gaussian_filter(bath_4k, sigma=2.2, mode=("nearest", "wrap"))
        bath_hi_2k = np.asarray(
            Image.fromarray(bath_hi, mode="F").resize((TEX_W, TEX_H), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )

    orig_alpha = base_ocean_alpha.astype(np.float32) / 255.0
    is_water = orig_alpha > 0.5

    land_height = np.sqrt(np.clip(elev_2k, 0.0, 1.0)) * 7.5 + elev_hi_2k * 9.0
    ocean_depth = (bath_2k - 1.0) * 4.2 + bath_hi_2k * 5.0
    coast_step = (1.0 - orig_alpha) * 0.65
    height_field = np.where(is_water, ocean_depth, land_height) + coast_step

    h, w = height_field.shape
    px_km = (math.pi * 1737.4) / h
    gx = (np.roll(height_field, -1, axis=1) - np.roll(height_field, 1, axis=1)) * 0.5
    gy = np.gradient(height_field, axis=0, edge_order=2)

    lat = math.pi / 2.0 - (np.arange(h, dtype=np.float32) + 0.5) / h * math.pi
    cos_lat = np.cos(lat)[:, None]
    cos_safe = np.maximum(cos_lat, 0.12)
    taper = np.clip(cos_lat / 0.025, 0.0, 1.0)
    taper = taper * taper * (3.0 - 2.0 * taper)

    strength = 3.2
    slope_east = (gx / (px_km * cos_safe)) * taper
    slope_south = (gy / px_km) * taper

    nx = -strength * slope_east
    ny = +strength * slope_south
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / norm, ny / norm, nz / norm

    normal_rgb = np.stack([
        np.clip(nx * 0.5 + 0.5, 0.0, 1.0),
        np.clip(ny * 0.5 + 0.5, 0.0, 1.0),
        np.clip(nz * 0.5 + 0.5, 0.0, 1.0),
    ], axis=-1)
    normal_u8 = np.round(normal_rgb * 255.0).astype(np.uint8)

    depth_norm = np.clip(1.0 - bath_2k, 0.0, 1.0)
    elev_norm = np.clip(np.sqrt(elev_2k), 0.0, 1.0)
    new_alpha_f = np.where(is_water, 0.58 + 0.42 * depth_norm, 0.48 - 0.28 * elev_norm)
    new_alpha_u8 = np.clip(np.round(new_alpha_f * 255.0), 50, 255).astype(np.uint8)

    return normal_u8, new_alpha_u8


def build_night(color_rgb: np.ndarray, gray: np.ndarray) -> np.ndarray:
    gate = np.clip((gray.astype(np.float32) / 255.0) ** NIGHT_GAMMA * NIGHT_GAIN,
                   0.0, 1.0)
    if NIGHT_GATE_BLUR:
        gate = gaussian_filter(gate, sigma=NIGHT_GATE_BLUR, mode=("nearest", "wrap"))
    out = color_rgb.astype(np.float32) * gate[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def write_provenance(path: Path, rows: list[dict], stats: dict) -> None:
    lines = [
        "Earth day/normal+night texture provenance",
        "=========================================",
        "",
        "Generated by scripts/prepare_earth_assets.py from NASA Earth",
        "Observatory / Visible Earth products. NASA imagery is in the public",
        "domain (NASA media usage guidelines).",
        "",
        "Sources",
        "-------",
    ]
    for row in rows:
        lines += [
            f"  {row['role']}: {row['name']}",
            f"    url    : {row['url']}",
            f"    bytes  : {row['bytes']}",
            f"    sha256 : {row['sha256']}",
            f"    native : {row['expect'][0]}x{row['expect'][1]}",
        ]
    lines += [
        "",
        "Outputs",
        "-------",
        "  earth_day.png    : 1024x512 RGBA (RGB=Blue Marble, A=bathymetry/elevation)",
        "  earth_normal.png : 1024x512 RGB, channel-packed (RG=GEBCO normal, B=Black Marble city lights)",
        "",
        "Projection",
        "----------",
        "  Equirectangular 2:1. u=0 at 180 W, u=1 at 180 E, u=0.5 at 0 deg.",
        "  v=0 at the north pole, v=1 at the south pole. No column rotation.",
        "",
        f"  raw water fraction {stats['raw_water_fraction']:.4f}, "
        f"after cleaning {stats['final_water_fraction']:.4f}.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                    help="source cache (default: %(default)s)")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                    help="texture output directory (default: %(default)s)")
    ap.add_argument("--force-download", action="store_true",
                    help="re-download the NASA sources even if cached")
    ap.add_argument("--no-provenance", action="store_true",
                    help="do not write scripts/earth_assets_provenance.txt")
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    log("== NASA Earth day/normal+night asset build ==")
    day = fetch_first(DAY_CANDIDATES, args.cache_dir, args.force_download)
    night_color = fetch_first(NIGHT_COLOR_CANDIDATES, args.cache_dir, args.force_download)
    night_gray = fetch_first(NIGHT_GRAY_CANDIDATES, args.cache_dir, args.force_download)
    elev = fetch_first(ELEV_CANDIDATES, args.cache_dir, args.force_download)
    bath = fetch_first(BATH_CANDIDATES, args.cache_dir, args.force_download)
    if not all([day, night_color, night_gray, elev, bath]):
        log("ERROR: one or more NASA Earth sources could not be downloaded.")
        return 2

    day_rgb = load_rgb(day[0])
    base_alpha, mask_stats = ocean_alpha(day_rgb)
    normal_u8, depth_alpha_u8 = build_normal_and_depth_alpha(elev[0], bath[0], base_alpha)

    day_path = args.out_dir / "earth_day.png"
    day_im = Image.fromarray(np.dstack([day_rgb, depth_alpha_u8]), "RGBA").resize(
        (OUT_W, OUT_H), Image.Resampling.LANCZOS
    )
    day_im.save(day_path, "PNG", optimize=True, compress_level=9)
    log(f"  wrote {day_path.name}: {day_path.stat().st_size / 1e6:.2f} MB")

    night_rgb = build_night(load_rgb(night_color[0]), load_gray(night_gray[0]))
    night_1k = np.asarray(
        Image.fromarray(night_rgb, "RGB").resize((OUT_W, OUT_H), Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / 255.0
    city_linear = np.maximum(night_1k, 0.0) ** 1.85
    city_luma = (
        0.299 * city_linear[..., 0]
        + 0.587 * city_linear[..., 1]
        + 0.114 * city_linear[..., 2]
    )
    city_byte = np.clip(
        np.round((np.maximum(city_luma, 0.0) ** (1.0 / 1.85)) * 255.0), 0, 255
    ).astype(np.uint8)

    normal_1k = np.asarray(
        Image.fromarray(normal_u8, "RGB").resize((OUT_W, OUT_H), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )
    packed_normal = np.stack([normal_1k[..., 0], normal_1k[..., 1], city_byte], axis=-1)

    normal_path = args.out_dir / "earth_normal.png"
    Image.fromarray(packed_normal, "RGB").save(
        normal_path, "PNG", optimize=True, compress_level=9
    )
    log(f"  wrote {normal_path.name} (RG=normal, B=city_lights): "
        f"{normal_path.stat().st_size / 1e6:.2f} MB")

    if not args.no_provenance:
        rows = []
        for role, (path, cand) in (
            ("day", day),
            ("night colour", night_color),
            ("night gray", night_gray),
            ("topography", elev),
            ("bathymetry", bath),
        ):
            rows.append({
                "role": role,
                "name": cand["name"],
                "url": cand["url"],
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "expect": cand["expect"],
            })
        write_provenance(PROVENANCE_PATH, rows, mask_stats)
        log(f"  wrote {PROVENANCE_PATH}")

    log("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

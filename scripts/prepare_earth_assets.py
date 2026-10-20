#!/usr/bin/env python3
"""
prepare_earth_assets.py — build the Earth day/night textures used by the
observer-centred Earth globe in the KDE Plasma 6 moon-phase wallpaper.

Inputs (NASA Earth Observatory / Visible Earth, public domain):
  * Blue Marble "land surface, shallow water and shaded topography"
    2048x1024 equirectangular TIFF (the 8192x4096 product is a fallback).
  * Black Marble 2016 colour map (13500x6750 "3 km", 3600x1800 fallback).
  * Black Marble 2016 grayscale map, same grid, used as the city-light
    intensity so the night texture has a true black floor.

Outputs (checked in):
  contents/images/earth_day.png    2048x1024 RGBA
      RGB = Blue Marble surface colour
      A   = specular / ocean mask: 255 over water, 38 over land (~0.15)
  contents/images/earth_night.jpg  2048x1024 RGB, progressive JPEG
      city lights only, everything else black

Projection contract (shared with the Earth shader):
    u = 0.5 + atan2(N.x, N.z) / (2*PI)
    v = 0.5 - asin(N.y) / PI
so u=0 is 180 W, u=1 is 180 E, v=0 is the north pole, v=1 the south pole,
and 0 deg longitude is exactly column 1024 (u=0.5).  Both NASA products
are simple-cylindrical equirectangular maps registered that way; no roll
is applied.  Sanity check: at (u=0.5, v=0.5) the map shows the Gulf of
Guinea, Africa sits just right of centre, the Americas on the left and
Asia on the right.

Ocean mask rules (see the comments in `ocean_alpha`):
  * water = blue clearly above red (B - R > 10), i.e. deep and shallow
    ocean, lakes and inland seas;
  * permanent ice / snow (bright, near-neutral) is forced to land so
    Greenland and Antarctica cannot become giant specular highlights;
  * the NASA 2048 product is an ice-free composite whose Arctic Ocean is
    filled with ordinary open-water colour, so a latitude ramp makes the
    permanent Arctic sea-ice cap land-like as well;
  * a 5x5 median, removal of sub-24-pixel water specks and a 1.1 px
    Gaussian give clean coasts without eroding archipelagos.

Usage:
    python3 scripts/prepare_earth_assets.py
    python3 scripts/prepare_earth_assets.py --force-download
    python3 scripts/prepare_earth_assets.py --contact-sheet /tmp/sheet.png

Only Pillow, numpy and scipy are required.  Downloads are cached under
/tmp/opencode/earth_assets, so a rerun (or a rerun from a clean checkout
with network access) is reproducible.
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
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, label, median_filter

# The 13500x6750 Black Marble map is 91 MP, above Pillow's 89 MP guard.
Image.MAX_IMAGE_PIXELS = 300_000_000


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "contents" / "images"
DEFAULT_CACHE_DIR = Path("/tmp/opencode/earth_assets")
DEFAULT_PREVIEW = Path("/tmp/opencode/earth_preview/contact_sheet.png")
PROVENANCE_PATH = REPO_ROOT / "scripts" / "earth_assets_provenance.txt"

TEX_W, TEX_H = 2048, 1024

# Alpha / specular values written into earth_day.png.  The shader multiplies
# them by the sun's specular term; 255 = full water reflection, 38 = 0.149.
ALPHA_OCEAN = 255
ALPHA_LAND = 38

# Classification thresholds, in 8-bit units.
WATER_BLUE_OVER_RED = 10      # deep ocean is ~+41, vegetation/tan is negative
ICE_MIN_BRIGHTNESS = 195      # permanent ice / snow is bright ...
ICE_MAX_CHROMA = 45           # ... and nearly neutral
MIN_WATER_BLOB_PX = 24        # drop isolated sub-24 px "puddles" inside land
MASK_BLUR_SIGMA = 1.1         # px; keeps coasts tight but not aliased
MASK_SOFT_LO, MASK_SOFT_HI = 0.30, 0.70

# Arctic sea-ice correction (north only).  The source has no sea ice there.
ARCTIC_ICE_START_LAT = 73.0   # ramp begins (still open water below)
ARCTIC_ICE_FULL_LAT = 82.0    # fully land-like poleward of this

# Night-lights grade: intensity = (gray/255) ** GAMMA * GAIN, clamped.
# A sub-pixel blur turns the thresholded source dots into a light bloom.
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

# Reference points used for the automated orientation / mask checks.
OCEAN_CHECK = (-150.0, 0.0)     # mid-Pacific
LAND_CHECK = (10.0, 23.0)       # central Sahara
ICE_CHECK = (-42.0, 72.0)       # Greenland ice sheet


# --------------------------------------------------------------------------
# Download helpers
# --------------------------------------------------------------------------

def log(msg: str = "") -> None:
    print(msg, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, min_bytes: int, force: bool) -> bool:
    """Download `url` to `dest` with three attempts.

    An existing plausible file is reused unless --force-download is given.
    Downloads land in a .part file and are only renamed once Pillow can
    decode them, so an interrupted run never leaves a broken cache entry.
    """
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
            with Image.open(tmp) as im:      # validates the image header
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
    """Return (path, candidate) for the first source that downloads."""
    for cand in candidates:
        dest = cache_dir / cand["name"]
        if download(cand["url"], dest, cand["min_bytes"], force):
            return dest, cand
    return None


# --------------------------------------------------------------------------
# Image loading
# --------------------------------------------------------------------------

def load_rgb(path: Path) -> np.ndarray:
    """Load a global equirectangular source as RGB uint8 at TEX_W x TEX_H."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.size != (TEX_W, TEX_H):
            im = im.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS)
        return np.asarray(im, dtype=np.uint8).copy()


def load_gray(path: Path) -> np.ndarray:
    """Load the Black Marble grayscale intensity map at TEX_W x TEX_H."""
    with Image.open(path) as im:
        im = im.convert("L")
        if im.size != (TEX_W, TEX_H):
            im = im.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS)
        return np.asarray(im, dtype=np.uint8).copy()


def px_index(lon_deg: float, lat_deg: float) -> tuple[int, int]:
    """Pixel centre for a geographic coordinate in the equirectangular map."""
    x = int((lon_deg + 180.0) / 360.0 * TEX_W)
    y = int((90.0 - lat_deg) / 180.0 * TEX_H)
    return min(max(x, 0), TEX_W - 1), min(max(y, 0), TEX_H - 1)


def patch_stats(arr: np.ndarray, lon: float, lat: float, radius: int = 6) -> tuple[float, float]:
    x, y = px_index(lon, lat)
    patch = arr[max(0, y - radius):y + radius, max(0, x - radius):x + radius]
    return float(patch.mean()), float(np.median(patch))


# --------------------------------------------------------------------------
# Ocean / specular mask
# --------------------------------------------------------------------------

def binary_median(mask: np.ndarray, size: int = 5) -> np.ndarray:
    """Median filter with wrap-around in longitude and edge clamp in latitude."""
    pad = size // 2
    out = np.pad(mask.astype(np.uint8), ((pad, pad), (pad, pad)), mode="edge")
    out[:, :pad] = out[:, pad:2 * pad][:, ::-1]
    out[:, -pad:] = out[:, -2 * pad:-pad][:, ::-1]
    out = median_filter(out, size=size, mode="nearest")
    return out[pad:-pad, pad:-pad].astype(bool)


def ocean_alpha(rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    """Build the 8-bit specular mask from the Blue Marble colour.

    Deep water in this product is ~(10, 10, 51) and shallow water keeps
    B > R by 40+, while every land cover (vegetation, sand, rock) has
    R >= B, so `B - R > 10` is a clean, bimodal discriminator.  Snow and
    ice are bright and neutral (B - R ~ 0) and therefore land by default;
    the explicit ice term also catches white sea ice and ice shelves.
    """
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)

    ice = (mx >= ICE_MIN_BRIGHTNESS) & ((mx - mn) <= ICE_MAX_CHROMA)
    water = ((b - r) > WATER_BLUE_OVER_RED) & ~ice
    raw_water_fraction = float(water.mean())

    # Remove isolated specks: a handful of pixels of "water" inside an ice
    # sheet would otherwise become bright pin-pricks of specular.
    lbl, ncomp = label(water)
    if ncomp:
        sizes = np.bincount(lbl.ravel())
        sizes[0] = TEX_W * TEX_H
        tiny = sizes < MIN_WATER_BLOB_PX
        tiny[0] = False
        if tiny.any():
            water &= ~tiny[lbl]

    water = binary_median(water, 5)

    # Soft 1-px coast.  Gaussian wrap in x keeps the antimeridian continuous.
    field = gaussian_filter(water.astype(np.float32), sigma=MASK_BLUR_SIGMA,
                            mode=("nearest", "wrap"))
    t = np.clip((field - MASK_SOFT_LO) / (MASK_SOFT_HI - MASK_SOFT_LO), 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)                       # smoothstep
    alpha = ALPHA_LAND + (ALPHA_OCEAN - ALPHA_LAND) * t

    # Permanent Arctic sea ice.  The NASA 2048 composite has no sea ice and
    # fills the whole Arctic with ordinary ocean colour; without this ramp
    # the north pole would carry a large, obviously wrong specular cap.
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


# --------------------------------------------------------------------------
# Night lights
# --------------------------------------------------------------------------

def build_night(color_rgb: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """City lights with a true black floor.

    The colour map alone is unusable: it carries a faint blue "earthshine"
    background over every land mass.  The grayscale product of the same
    2016 composite is pure black over 96 % of the planet, so it is used as
    the intensity gate.  Multiplying the colour map by
    (gray/255)**gamma keeps the warm sodium/LED colour while turning all
    unlit land and ocean exactly black.  A 0.55 px blur on the gate turns
    the thresholded dots into a slight bloom; it never lifts the zero
    background above ~1/255.
    """
    gate = np.clip((gray.astype(np.float32) / 255.0) ** NIGHT_GAMMA * NIGHT_GAIN,
                   0.0, 1.0)
    if NIGHT_GATE_BLUR:
        gate = gaussian_filter(gate, sigma=NIGHT_GATE_BLUR, mode=("nearest", "wrap"))
    out = color_rgb.astype(np.float32) * gate[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Preview: lit sphere with terminator
# --------------------------------------------------------------------------

def sample_equirect(tex: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear sample with wrap in u and clamp in v."""
    h, w = tex.shape[:2]
    x = (u * w - 0.5) % w
    y = np.clip(v * h - 0.5, 0.0, h - 1.0)
    x0 = np.floor(x).astype(np.int32)
    x1 = (x0 + 1) % w
    y0 = np.floor(y).astype(np.int32)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    t = tex.astype(np.float32)
    top = t[y0, x0] * (1.0 - fx) + t[y0, x1] * fx
    bot = t[y1, x0] * (1.0 - fx) + t[y1, x1] * fx
    return top * (1.0 - fy) + bot * fy


def render_globe(day: np.ndarray, alpha: np.ndarray, night: np.ndarray,
                 size: int = 512, center_lon: float = 10.0,
                 sun=(0.86, 0.22, 0.46)) -> np.ndarray:
    """Orthographic preview of the globe with a soft day/night terminator.

    Uses the same spherical mapping as the shader; the sun is fixed in
    view space, so the preview shows how the mask, the albedo and the
    city lights line up along the terminator.
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    sx = (xx + 0.5) / size * 2.0 - 1.0
    sy = 1.0 - (yy + 0.5) / size * 2.0
    r2 = sx * sx + sy * sy
    inside = r2 <= 1.0
    sz = np.sqrt(np.maximum(0.0, 1.0 - r2))

    a = math.radians(center_lon)
    lon = a + np.arctan2(sx, sz)
    lat = np.arcsin(np.clip(sy, -1.0, 1.0))
    u = 0.5 + lon / (2.0 * math.pi)
    v = 0.5 - lat / math.pi

    alb = sample_equirect(day, u, v)
    msk = sample_equirect(alpha, u, v)[..., 0] / 255.0
    ngt = sample_equirect(night, u, v)

    light = np.asarray(sun, dtype=np.float32)
    light /= np.linalg.norm(light)
    ndl = sx * light[0] + sy * light[1] + sz * light[2]

    diffuse = 0.045 + 1.05 * np.clip(ndl, 0.0, 1.0)
    day_rgb = alb * diffuse[..., None]

    # Blinn-Phong sun glint, weighted by the ocean mask only.
    hv = light + np.array([0.0, 0.0, 1.0], dtype=np.float32)
    hv /= np.linalg.norm(hv)
    spec = np.clip(sx * hv[0] + sy * hv[1] + sz * hv[2], 0.0, 1.0) ** 140
    spec = (spec * msk * 0.90)[..., None]
    day_rgb = day_rgb + 255.0 * spec

    # Faint earthshine so the night side is not a black hole.
    night_rgb = ngt * 1.0 + alb * 0.013

    mix = np.clip((ndl + 0.06) / 0.16, 0.0, 1.0)
    mix = (mix * mix * (3.0 - 2.0 * mix))[..., None]
    rgb = night_rgb * (1.0 - mix) + np.clip(day_rgb, 0.0, 255.0) * mix

    bg = np.array([10, 12, 18], dtype=np.float32)
    edge = np.clip((1.0 - np.sqrt(r2)) * size * 0.9, 0.0, 1.0)[..., None]
    rgb = rgb * edge + bg * (1.0 - edge)
    rgb[~inside] = bg
    return np.clip(rgb, 0, 255).astype(np.uint8)


def make_contact_sheet(day: np.ndarray, alpha: np.ndarray, night: np.ndarray,
                       path: Path) -> None:
    """2048x1024 verification sheet: day, mask, night, two lit globes."""
    sheet = Image.new("RGB", (2048, 1024), (16, 17, 20))
    sheet.paste(Image.fromarray(day).resize((1024, 512), Image.Resampling.LANCZOS), (0, 0))
    sheet.paste(Image.fromarray(alpha).convert("RGB").resize(
        (1024, 512), Image.Resampling.LANCZOS), (1024, 0))
    # The night map is mostly black by design; show it at 2.2x gain so the
    # lights are visible on screen, and say so in the label.
    sheet.paste(Image.fromarray(
        np.clip(night.astype(np.float32) * 3.0, 0, 255).astype(np.uint8)
    ).resize((1024, 512), Image.Resampling.LANCZOS), (0, 512))
    sheet.paste(Image.fromarray(render_globe(day, alpha, night, 512, 10.0)), (1024, 512))
    sheet.paste(Image.fromarray(render_globe(day, alpha, night, 512, -60.0)), (1536, 512))

    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 19)
        small = ImageFont.truetype("DejaVuSans.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
        small = font

    def tag(x: int, y: int, text: str, w: int) -> None:
        draw.rectangle((x + 8, y + 8, x + w, y + 34), fill=(0, 0, 0))
        draw.text((x + 13, y + 11), text, fill=(238, 238, 238), font=font)

    tag(0, 0, "earth_day.png  RGB  (Blue Marble)", 330)
    tag(1024, 0, "earth_day.png  alpha = ocean/specular mask", 400)
    tag(0, 512, "earth_night.jpg  (Black Marble 2016, display x3.0)", 440)
    tag(1024, 512, "lit globe, 10 E - terminator + ocean glint", 400)
    tag(1536, 512, "lit globe, 60 W", 200)
    draw.text((12, 986),
              "2048x1024 equirectangular;  u=0 -> 180 W, u=0.5 -> 0 deg, v=0 -> north pole",
              fill=(165, 168, 175), font=small)
    draw.text((12, 1002),
              "NASA Blue Marble + Black Marble 2016 (public domain); generated by scripts/prepare_earth_assets.py",
              fill=(145, 148, 155), font=small)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", optimize=True)


# --------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------

def write_provenance(path: Path, rows: list[dict], stats: dict) -> None:
    """Deterministic provenance note (no timestamps: reruns stay identical)."""
    lines = [
        "Earth day/night texture provenance",
        "=================================",
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
        f"  earth_day.png   : 2048x1024 RGBA, alpha {ALPHA_OCEAN}=ocean, "
        f"{ALPHA_LAND}=land",
        f"  earth_night.jpg : 2048x1024 RGB, progressive JPEG",
        "",
        "Projection",
        "----------",
        "  Equirectangular 2:1. u=0 at 180 W, u=1 at 180 E, u=0.5 at 0 deg.",
        "  v=0 at the north pole, v=1 at the south pole. No column rotation.",
        "",
        "Ocean / specular mask rules",
        "---------------------------",
        "  water  = B - R > 10 (deep ocean B-R ~ +41; land is negative);",
        "  ice    = max(RGB) >= 195 and chroma <= 45 -> forced to land;",
        "  Arctic = latitude ramp 73 N .. 82 N -> land, because the 2048",
        "           Blue Marble product has no permanent sea ice and would",
        "           otherwise produce a large false specular cap;",
        "  cleaned with a 5x5 median, water blobs < 24 px removed, then a",
        "  1.1 px Gaussian; final alpha smoothstepped between 0.30 and 0.70.",
        f"  raw water fraction {stats['raw_water_fraction']:.4f}, "
        f"after cleaning {stats['final_water_fraction']:.4f}.",
        "",
        "Night lights",
        "------------",
        "  Black Marble 2016 grayscale is the intensity gate (pure black",
        "  background); the colour map supplies the tint.  intensity =",
        f"  (gray/255)**{NIGHT_GAMMA} * {NIGHT_GAIN}, clamped and blurred by",
        f"  {NIGHT_GATE_BLUR} px, so the ocean and unlit land stay at 0.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def seam_metrics(rgb: np.ndarray) -> tuple[float, float]:
    """MAE between the wrapping columns and between ordinary neighbours."""
    d = np.abs(rgb[:, 0].astype(np.int16) - rgb[:, -1].astype(np.int16))
    seam = float(d.mean())
    neigh = float(np.abs(rgb[:, 1:].astype(np.int16) -
                         rgb[:, :-1].astype(np.int16)).mean())
    return seam, neigh


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
    ap.add_argument("--contact-sheet", type=Path, default=DEFAULT_PREVIEW,
                    help="verification sheet path (default: %(default)s)")
    ap.add_argument("--no-provenance", action="store_true",
                    help="do not write scripts/earth_assets_provenance.txt")
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    log("== NASA Earth day/night asset build ==")
    log(f"   cache : {args.cache_dir}")
    log(f"   output: {args.out_dir}")

    # ---- sources ---------------------------------------------------------
    log("\n[1/5] sources")
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    day = fetch_first(DAY_CANDIDATES, args.cache_dir, args.force_download)
    if day is None:
        log("ERROR: no Blue Marble day map could be downloaded.")
        return 2

    night_color = fetch_first(NIGHT_COLOR_CANDIDATES, args.cache_dir, args.force_download)
    if night_color is None:
        log("ERROR: no Black Marble colour map could be downloaded.")
        return 2

    night_gray = fetch_first(NIGHT_GRAY_CANDIDATES, args.cache_dir, args.force_download)
    if night_gray is None:
        log("ERROR: no Black Marble grayscale map could be downloaded.")
        return 2

    # ---- day -------------------------------------------------------------
    log("\n[2/5] day albedo + ocean mask")
    day_rgb = load_rgb(day[0])
    alpha, mask_stats = ocean_alpha(day_rgb)
    log(f"  water: {mask_stats['raw_water_fraction']:.3f} raw -> "
        f"{mask_stats['final_water_fraction']:.3f} cleaned "
        f"(ice {mask_stats['ice_fraction']:.3f})")

    day_path = args.out_dir / "earth_day.png"
    Image.fromarray(np.dstack([day_rgb, alpha]), "RGBA").save(
        day_path, "PNG", optimize=True, compress_level=9)
    log(f"  wrote {day_path.name}: {day_path.stat().st_size / 1e6:.2f} MB")

    # ---- night -----------------------------------------------------------
    log("\n[3/5] night lights")
    night_rgb = build_night(load_rgb(night_color[0]), load_gray(night_gray[0]))
    night_path = args.out_dir / "earth_night.jpg"
    Image.fromarray(night_rgb, "RGB").save(
        night_path, "JPEG", quality=85, optimize=True,
        progressive=True, subsampling=0)
    log(f"  wrote {night_path.name}: {night_path.stat().st_size / 1e6:.2f} MB")

    # ---- verification ----------------------------------------------------
    log("\n[4/5] verification")
    total = day_path.stat().st_size + night_path.stat().st_size
    log(f"  earth_day.png   : {Image.open(day_path).size} "
        f"{Image.open(day_path).mode}  {day_path.stat().st_size:,} bytes")
    log(f"  earth_night.jpg : {Image.open(night_path).size} "
        f"{Image.open(night_path).mode}  {night_path.stat().st_size:,} bytes")
    log(f"  total           : {total:,} bytes ({total / 1e6:.2f} MB, limit 6 MB)")

    d_im = Image.open(day_path)
    n_im = Image.open(night_path)
    assert d_im.size == (TEX_W, TEX_H), "earth_day.png is not 2048x1024"
    assert n_im.size == (TEX_W, TEX_H), "earth_night.jpg is not 2048x1024"
    assert d_im.mode == "RGBA", f"earth_day.png mode is {d_im.mode}"
    assert n_im.mode == "RGB", f"earth_night.jpg mode is {n_im.mode}"
    assert day_path.stat().st_size <= 4 * 1024 * 1024, "earth_day.png exceeds 4 MB"
    assert total <= 6 * 1024 * 1024, "textures exceed 6 MB"
    if total > 3.5 * 1024 * 1024:
        log("  note: total is above the 3.5 MB target but inside the 6 MB limit")

    saved = np.asarray(d_im)
    saved_rgb = saved[..., :3]
    saved_a = saved[..., 3]
    saved_night = np.asarray(n_im)

    # mask proof
    for label, (lon, lat) in (("ocean mid-Pacific", OCEAN_CHECK),
                              ("land Sahara", LAND_CHECK),
                              ("ice Greenland", ICE_CHECK)):
        mean, median = patch_stats(saved_a, lon, lat)
        log(f"  alpha {label:20s} lon {lon:6.1f} lat {lat:5.1f}: "
            f"mean {mean:6.1f}  median {median:5.1f}")
    assert patch_stats(saved_a, *OCEAN_CHECK)[1] >= 250, "ocean is not specular"
    assert patch_stats(saved_a, *LAND_CHECK)[1] <= 45, "land is specular"
    assert patch_stats(saved_a, *ICE_CHECK)[1] <= 45, "ice is specular"

    # orientation proof: the RGB at u=0.5, v=0.5 is Gulf of Guinea water;
    # the Sahara sample is bright land.
    x, y = px_index(0.0, 0.0)
    log(f"  u=0.5,v=0.5 pixel (lon 0, lat 0): RGB {saved_rgb[y, x]} "
        f"alpha {saved_a[y, x]}  (Gulf of Guinea, water)")
    assert int(saved_rgb[y, x, 2]) > int(saved_rgb[y, x, 0]) + 20, \
        "map centre is not water at 0N 0E - projection/orientation is wrong"
    x, y = px_index(*LAND_CHECK)
    assert int(saved_rgb[y, x, 0]) > int(saved_rgb[y, x, 2]), \
        "Sahara sample is not land - projection/orientation is wrong"

    # wrap continuity
    seam_rgb, neigh_rgb = seam_metrics(saved_rgb)
    seam_a, neigh_a = seam_metrics(saved_a)
    seam_n, neigh_n = seam_metrics(saved_night)
    log(f"  wrap MAD  day RGB {seam_rgb:.2f} (neighbour {neigh_rgb:.2f})")
    log(f"  wrap MAD  alpha   {seam_a:.2f} (neighbour {neigh_a:.2f})")
    log(f"  wrap MAD  night   {seam_n:.2f} (neighbour {neigh_n:.2f})")

    # night floor proof
    x, y = px_index(*OCEAN_CHECK)
    log(f"  night pixel mid-Pacific: {saved_night[y, x]} (black floor)")
    assert int(saved_night[y, x].max()) == 0, "night ocean is not black"

    # ---- provenance ------------------------------------------------------
    log("\n[5/5] provenance")
    for role, (path, cand) in (("day", day), ("night colour", night_color),
                               ("night gray", night_gray)):
        log(f"  {role:12s} {cand['name']}  {path.stat().st_size:,} bytes")
        log(f"               {cand['url']}")
        log(f"               sha256 {sha256_file(path)}")

    if not args.no_provenance:
        rows = []
        for role, (path, cand) in (("day", day), ("night colour", night_color),
                                   ("night gray", night_gray)):
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

    if not args.contact_sheet.parent.exists():
        args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    make_contact_sheet(day_rgb, alpha, night_rgb, args.contact_sheet)
    log(f"  contact sheet: {args.contact_sheet}")

    log("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

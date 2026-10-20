#!/usr/bin/env python3
"""
prepare_assets.py — build the Moon textures used by the KDE Plasma 6
moon-phase wallpaper plugin.

Inputs (NASA SVS "CGI Moon Kit", public domain):
  * LROC WAC color mosaic, simple cylindrical 2:1, near side centred.
  * LOLA global elevation (ldem_16), float32 kilometres, same projection.

Outputs (checked in, exactly two files):
  contents/images/moon_albedo.jpg   2048x1024 RGB, progressive JPEG
  contents/images/moon_normal.png   2048x1024 RGB, tangent-space normal map

Projection contract shared with contents/shaders/moon.frag:
    u = 0.5 + atan2(N.x, N.z) / (2*PI)
    v = 0.5 - asin(N.y) / PI
so the maps are equirectangular 2:1, longitude increasing eastward to the
right, north pole at v=0, south pole at v=1, and 0 deg longitude (the
near-side sub-Earth meridian) at u=0.5 exactly.

The NASA simple-cylindrical products are already registered that way; no
column rotation is applied (PRIME_MERIDIAN_SHIFT_PX = 0).  This was checked
against the known positions of Mare Imbrium (16 W -> u=0.456) and Mare
Crisium (59 E -> u=0.664), both visible in the expected places.

Usage:
    python3 scripts/prepare_assets.py
    python3 scripts/prepare_assets.py --force-download
    python3 scripts/prepare_assets.py --procedural          # fallback test

Only Pillow, numpy and scipy are required.  Nothing is installed.
"""

from __future__ import annotations

import argparse
import math
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

try:
    from scipy.ndimage import gaussian_filter
except ImportError:  # pragma: no cover - scipy is present in the target env
    gaussian_filter = None


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "contents" / "images"
DEFAULT_CACHE_DIR = Path("/tmp/opencode/moon_assets")

TEX_W, TEX_H = 2048, 1024          # final texture size (2:1)
MOON_RADIUS_KM = 1737.4

# 0 deg longitude is already at u=0.5 in the NASA products.  If a future
# source is shifted, set this to the number of texels to rotate (positive
# moves features east / to the right) and the script will np.roll both the
# colour and elevation arrays by the same amount.
PRIME_MERIDIAN_SHIFT_PX = 0

# A narrow symmetric cross-fade at the antimeridian removes the residual
# 1-2 % step between u=0 and u=1 (the far-side dateline only).  The shader
# wraps u; without this, mip-mapping can turn the step into a faint line.
SEAM_FEATHER_PX = 6

# Relief exaggeration.  1.0 is physically correct; 2.2 reads well as a
# wallpaper while keeping crater rims and mare ridges believable.
RELIEF_STRENGTH = 2.2

# Below this |cos(latitude)| the east-west gradient is tapered to zero so
# the degenerate pole rows cannot produce noisy or exploding normals.
POLE_TAPER_COS = 0.020
POLE_GRADIENT_CLAMP_COS = 0.12

SVS_DIR = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720"

# Tried in order.  The first available file wins; a smaller mirror version is
# preferable to a procedural substitute.
COLOR_CANDIDATES = [
    {"name": "lroc_color_poles_4k.tif", "url": f"{SVS_DIR}/lroc_color_poles_4k.tif",
     "min_bytes": 5_000_000},
    {"name": "lroc_color_poles_2k.tif", "url": f"{SVS_DIR}/lroc_color_poles_2k.tif",
     "min_bytes": 1_500_000},
]
ELEVATION_CANDIDATES = [
    {"name": "ldem_16.tif", "url": f"{SVS_DIR}/ldem_16.tif", "min_bytes": 20_000_000},
    {"name": "ldem_4.tif", "url": f"{SVS_DIR}/ldem_4.tif", "min_bytes": 1_000_000},
]


# --------------------------------------------------------------------------
# Download / loading helpers
# --------------------------------------------------------------------------

def log(msg: str = "") -> None:
    print(msg, flush=True)


def download(url: str, dest: Path, min_bytes: int, force: bool) -> bool:
    """Download `url` to `dest`, resuming nothing (simple + deterministic).

    Returns True on success.  A file that already exists and looks complete
    is reused unless --force-download was given.  Network failures are
    reported and left to the caller, which can fall back to procedural
    elevation.
    """
    if dest.exists() and not force and dest.stat().st_size >= min_bytes:
        log(f"  cached  {dest.name}  ({dest.stat().st_size / 1e6:.1f} MB)")
        return True

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": "kde-moonphase-wallpaper/1.0 (asset build)"}

    for attempt in range(1, 4):
        try:
            log(f"  fetch   {dest.name}  (attempt {attempt}/3)")
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp, tmp.open("wb") as fh:
                shutil.copyfileobj(resp, fh, length=1024 * 1024)
            size = tmp.stat().st_size
            if size < min_bytes:
                raise ValueError(f"short download: {size} bytes")
            with tmp.open("rb") as fh:
                head = fh.read(4)
            if head not in (b"II*\x00", b"MM\x00*"):
                raise ValueError("downloaded file is not a TIFF")
            tmp.replace(dest)
            log(f"  ok      {dest.name}  ({size / 1e6:.1f} MB)")
            return True
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log(f"  failed  {exc}")
            tmp.unlink(missing_ok=True)
            time.sleep(1.5 * attempt)

    return False


def fetch_first(candidates, cache_dir: Path, force: bool) -> Path | None:
    """Return the first candidate that downloads successfully."""
    for cand in candidates:
        dest = cache_dir / cand["name"]
        if download(cand["url"], dest, cand["min_bytes"], force):
            return dest
    return None


def feather_horizontal_seam(arr, n: int = SEAM_FEATHER_PX):
    """Smooth the wrap join between column 0 and column -1.

    The first and last n columns are cross-faded symmetrically, weighted
    towards the seam.  Column 0 and column -1 become identical, while the
    transition into the untouched interior is continuous.  The band is only
    ~0.6 % of the map width and sits at the 180 deg dateline.
    """
    if n <= 0:
        return arr
    n = min(n, arr.shape[1] // 2)
    out = arr.astype(np.float32, copy=True)
    left = arr[:, :n].astype(np.float32)
    right = arr[:, -n:][:, ::-1].astype(np.float32)   # -1, -2, ... -n
    t = (1.0 - (np.arange(n, dtype=np.float32) + 0.5) / n) * 0.5  # 0.5 .. ~0
    if arr.ndim == 3:
        t = t[None, :, None]
    else:
        t = t[None, :]
    out[:, :n] = (1.0 - t) * left + t * right
    out[:, -n:] = ((1.0 - t) * right + t * left)[:, ::-1]
    if arr.dtype == np.uint8:
        return np.clip(np.round(out), 0, 255).astype(np.uint8)
    return out


def load_color(path: Path) -> Image.Image:
    """Load the LROC colour mosaic and lightly grade it.

    The mosaic is a nearly neutral grey (mean saturation ~5%).  A small
    contrast and colour boost keeps the subtle warm highlands / cool maria
    without inventing colour.
    """
    with Image.open(path) as im:
        im = im.convert("RGB")
        im = im.resize((TEX_W, TEX_H), Image.Resampling.LANCZOS)
    im = ImageEnhance.Contrast(im).enhance(1.06)
    im = ImageEnhance.Color(im).enhance(1.35)
    return im


def load_elevation(path: Path) -> np.ndarray:
    """Load an LOLA displacement TIFF as float32 kilometres, at texture size."""
    with Image.open(path) as im:
        if im.mode not in ("F", "I", "I;16", "I;16B", "L"):
            im = im.convert("F")
        arr = np.asarray(im, dtype=np.float32)
        if arr.ndim == 3:
            arr = arr[..., 0]
        # Resize in float space so we do not quantise the 16-bit/float source.
        arr = np.asarray(
            Image.fromarray(arr, mode="F").resize(
                (TEX_W, TEX_H), Image.Resampling.LANCZOS
            ),
            dtype=np.float32,
        )

    if not np.isfinite(arr).all():
        raise ValueError("elevation map contains NaN/Inf")
    if float(arr.max() - arr.min()) <= 0.0:
        raise ValueError("elevation map is flat")

    # ldem_16 is kilometres.  Be forgiving if a mirror ships metres.
    if float(np.percentile(np.abs(arr), 99)) > 100.0:
        arr = arr / 1000.0
    return arr


# --------------------------------------------------------------------------
# Procedural fallback (only used when NASA elevation cannot be fetched)
# --------------------------------------------------------------------------

def procedural_elevation(width: int, height: int, seed: int = 20261019) -> np.ndarray:
    """Plausible cratered lunar elevation in kilometres, wrap-safe in u.

    This is a documented fallback, not a substitute for LOLA data.  It adds
    multi-scale noise plus a power-law population of craters; every crater is
    stamped three times (x-W, x, x+W) so the u=0/u=1 seam stays continuous.
    """
    rng = np.random.default_rng(seed)
    lat = (0.5 - (np.arange(height, dtype=np.float32) + 0.5) / height) * math.pi
    lon = ((np.arange(width, dtype=np.float32) + 0.5) / width - 0.5) * 2 * math.pi
    lat2 = lat[:, None]
    lon2 = lon[None, :]

    # --- fractal base -----------------------------------------------------
    base = np.zeros((height, width), dtype=np.float32)
    # Smooth noise generated at low resolution then tiled/bilinear-upscaled.
    for scale, amp in ((2, 1.30), (4, 0.75), (8, 0.42), (16, 0.22), (32, 0.11)):
        sw, sh = max(4, scale * 2), max(2, scale)
        small = rng.standard_normal((sh, sw)).astype(np.float32)
        small = np.pad(small, ((0, 0), (1, 1)), mode="wrap")
        small = gaussian_filter(small, sigma=1.0, mode="wrap") if gaussian_filter else small
        small = small[:, 1:-1]
        up = np.asarray(
            Image.fromarray(small, mode="F").resize((width, height), Image.Resampling.BICUBIC),
            dtype=np.float32,
        )
        base += amp * up

    # Flatten the maria a little near the near side (lon ~ 0) to echo the
    # real Moon's bimodal hypsometry.  Purely cosmetic.
    near = np.exp(-(lon2 / 1.15) ** 2) * np.cos(lat2) ** 2
    base = base * (1.0 - 0.35 * near) - 1.1 * near
    base = 1.9 * base / (np.std(base) + 1e-6)

    # --- craters ----------------------------------------------------------
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    # Work in degrees for distance so craters stay circular on the map.
    deg_per_px_x = 360.0 / width
    deg_per_px_y = 180.0 / height
    n_craters = 900
    radii = 1.2 * (rng.random(n_craters) ** -0.75)       # 1.2 .. ~200 deg
    radii = np.clip(radii, 0.5, 26.0)
    clon = rng.uniform(-180.0, 180.0, n_craters)
    clat = np.degrees(np.arcsin(rng.uniform(-1.0, 1.0, n_craters)))
    depths = 0.35 * radii ** 0.85

    # Coarse grid of candidate craters: only stamp locally to stay fast.
    for clon_i, clat_i, r_i, d_i in zip(clon, clat, radii, depths):
        x0 = int((clon_i + 180.0) / 360.0 * width)
        y0 = int((90.0 - clat_i) / 180.0 * height)
        # 1.6x the rim radius keeps the whole raised rim inside the stamp;
        # clipping it at ~1.0x would leave visible rectangular seams.
        rx = int(r_i / deg_per_px_x * 1.6) + 4
        ry = int(r_i / deg_per_px_y * 1.6) + 4
        if ry <= 0 or rx <= 0:
            continue
        ys = np.arange(max(0, y0 - ry), min(height, y0 + ry + 1))
        xs = np.arange(x0 - rx, x0 + rx + 1)
        if ys.size == 0:
            continue
        dx = ((xs[None, :] - (x0 + 0.5)) * deg_per_px_x)
        dy = ((ys[:, None] - (y0 + 0.5)) * deg_per_px_y)
        # Mild latitude squeeze so high-latitude craters are not stretched.
        dx = dx / max(0.25, math.cos(math.radians(clat_i)))
        r = np.sqrt(dx * dx + dy * dy) / r_i
        bowl = np.where(r < 1.0, -d_i * (1.0 - r * r), 0.0)
        rim = 0.30 * d_i * np.exp(-(((r - 1.0) / 0.22) ** 2))
        profile = (bowl + rim).astype(np.float32)
        # Wrap in x; clamp in y.
        for shift in (-width, 0, width):
            xs_shift = xs + shift
            valid = (xs_shift >= 0) & (xs_shift < width)
            if not valid.any():
                continue
            base[np.ix_(ys, xs_shift[valid])] += profile[:, valid]

    # Keep the relief in a lunar-like range (~-9..+11 km) even if several
    # large craters happen to overlap.
    base -= np.median(base)
    p = float(np.percentile(np.abs(base), 99.8)) + 1e-6
    if p > 8.0:
        base *= 8.0 / p
    return base.astype(np.float32)


# --------------------------------------------------------------------------
# Texture generation
# --------------------------------------------------------------------------

def normal_from_elevation(elev_km: np.ndarray, strength: float = RELIEF_STRENGTH) -> np.ndarray:
    """Convert an equirectangular height field to an OpenGL tangent normal map.

    Local axes: +x east (increasing u), +y north/up (decreasing v/image row),
    +z out of the surface.  Image rows increase southward, so:

        N = normalize(-k * dH/d(east), +k * dH/d(south->north), 1)

    which is exactly the requested `(-dH/du, -dH/dv_image, 1)` after the
    documented dv sign flip.  The calculation is done in physical kilometres
    per texel, so it is independent of texture resolution.
    """
    h, w = elev_km.shape
    if (w, h) != (TEX_W, TEX_H):
        raise ValueError(f"unexpected elevation size {w}x{h}")

    # Metres per texel.  Pixels are square at the equator: 2*pi*R/W == pi*R/H.
    px_km = (math.pi * MOON_RADIUS_KM) / h

    # Central differences; wrap in longitude so the u=0/u=1 seam is smooth.
    gx = (np.roll(elev_km, -1, axis=1) - np.roll(elev_km, 1, axis=1)) * 0.5
    gy = np.gradient(elev_km, axis=0, edge_order=2)   # dH / d(row), southward

    lat = math.pi / 2.0 - (np.arange(h, dtype=np.float32) + 0.5) / h * math.pi
    cos_lat = np.cos(lat)[:, None]

    # East-west physical distance shrinks with cos(lat).  Clamp so the
    # gradient cannot explode, then taper to zero at the degenerate poles.
    cos_safe = np.maximum(cos_lat, POLE_GRADIENT_CLAMP_COS)
    taper = np.clip(cos_lat / POLE_TAPER_COS, 0.0, 1.0)
    taper = taper * taper * (3.0 - 2.0 * taper)      # smoothstep

    slope_east = (gx / (px_km * cos_safe)) * taper
    slope_south = (gy / px_km) * taper

    nx = -strength * slope_east
    ny = +strength * slope_south
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / norm, ny / norm, nz / norm

    if not (np.isfinite(nx).all() and np.isfinite(ny).all() and np.isfinite(nz).all()):
        raise ValueError("non-finite normal vector generated")

    rgb = np.stack(
        [
            np.clip(nx * 0.5 + 0.5, 0.0, 1.0),
            np.clip(ny * 0.5 + 0.5, 0.0, 1.0),
            np.clip(nz * 0.5 + 0.5, 0.0, 1.0),
        ],
        axis=-1,
    )
    return np.round(rgb * 255.0).astype(np.uint8)


# --------------------------------------------------------------------------
# Verification / preview
# --------------------------------------------------------------------------

def seam_metric(rgb: np.ndarray, trim_rows: int = 0) -> float:
    """Mean absolute difference between the first and last columns."""
    a = rgb[trim_rows: rgb.shape[0] - trim_rows] if trim_rows else rgb
    return float(np.abs(a[:, 0].astype(np.int16) - a[:, -1].astype(np.int16)).mean())


def neighbor_metric(rgb: np.ndarray, trim_rows: int = 0) -> float:
    """Typical mean absolute difference between adjacent columns.

    Used to judge the seam: a normal map is high-frequency, so a raw seam
    value is only meaningful relative to an ordinary column transition.
    """
    a = rgb[trim_rows: rgb.shape[0] - trim_rows] if trim_rows else rgb
    d = np.abs(a[:, 1:].astype(np.int16) - a[:, :-1].astype(np.int16))
    return float(d.mean())


def shaded_equirect(albedo: np.ndarray, normal: np.ndarray,
                    light=(-0.45, 0.55, 0.70)) -> np.ndarray:
    """Lambert preview of the textures in map space (not a sphere)."""
    n = normal.astype(np.float32) / 255.0 * 2.0 - 1.0
    l = np.asarray(light, dtype=np.float32)
    l /= np.linalg.norm(l)
    shade = np.clip(n[..., 0] * l[0] + n[..., 1] * l[1] + n[..., 2] * l[2], 0, 1)
    out = albedo.astype(np.float32) * (0.12 + 0.95 * shade[..., None])
    return np.clip(out, 0, 255).astype(np.uint8)


def render_sphere(albedo: np.ndarray, normal: np.ndarray, size: int,
                  lon_offset_deg: float = 0.0, lat_offset_deg: float = 0.0) -> np.ndarray:
    """Orthographic sphere preview using the shader's own UV mapping.

    This exists only to eyeball orientation and relief.  It samples the two
    outputs exactly as moon.frag does and builds a tangent frame from the
    equirectangular parameterisation.
    """
    h, w = albedo.shape[:2]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    sx = (xx + 0.5) / size * 2.0 - 1.0
    sy = 1.0 - (yy + 0.5) / size * 2.0
    r2 = sx * sx + sy * sy
    mask = r2 <= 1.0
    sz = np.sqrt(np.maximum(0.0, 1.0 - r2))

    # Model normal from screen normal: rotate screen -> model by -offset.
    a = math.radians(lon_offset_deg)
    ca, sa = math.cos(a), math.sin(a)
    mx = ca * sx - sa * sz
    my = sy
    mz = sa * sx + ca * sz

    b = math.radians(lat_offset_deg)
    cb, sb = math.cos(b), math.sin(b)
    my2 = cb * my - sb * mz
    mz2 = sb * my + cb * mz
    my, mz = my2, mz2

    lon = np.arctan2(mx, mz)
    lat = np.arcsin(np.clip(my, -1.0, 1.0))
    u = 0.5 + lon / (2.0 * math.pi)
    v = 0.5 - lat / math.pi

    # Bilinear sampling with wrap in u.
    x = (u * w - 0.5) % w
    y = np.clip(v * h - 0.5, 0.0, h - 1.0)
    x0 = np.floor(x).astype(np.int32) % w
    x1 = (x0 + 1) % w
    y0 = np.floor(y).astype(np.int32)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]

    def sample(tex):
        t = tex.astype(np.float32)
        top = t[y0, x0] * (1 - fx) + t[y0, x1] * fx
        bot = t[y1, x0] * (1 - fx) + t[y1, x1] * fx
        return top * (1 - fy) + bot * fy

    alb = sample(albedo)
    nmap = sample(normal) / 255.0 * 2.0 - 1.0

    clat = np.cos(lat)
    # Tangent frame: east, north, outward.
    tx, ty, tz = np.cos(lon), np.zeros_like(lon), -np.sin(lon)
    bx = -np.sin(lat) * np.sin(lon)
    by = clat
    bz = -np.sin(lat) * np.cos(lon)
    nx = clat * np.sin(lon)
    ny = np.sin(lat)
    nz = clat * np.cos(lon)

    px = tx * nmap[..., 0] + bx * nmap[..., 1] + nx * nmap[..., 2]
    py = ty * nmap[..., 0] + by * nmap[..., 1] + ny * nmap[..., 2]
    pz = tz * nmap[..., 0] + bz * nmap[..., 1] + nz * nmap[..., 2]

    # Light fixed in screen space, converted to model space.
    lx, ly, lz = -0.55, 0.40, 0.73
    lx, ly, lz = ca * lx - sa * lz, ly, sa * lx + ca * lz
    ly, lz = cb * ly - sb * lz, sb * ly + cb * lz
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / ln, ly / ln, lz / ln

    ndotl = np.clip(px * lx + py * ly + pz * lz, 0.0, 1.0)
    rim = np.clip(1.0 - sz, 0.0, 1.0) ** 3
    light = 0.075 + 1.05 * ndotl + 0.03 * rim

    rgb = alb * light[..., None]
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    rgb[~mask] = 8
    return rgb


def make_contact_sheet(albedo: np.ndarray, normal: np.ndarray, path: Path) -> None:
    """Write a 2048x1024 verification sheet: albedo, normal, 4 sphere views."""
    sheet = Image.new("RGB", (2048, 1024), (16, 16, 18))
    sheet.paste(Image.fromarray(albedo), (0, 0))
    sheet.paste(Image.fromarray(normal), (1024, 0))
    for i, lon in enumerate((0.0, 90.0, 180.0, 270.0)):
        sphere = render_sphere(albedo, normal, 512, lon_offset_deg=lon)
        sheet.paste(Image.fromarray(sphere), (i * 512, 512))

    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 20)
        small = ImageFont.truetype("DejaVuSans.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
        small = font

    draw.rectangle((8, 8, 330, 40), fill=(0, 0, 0))
    draw.text((14, 12), "moon_albedo.jpg  2048x1024", fill=(240, 240, 240), font=font)
    draw.rectangle((1032, 8, 1400, 40), fill=(0, 0, 0))
    draw.text((1038, 12), "moon_normal.png  2048x1024", fill=(240, 240, 240), font=font)
    for i, (lon, label) in enumerate(
        ((0, "near side 0 deg"), (90, "east limb 90 deg"),
         (180, "far side 180 deg"), (270, "west limb 270 deg"))
    ):
        draw.rectangle((i * 512 + 8, 520, i * 512 + 220, 546), fill=(0, 0, 0))
        draw.text((i * 512 + 14, 524), label, fill=(235, 235, 235), font=small)
    draw.text((12, 1000), "NASA LRO/LROC CGI Moon Kit -> equirectangular tangent normal",
              fill=(170, 170, 170), font=small)
    sheet.save(path, "PNG", optimize=True)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                    help="where the NASA TIFFs live (default: %(default)s)")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                    help="texture output directory (default: %(default)s)")
    ap.add_argument("--force-download", action="store_true",
                    help="re-download the NASA TIFFs even if cached")
    ap.add_argument("--procedural", action="store_true",
                    help="force the procedural elevation fallback (testing)")
    ap.add_argument("--contact-sheet", type=Path,
                    default=Path("/tmp/opencode/moon_assets_contact_sheet.png"),
                    help="verification sheet path (default: %(default)s)")
    ap.add_argument("--strength", type=float, default=RELIEF_STRENGTH,
                    help="normal-map relief exaggeration (default: %(default)s)")
    args = ap.parse_args()

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    log("== NASA CGI Moon Kit asset build ==")
    log(f"   cache : {args.cache_dir}")
    log(f"   output: {out_dir}")

    # ---- sources ---------------------------------------------------------
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    log("\n[1/4] sources")
    color_path = fetch_first(COLOR_CANDIDATES, args.cache_dir, args.force_download)
    if color_path is None:
        log("ERROR: could not obtain the LROC colour mosaic.")
        log("       The albedo has no safe procedural substitute; aborting.")
        return 2

    elev_path = None
    if args.procedural:
        log("  forced procedural elevation (--procedural)")
    else:
        elev_path = fetch_first(ELEVATION_CANDIDATES, args.cache_dir,
                                args.force_download)
        if elev_path is None:
            log("  WARNING: LOLA elevation unavailable -> procedural fallback")

    # ---- colour ----------------------------------------------------------
    log("\n[2/4] albedo")
    albedo_img = load_color(color_path)
    albedo_arr = np.asarray(albedo_img, dtype=np.uint8)
    if PRIME_MERIDIAN_SHIFT_PX:
        albedo_arr = np.roll(albedo_arr, PRIME_MERIDIAN_SHIFT_PX, axis=1)
        log(f"  rotated colour map by {PRIME_MERIDIAN_SHIFT_PX} px for prime meridian")
    raw_alb_seam = seam_metric(albedo_arr)
    albedo_arr = feather_horizontal_seam(albedo_arr)
    albedo_img = Image.fromarray(albedo_arr, mode="RGB")

    albedo_path = out_dir / "moon_albedo.jpg"
    albedo_img.save(albedo_path, "JPEG", quality=88, optimize=True,
                    progressive=True, subsampling=0)
    log(f"  wrote {albedo_path.name}: {albedo_path.stat().st_size / 1e6:.2f} MB")

    # ---- elevation / normals --------------------------------------------
    log("\n[3/4] normal map")
    if elev_path is not None:
        elev_km = load_elevation(elev_path)
        source_note = f"NASA LOLA {elev_path.name} (float32 km)"
    else:
        elev_km = procedural_elevation(TEX_W, TEX_H)
        source_note = "PROCEDURAL fallback (no NASA elevation)"
    log(f"  elevation source: {source_note}")
    log(f"  elevation range : {elev_km.min():+.2f} .. {elev_km.max():+.2f} km")
    if PRIME_MERIDIAN_SHIFT_PX:
        elev_km = np.roll(elev_km, PRIME_MERIDIAN_SHIFT_PX, axis=1)
    elev_km = feather_horizontal_seam(elev_km)
    log(f"  seam feather    : {SEAM_FEATHER_PX} px at u=0/1 (dateline)")

    normal_arr = normal_from_elevation(elev_km, strength=args.strength)
    normal_path = out_dir / "moon_normal.png"
    Image.fromarray(normal_arr, mode="RGB").save(normal_path, "PNG", optimize=True)
    log(f"  wrote {normal_path.name}: {normal_path.stat().st_size / 1e6:.2f} MB")

    # ---- verification ----------------------------------------------------
    log("\n[4/4] verification")
    total_bytes = albedo_path.stat().st_size + normal_path.stat().st_size
    a_im = Image.open(albedo_path)
    n_im = Image.open(normal_path)
    log(f"  albedo : {a_im.width}x{a_im.height} {a_im.mode}  "
        f"{albedo_path.stat().st_size / 1e6:.2f} MB")
    log(f"  normal : {n_im.width}x{n_im.height} {n_im.mode}  "
        f"{normal_path.stat().st_size / 1e6:.2f} MB")
    log(f"  total  : {total_bytes / 1e6:.2f} MB  (limit 12 MB)")

    assert a_im.width == 2 * a_im.height, "albedo is not 2:1"
    assert n_im.width == 2 * n_im.height, "normal map is not 2:1"
    assert total_bytes < 12 * 1024 * 1024, "textures exceed 12 MB"

    alb_seam = seam_metric(np.asarray(Image.open(albedo_path).convert("RGB")))
    nrm_saved = np.asarray(Image.open(normal_path).convert("RGB"))
    nrm_seam = seam_metric(nrm_saved, trim_rows=2)
    alb_neighbor = neighbor_metric(np.asarray(Image.open(albedo_path).convert("RGB")))
    nrm_neighbor = neighbor_metric(nrm_saved, trim_rows=2)
    log(f"  seam MAD (u=0 vs u=1), albedo source   : {raw_alb_seam:.2f} / 255")
    log(f"  seam MAD (u=0 vs u=1), albedo JPEG     : {alb_seam:.2f} / 255"
        f"  (neighbour MAD {alb_neighbor:.2f}, ratio {alb_seam / max(alb_neighbor, 1e-6):.2f})")
    log(f"  seam MAD (u=0 vs u=1), normal PNG      : {nrm_seam:.2f} / 255"
        f"  (neighbour MAD {nrm_neighbor:.2f}, ratio {nrm_seam / max(nrm_neighbor, 1e-6):.2f})")
    log("  (normal: 2 pole rows trimmed; a ratio <= 1 means the join is")
    log("   no sharper than an ordinary adjacent-column transition)")
    log("  prime meridian: NASA simple-cylindrical registration, 0 deg at u=0.5")
    log("                  (no roll applied; Imbrium u~0.456, Crisium u~0.664)")

    if not args.contact_sheet.parent.exists():
        args.contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    make_contact_sheet(albedo_arr, normal_arr, args.contact_sheet)
    log(f"  contact sheet: {args.contact_sheet}")

    log("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Asset build scripts

Two reproducible Python 3 scripts generate every raster texture in
`contents/images/`. Raw upstream data is cached outside the repository, in
`/tmp/opencode/moon_assets/` and `/tmp/opencode/earth_assets/`, so the
package never contains multi-megabyte TIFFs.

## Moon — `prepare_assets.py`

```bash
python3 scripts/prepare_assets.py
python3 scripts/prepare_assets.py --force-download      # re-fetch NASA TIFFs
python3 scripts/prepare_assets.py --procedural          # test the fallback
```

Output (single channel-packed texture):

| file | size | channels |
| --- | --- | --- |
| `contents/images/moon_normal.png` | 2048×1024 RGB | R = normal X, G = normal Y, B = albedo luminance |

Normal Z is reconstructed analytically in `contents/shaders/moon.frag` as
`sqrt(1 - nx² - ny²)`, so it does not need to be stored. The shader reads the
albedo from the B channel and tints it slightly (`1.0207, 0.9998, 0.9411`) to
restore the Moon's warm grey. This replaces the earlier two-file layout
(`moon_albedo.jpg` + RGB normal map): one 3.82 MB texture instead of two,
saving both package size and VRAM.

### Sources (public domain)

- NASA SVS **CGI Moon Kit**, <https://svs.gsfc.nasa.gov/4720>
  - `lroc_color_poles_4k.tif` — LROC WAC color mosaic, 4096×2048
  - `ldem_16.tif` — LOLA global elevation, float32 kilometres, 5760×2880
- If the 4K color or 16 ppd elevation file is unavailable, the script tries
  the 2K color / 4 ppd elevation mirrors. If no elevation file can be
  fetched at all it generates a documented procedural crater field instead
  (clearly reported as `PROCEDURAL fallback` in the log).

Exact URLs, SHA-256 checksums and the current output checksum are recorded in
[`moon_assets_provenance.txt`](moon_assets_provenance.txt).

### Projection contract

Both maps are simple-cylindrical (equirectangular) 2:1, matching the shader:

```glsl
u = 0.5 + atan(N.x, N.z) / (2*PI);   // eastward to the right
v = 0.5 - asin(N.y) / PI;            // north pole at v=0
```

- 0° longitude (the near-side sub-Earth meridian) is at **u = 0.5**. NASA's
  CGI Moon Kit products are already registered this way, so
  `PRIME_MERIDIAN_SHIFT_PX = 0`. This is checked against Mare Imbrium
  (16°W → u ≈ 0.456) and Mare Crisium (59°E → u ≈ 0.664).
- The texture is the **near side centred**, with the far side split across
  the u=0/1 seam.
- Tangent-space normal: **+R = east**, **+G = north/up**, **+B = out** when
  stored unpacked. The elevation gradient is computed in physical km per
  texel, with a `1/cos(lat)` clamp at high latitude and a smooth taper to
  flat normals at the degenerate poles.
- Relief is baked at strength 2.2× physical; the shader's
  `CraterReliefStrength` setting multiplies it further (default 1.2).

### Seam handling

A 6-pixel symmetric cross-fade is applied at the 180° dateline (u=0/1) to
both the albedo and the elevation before the normal is derived. This removes
the residual 1–2 % step in the NASA mosaic and keeps mip-mapping from
drawing a faint line. The join is verified against the typical
adjacent-column difference:

```text
albedo (B): seam 0.58 / 255, neighbour 4.71  (ratio 0.12)
normal (G): seam 0.54 / 255, neighbour 5.12  (ratio 0.11)
normal (R): seam 10.75 / 255, neighbour 9.19 (ratio 1.17)
packed RGB: seam 3.96 / 255, neighbour 6.34  (ratio 0.62)
```

A ratio near or below 1 means the wrap join is no sharper than an ordinary
column-to-column transition. The normal R channel is naturally
high-frequency, so its raw seam value is larger; the ratio is the meaningful
number.

### Verification

The script prints dimensions, mode, file size, the seam metrics above, and
writes a contact sheet to:

```text
/tmp/opencode/moon_assets_contact_sheet.png
```

It shows the color source albedo, the actual packed texture, and four
orthographic sphere previews (near side, east limb, far side, west limb)
rendered through the same equirectangular UV mapping and tangent frame as
the shader. The contact sheet is a build artifact and is never checked in.

### Dependencies

Python 3 with `pillow`, `numpy` and `scipy` (for the procedural fallback and
Gaussian noise). Nothing is installed by the script.

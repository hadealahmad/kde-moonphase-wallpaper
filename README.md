# Moon Phase Wallpaper for KDE Plasma 6

A live, physically based rendering of the Moon on the Plasma desktop. The
current phase is computed from a Jean Meeus ephemeris, then drawn by a GLSL
fragment shader on a real LRO albedo + normal-mapped sphere.

- Real lunar ephemeris (Meeus ch. 47/48), not a 29.53-day modulo.
- Optical libration in longitude and latitude — the Moon visibly wobbles.
- Lommel-Seeliger / Lambert regolith BRDF with a soft terminator.
- Earthshine on the unlit side, crater relief from an LRO elevation-derived
  tangent-space normal map.
- Cached offscreen layer: the shader only re-runs when the phase, settings or
  size change — not while windows are dragged around.
- Bottom-left heliocentric orbit widget: elapsed-year arc, Jan 1 marker,
  seasonal ghost Earths, and a tilted live Earth.
- Bottom-right observer-centered Earth globe: day/night terminator, city
  lights, ocean glint, atmosphere rim, and an observer pin.
- Settings: size, background, relief, earthshine, southern-hemisphere flip,
  telemetry overlay, update interval, corner widget size/margin, observer
  latitude/longitude, and a manual phase / day-of-year / UTC-time preview.

## Requirements

- Plasma 6 / Qt 6 (tested with Plasma 6.8 and Qt 6.12)
- `kpackagetool6`
- For rebuilding assets/shader only: Python 3 with Pillow, NumPy, SciPy and
  Qt's `qsb` (usually `/usr/lib64/qt6/bin/qsb`)

## Install

```bash
make install
```

Then right-click the desktop → **Configure Desktop and Wallpaper…** →
choose **Moon Phase** → **Apply**.

To remove:

```bash
kpackagetool6 --type Plasma/Wallpaper --remove org.kde.plasma.moonphase
```

## Development

```bash
make            # bake contents/shaders/*.frag.qsb
make test       # ephemeris + Earth/orbit unit tests (Node, no Qt)
make preview    # render the four principal moon phases
make preview-full # render the full wallpaper at four seasonal checkpoints
make smoke      # shader smoke test with procedural textures
```

`make preview` needs a working OpenGL context; it uses `xvfb-run` because
`QT_QPA_PLATFORM=offscreen` cannot create one on every system. The result is
a `contact_sheet.png` plus one PNG per phase.

Regenerate the textures (downloads NASA CGI Moon Kit data into
`/tmp/opencode/moon_assets`):

```bash
python3 scripts/prepare_assets.py --force-download
```

## Layout

```text
metadata.json                     Plasma 6 wallpaper package
contents/code/astronomy.js        dependency-free Meeus ephemeris + Earth/orbit state
contents/config/main.xml          KConfigXT schema
contents/images/                  Moon albedo/normal + Earth day/night maps (2:1)
contents/shaders/moon.frag        GLSL 440 shader (source)
contents/shaders/orbit.frag       procedural orbit & seasons shader
contents/shaders/earth.frag       observer-centered Earth globe shader
contents/shaders/*.frag.qsb       baked shader packs
contents/ui/config.qml            Kirigami settings page
contents/ui/main.qml              WallpaperItem integration
contents/ui/OrbitWidget.qml       bottom-left orbit & seasons component
contents/ui/EarthWidget.qml       bottom-right Earth globe component
tests/                            ephemeris, shader and visual tests
```

## Notes

- The maps are equirectangular 2:1 with the near-side prime meridian at
  `u = 0.5` and north at the top.
- Southern-hemisphere flip rotates the rendered disk by 180°.
- `DebugTimeOverrideEnabled` / `DebugPhaseValue` let you scrub the phase from
  the settings dialog; when disabled the timer follows the real clock.

## License

GPL-2.0-or-later. Lunar textures derive from NASA LRO public-domain data.

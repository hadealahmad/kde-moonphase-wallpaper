# Moon Phase & Celestial Astrolabe Wallpaper for KDE Plasma 6

A live, physically based astronomical desktop wallpaper for **KDE Plasma 6** (`io.github.hadealahmad.moonphase`). It combines a real-time Jean Meeus lunar and solar ephemeris engine with five custom GLSL 440 fragment shaders and NASA elevation/bathymetry datasets to turn the desktop into a cohesive celestial observatory.

![Moon Phase & Celestial Astrolabe Wallpaper — 2K Full Overview](docs/screenshots/hero_combined_2k.png)

---

## 1. Visual Components & Features

### Center: Physically Based 3D Moon (`main.qml` + `moon.frag`)

![Center 3D Moon with Sharp Ticked Bezel & Curved Telemetry](docs/screenshots/closeup_moon.png)

- **Jean Meeus Ephemeris (Ch. 47/48):** True lunar phase angle, illuminated fraction, synodic age, selenocentric sun direction, and **optical libration** in longitude and latitude (the Moon visibly wobbles across the month).
- **Channel-Packed LRO Elevation & Albedo (`moon_normal.png`):** Uses a single `2048×1024` channel-packed equirectangular map (`R = Normal X`, `G = Normal Y`, `B = Lunar Albedo Luminance`, with `Normal Z` reconstructed analytically in `moon.frag`) derived from NASA's Lunar Reconnaissance Orbiter (LRO) CGI Moon Kit (`ldem_16.tif` / `ldem_4.tif` + `lroc_color_poles_4k.tif` / `lroc_color_poles_2k.tif`).
- **Hapke / Lommel-Seeliger + Lambert Regolith BRDF:** Soft solar terminator with realistic limb brightening, micro-shadowing across crater rims, and configurable **Earthshine** illuminating the night hemisphere.
- **Render-and-Evict VRAM Caching:** Renders the Moon into a `ShaderEffectSource` FBO (`moonCache`), locks the snapshot, and evicts the `2048×1024` source texture from RAM and VRAM during the 15-minute idle interval between ephemeris updates.
- **Invariant Centering & Curved Hijri Telemetry Arcs (`CurvedText.qml` + `hijri.js`):** The lunar disc is locked to `anchors.centerIn: parent` so toggling captions never shifts the Moon. Its lower curved caption blends the live lunar state with the Arabic Hijri date (`WANING GIBBOUS • 61.9% • DAY 9.0 • الأحد 14`), while a mirrored top arc carries the Hijri month and year (`جمادى الأولى 1448 هـ`). Arabic words are shaped as whole items and laid out in bidi-aware visual order instead of being split per glyph, so the script stays connected and legible around the curve. The Umm al-Qura calendar table covers 1356–1500 AH with a tabular fallback outside that range.

---

### Full-Screen Backdrop: Switchable Celestial Planisphere & Engraved Seasonal Etchings (`BackgroundWidget.qml` + `background.frag`)

- **Razor-Sharp Screen-Space Anti-Aliased Geometry:** Uses `fwidth(r)` screen-space derivatives (`crispStroke`) for 1-pixel anti-aliased concentric coordinate rings, 72/120-tick lunar bezel graduation marks, and constellation lines with zero Gaussian blur.
- **Smart FBO Caching:** Caches the full-screen backdrop in an offscreen FBO (`layer.enabled: root.shaderActive && !root.animate`) only when static, and renders directly to the scene graph without allocating a 15–33 MB full-screen FBO when animated.
- **Mid-Vertical Constellation Placement:** Seasonal zodiac and major constellations (Orion, Cygnus, Cassiopeia, Leo) are scaled and positioned in the vertical mid-band (`y ∈ [0.36, 0.64]`) so they never collide with the corner instruments.
- **Three User-Switchable Styles (`SeasonalBackgroundStyle`):**

#### Style 0 — Star Chart (Planisphere & Constellations)
![Background Style 0 — Star Chart & Planisphere](docs/screenshots/bg_planisphere_2k.png)

#### Style 1 — Seasonal Wireframe Etchings (Astrolabe)
![Background Style 1 — Seasonal Wireframe Etchings](docs/screenshots/bg_astrolabe_2k.png)

#### Style 2 — Combined (Star Chart + Seasonal Etchings)
![Background Style 2 — Combined Star Chart + Etchings](docs/screenshots/hero_combined_2k.png)

---

### Corner Instruments

| Top-Right: Dual-Ring Prayer Times Clock | Bottom-Left: Solar Orbit & Seasons | Bottom-Right: Topographic Earth Globe |
| :---: | :---: | :---: |
| ![Prayer Clock Close-Up](docs/screenshots/closeup_prayer_clock.png) | ![Orbit Close-Up](docs/screenshots/closeup_orbit.png) | ![Earth Close-Up](docs/screenshots/closeup_earth.png) |

#### Bottom-Left: Flat Top-Down Heliocentric Astrolabe Orbit (`OrbitWidget.qml` + `orbit.frag`)
- **Top-Down Ecliptic Planisphere:** Circular astrolabe plate with degree ticks, cardinal equinox/solstice crosshairs (`MAR`, `JUN`, `SEP`, `DEC`), an inner `JAN 1` anchor pin, and a central solar emblem.
- **Live Heliocentric Progress & Curved Telemetry:** Swept golden arc from `Jan 1` counter-clockwise to the current day of the year, four hollow equinox/solstice station rings, a glowing active Earth reticle, and a curved bottom telemetry arc (`AUTUMN • DAY 292 / 365 • 79.7%`).

#### Bottom-Right: Topographic & Bathymetric Observer-Centered Earth Globe (`EarthWidget.qml` + `earth.frag`)
- **Lunar-Matched Lithographic Aesthetic:** Styled to match the Moon's muted monochrome/slate palette using right-sized `1024×512` textures (`earth_day.png` and channel-packed `earth_normal.png`) with Render-and-Evict VRAM caching.
- **Real NASA GEBCO 08 Topography, Bathymetry & Black Marble Relief:**
  - `earth_normal.png` (`1024×512 RGB`) packs tangent-space surface normals (`RG`) computed from merged land elevation (`gebco_08_rev_elev`) and ocean floor bathymetry (`gebco_08_rev_bath`) together with nocturnal city-light luminance (`B`, `BlackMarble_2016`).
  - `earth_day.png` (`1024×512 RGBA`) encodes muted land/ocean albedo in `RGB` and continuous bathymetric depth (`[0.58..1.00]`) + land elevation (`[0.20..0.48]`) in `Alpha`.
- **Physically Based Day/Night Shading & Curved Telemetry:** Uses the same Lommel-Seeliger + Lambertian diffuse model as the Moon, casting relief shadows across mountain ranges (Himalayas, Andes) and mid-ocean ridges near the solar terminator, plus warm nocturnal city lights, polar ice caps, an observer reticle pin, and a curved telemetry arc (`30.0°N, 31.2°E • SOLAR 21:04`) seated cleanly outside the globe's circumference (`r = 0.560 * width`).

#### Top-Right: Dual-Ring Analogue Prayer Times Astrolabe Clock (`PrayerClockWidget.qml` + `prayer_clock.frag` + `prayer.js`)
- **Concentric 12-Hour Rings:**
  - **Inner Ring (`R = 0.245`):** First 12 hours of the day (`00:00 – 12:00`, AM cycle).
  - **Outer Ring (`R = 0.365`):** Second 12 hours of the day (`12:00 – 24:00`, PM cycle).
- **Day/Night + Active/Inactive Color Hierarchy:**
  - **Day Arcs (`Sunrise → 12:00` on inner, `12:00 → Maghrib` on outer):** Solar Yellow (`vec3(0.98, 0.85, 0.45)`).
  - **Night Arcs (`00:00 → Sunrise` on inner, `Maghrib → 24:00` on outer):** Crisp White (`vec3(0.96, 0.98, 1.00)`).
  - **Active Ring (`AM = Inner`, `PM = Outer`):** Full popping opacity (`~0.84`) + swept elapsed-hours arc from `00:00`/`12:00` clockwise to the current time.
  - **Inactive Ring:** Retains the exact same **Solar Yellow** (day) and **Crisp White** (night) colors as the active ring, differentiated by true Porter-Duff premultiplied transparency (`alpha ~ 0.48`).
- **Dual-Ring Clock Hands:**
  - **Hour Indicator:** Glowing white astrolabe bead + precision reticle riding directly on the active ring (`R_inner` in AM, `R_outer` in PM).
  - **Minute Vernier Runner:** Diamond indicator riding in the mid-channel (`R_mid = 0.305`) between the two rings, with its radial pointer spike directed inward toward the inner ring in AM and outward toward the outer ring in PM.
- **Prayer Time Nodes, Vector Astronomical Glyphs & Curved Telemetry:**
  - Plots **Fajr** (dawn rays), **Sunrise** (horizon half-sun), **Dhuhr** (zenith sun), **Asr** (45° shadow sun), **Maghrib** (setting half-sun), and **Isha** (crescent moon + star) radially offset from their respective 12-hour rings, highlighting the next upcoming prayer with a target ring and curved countdown caption (`FAJR 04:32 (-07:29) • 21:02`).
- **Hybrid AlAdhan API + Offline Solar Zenith Engine:**
  - Fetches daily timings from the free AlAdhan REST API (`https://api.aladhan.com/v1/timings/...`) once per day per location/method, and falls back seamlessly to deterministic Meeus solar-zenith math offline across 7 calculation methods (**MWL**, **Umm al-Qura**, **Egyptian**, **ISNA**, **Diyanet**, **Karachi**, **Tehran**) and both **Standard** and **Hanafi** Asr schools.

---

### Layout & Telemetry Variations

#### Minimalist Mode — Corner Instruments Disabled
![Minimalist Mode — Corner Instruments Disabled](docs/screenshots/minimal_moon_only_2k.png)

#### Pure Instrument Dials — Curved Telemetry Captions Disabled
![Pure Instrument Dials — Curved Telemetry Captions Disabled](docs/screenshots/clean_no_telemetry_2k.png)

---

### Settings Dialog (`config.qml`)

![Wallpaper Settings Dialog](docs/screenshots/settings_ui.png)

- **Your Location:** One-click **City Preset** dropdown (23 world cities across both hemispheres + `Custom Coordinates`) that automatically fills Latitude/Longitude and toggles Southern Hemisphere orientation when `Latitude < 0°`.
- **Center Moon & Labels:** Percentage sliders for Moon size, Crater depth, and Dark-side glow, plus a single toggle for all curved info captions (`ShowTelemetryOverlay`).
- **Background & Star Chart:** Unified style selector (`Star Chart`, `Seasonal Wireframe Etchings`, `Combined`, `Solid Color Only`) with progressive disclosure that hides inactive controls.
- **Corner Instruments:** Each instrument's sub-options are grouped directly under its toggle and automatically hide when that instrument is unchecked.
- **Time-Travel Sandbox & Advanced:** Collapsible simulation mode with an inline warning banner, one-click `Return to Live Time` action, hemisphere-aware season readout, and dual `Local Solar · UTC` time readout.

---

## 2. Software Map & Repository Structure

```text
kde-moonphase-wallpaper/
├── metadata.json                        # KDE Plasma 6 KPackage manifest (io.github.hadealahmad.moonphase)
├── LICENSE                              # GPL-2.0 license text
├── Makefile                             # Shader baking (qsb), unit tests, headless previews, install, package
├── README.md                            # Architecture & usage documentation
├── docs/
│   └── screenshots/                     # 2K (2560×1440) showcase screenshots & instrument close-ups
├── contents/
│   ├── code/
│   │   ├── astronomy.js                 # .pragma library: Meeus lunar & heliocentric Earth ephemeris
│   │   ├── hijri.js                     # .pragma library: Umm al-Qura Hijri conversion + Arabic labels
│   │   └── prayer.js                    # .pragma library: Solar-zenith prayer calculator + AlAdhan API cache
│   ├── config/
│   │   └── main.xml                     # KConfigXT schema for all user-configurable settings
│   ├── images/
│   │   ├── moon_normal.png              # 2048×1024 RGB : Channel-packed NASA LRO normal (RG) + albedo luma (B)
│   │   ├── earth_day.png                # 1024×512 RGBA : Muted Earth albedo (RGB) + GEBCO depth/elev (A)
│   │   └── earth_normal.png             # 1024×512 RGB  : Channel-packed GEBCO normal (RG) + Black Marble lights (B)
│   ├── shaders/
│   │   ├── background.frag   (.qsb)     # Full-screen planisphere star chart & seasonal etchings shader
│   │   ├── moon.frag         (.qsb)     # Center 3D Moon sphere shader (Lommel-Seeliger + LRO normals)
│   │   ├── orbit.frag        (.qsb)     # Bottom-left flat top-down heliocentric astrolabe orbit shader
│   │   ├── earth.frag        (.qsb)     # Bottom-right topographic/bathymetric Earth globe shader
│   │   └── prayer_clock.frag (.qsb)     # Top-right dual-ring analogue prayer times clock shader
│   └── ui/
│       ├── main.qml                     # Root WallpaperItem: timers, ephemeris wiring, center Moon
│       ├── config.qml                   # Redesigned 5-section Kirigami.FormLayout settings UI
│       ├── CurvedText.qml               # Reusable bidi-aware circular arc telemetry (top/bottom, Latin + Arabic)
│       ├── BackgroundWidget.qml         # Full-screen seasonal background ShaderEffect wrapper
│       ├── OrbitWidget.qml              # Bottom-left astrolabe orbit ShaderEffect + curved telemetry
│       ├── EarthWidget.qml              # Bottom-right Earth globe ShaderEffect + curved telemetry
│       └── PrayerClockWidget.qml        # Top-right prayer clock ShaderEffect + vector symbol Canvas
├── scripts/
│   ├── prepare_assets.py                # Downloads & bakes channel-packed NASA LRO Moon normal+albedo texture
│   ├── prepare_earth_assets.py          # Downloads & bakes 1024×512 NASA BlueMarble/BlackMarble/GEBCO Earth maps
│   └── earth_assets_provenance.txt      # SHA-256 provenance of all 5 NASA source datasets
└── tests/
    ├── test_astronomy.mjs               # Node unit tests for lunar phase, libration, and syzygies (9 tests)
    ├── test_earth_orbit.mjs             # Node unit tests for solar declination, EoT, seasons (18 tests)
    ├── test_hijri.mjs                   # Node unit tests for Umm al-Qura conversion & Arabic labels (14 tests)
    ├── test_prayer.mjs                  # Node unit tests for prayer zenith math & AlAdhan parser (13 tests)
    ├── shader_smoke.qml                 # Headless OpenGL smoke test for all 5 shaders + procedural maps
    ├── preview.qml                      # Headless renderer for the 4 principal lunar phases
    └── render_full_wallpaper.qml        # Headless 1920×1080 renderer across all 4 seasons
```

---

## 3. Data Flow & Runtime Architecture

```mermaid
graph TD
    subgraph Timers["Event-Driven Timers (main.qml)"]
        T15["refreshTimer (default 15 min)"]
        T30["prayerClockTimer (30 sec)"]
        CFG["KConfigXT (contents/config/main.xml & config.qml)"]
    end

    subgraph Ephemeris["Pure ES5 Ephemeris Engines"]
        AST["astronomy.js::getMoonState(date, lat, lon)"]
        ORB["astronomy.js::getEarthAndOrbitState(date, lat, lon)"]
        HIJ["hijri.js::getHijriDate(date) -> Umm al-Qura + Arabic labels"]
        PRY["prayer.js::getPrayerState(date, lat, lon, method, school)"]
        API["prayer.js::fetchPrayerTimesAsync() -> AlAdhan REST API (1x/day)"]
    end

    subgraph Widgets["Cached QtQuick Scene Graph Widgets (Render-and-Evict + Smart FBO)"]
        BG["BackgroundWidget.qml -> background.frag.qsb"]
        MN["Center Moon ShaderEffectSource -> moon.frag.qsb + CurvedText.qml (top & bottom arcs)"]
        OR["OrbitWidget.qml (Bottom-Left) -> orbit.frag.qsb + CurvedText.qml"]
        EA["EarthWidget.qml (Bottom-Right) -> earth.frag.qsb + CurvedText.qml"]
        PC["PrayerClockWidget.qml (Top-Right) -> prayer_clock.frag.qsb + CurvedText.qml"]
    end

    T15 --> AST
    T15 --> ORB
    T15 --> HIJ
    T15 --> PRY
    T30 --> PRY
    CFG --> AST
    CFG --> ORB
    CFG --> PRY
    API -. "Daily cache override" .-> PRY

    AST --> BG
    ORB --> BG
    AST --> MN
    HIJ --> MN
    ORB --> OR
    ORB --> EA
    PRY --> PC
```

---

## 4. Runtime & Build Requirements

### Runtime Dependencies (End-User Desktop)
- **OS / Desktop:** Linux with **KDE Plasma 6** (`plasmashell >= 6.0`, tested on Plasma 6.8 / Qt 6.12)
- **Qt 6 Modules:**
  - `QtQuick` (`qml6`)
  - `org.kde.plasma.plasmoid` (`WallpaperItem`)
  - `org.kde.kirigami` (`Kirigami.FormLayout`, `Kirigami.InlineMessage`, `Kirigami.Theme`)
  - `QtQuick.Controls` (`Slider`, `CheckBox`, `ComboBox`, `SpinBox`, `DoubleSpinBox`)
- **Installer Tool:** `kpackagetool6` (from `kpackage` / `kf6-kpackage`)
- **Graphics:** OpenGL / Vulkan / Metal via Qt 6 RHI (all `.frag.qsb` packages pre-bake GLSL 100 ES, GLSL 120, GLSL 150+, HLSL 50, and MSL 12)

### Development & Asset-Regeneration Dependencies (Optional)
- **Shader Compiler:** `/usr/lib64/qt6/bin/qsb` (from `qt6-shadertools` / `qt6-shadertools-devel`)
- **Unit Test Runner:** `node` (Node.js >= 18) for `make test`
- **Headless Visual Tests:** `xvfb-run` + `qml6` + `python3` (`Pillow`) for `make smoke`, `make preview`, and `make preview-full`
- **NASA Texture Baker Scripts (`scripts/prepare_*.py`):** `python3` with `numpy`, `scipy`, `Pillow`, and `tifffile`

---

## 5. Installation, Live Reload & Development Commands

```bash
# Install or upgrade the wallpaper into ~/.local/share/plasma/wallpapers/io.github.hadealahmad.moonphase
make install

# Recompile all 5 GLSL 440 shaders into .qsb packages
make shader

# Run all 54 unit tests (ephemeris + orbit + Hijri + prayer times)
make test

# Build the KDE Store upload archive in build/
make package

# Run headless OpenGL smoke test across all 5 shaders
make smoke

# Render 4 full 1920x1080 seasonal desktop previews into /tmp/opencode/full_wallpaper/
make preview-full
```

### Publishing to the KDE Store

`make package` produces `build/io.github.hadealahmad.moonphase-1.0.0.tar.gz`, which contains the KPackage root (`metadata.json`), the license, and the prebuilt `contents/` tree. Upload that file to a **Plasma 6 → Wallpaper Plugins** product on [store.kde.org](https://store.kde.org/product/add); the category is what System Settings → *Wallpaper* → *Get New Wallpapers…* downloads from. Use `GPL-2.0-or-later` as the store license and link the repository as the source code.

Always test the generated archive before uploading:

```bash
rm -rf /tmp/wp-test
XDG_DATA_HOME=/tmp/wp-test kpackagetool6 --type Plasma/Wallpaper \
  --install build/io.github.hadealahmad.moonphase-1.0.0.tar.gz
```

---

## 6. Credits, Data Sources & Attributions

All scientific textures, elevation models, astronomical algorithms, and external services used in this wallpaper are credited below:

### Lunar Surface & Elevation Map (`moon_normal.png`)
- **Source:** [NASA Scientific Visualization Studio (SVS) — CGI Moon Kit (SVS #4720)](https://svs.gsfc.nasa.gov/4720)
- **Credits:** Ernie Wright (USRA / NASA Goddard Space Flight Center), Lunar Reconnaissance Orbiter Camera (**LROC** Wide Angle Camera color mosaic, Arizona State University), and Lunar Orbiter Laser Altimeter (**LOLA** `ldem_16` / `ldem_4` global elevation model, NASA GSFC).
- **License:** Public Domain (NASA Media Usage Guidelines).

### Earth Surface, Topography, Bathymetry & Night Lights (`earth_day.png`, `earth_normal.png`)
Exact SHA-256 checksums and source URLs for all five upstream Earth datasets are recorded in [`scripts/earth_assets_provenance.txt`](scripts/earth_assets_provenance.txt):
- **Blue Marble Next Generation (`land_shallow_topo_2048.tif`):** [NASA Visible Earth — Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/images/57752/blue-marble-land-surface-shallow-water-and-shaded-topography) — Credit: Reto Stöckli, NASA Earth Observatory (Public Domain).
- **Black Marble Nighttime Lights (`BlackMarble_2016_3km.jpg`):** [NASA Visible Earth — Earth at Night (Black Marble 2016)](https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps) — Credit: NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC (Public Domain).
- **Global Land Topography (`gebco_08_rev_elev_21600x10800.png`):** [NASA Visible Earth — Topography](https://visibleearth.nasa.gov/images/73934/topography) — Credit: Jesse Allen, NASA Earth Observatory, using data from the **General Bathymetric Chart of the Oceans (GEBCO)** produced by the British Oceanographic Data Centre (Public Domain).
- **Global Ocean Bathymetry (`gebco_08_rev_bath_21600x10800.png`):** [NASA Visible Earth — Bathymetry](https://visibleearth.nasa.gov/images/73963/bathymetry) — Credit: Jesse Allen, NASA Earth Observatory, using **GEBCO_08** global relief data (Public Domain).

### Astronomical & Mathematical References (`astronomy.js`, `hijri.js`, `prayer.js`)
- **Lunar & Solar Ephemeris (`contents/code/astronomy.js`):** Implemented from **Jean Meeus**, *Astronomical Algorithms* (2nd Edition, Willmann-Bell, 1998) — Chapters 22, 25, 47, 48, and 53 (solar coordinates, equation of time, lunar position, phase angle, illuminated fraction, and optical libration in longitude and latitude).
- **Hijri Calendar (`contents/code/hijri.js`):** Gregorian conversion follows Meeus chapter 7 (Julian Day numbers). The month-length table is the **Umm al-Qura** calendar (1356–1500 AH) adopted by the King Abdulaziz City for Science and Technology (KACST), as distributed with the MIT-licensed [moment-hijri](https://github.com/xsoh/moment-hijri) library by Suhail Alkowaileet. Dates outside the table fall back to the tabular (Kuwaiti) Islamic calendar. Anchor dates verified against the AlAdhan `gToH` conversion service.
- **Prayer Time Solar-Zenith Equations & Live API (`contents/code/prayer.js`):**
  - Live daily timings (when enabled) are fetched from the free, open [**AlAdhan Prayer Times REST API**](https://aladhan.com/prayer-times-api) by [Islamic Network](https://islamic.network/).
  - Offline solar-zenith calculation uses standard astronomical twilight/shadow formulas across MWL, ISNA, Umm al-Qura, Egyptian General Authority, Diyanet, Karachi, and Tehran conventions.

---

## License

Source code and shaders are licensed under **GPL-2.0-or-later** (`SPDX-License-Identifier: GPL-2.0-or-later`); the full license text is in [`LICENSE`](LICENSE). NASA LRO, Blue Marble, Black Marble, and GEBCO imagery products are in the public domain under [NASA Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

# macOS licensing and attribution

## Application source

Original project: **Hadi Alahmad**, Copyright 2026, <hade.alahmad1@gmail.com>, [KDE Moonphase Wallpaper](https://github.com/hadealahmad/kde-moonphase-wallpaper). Windows host: **Muhannad Al-Ahmad**, Copyright 2026. macOS host (`mac/`): ported from the Windows host, under the same license. All of it is **GPL-2.0-or-later** (the root `LICENSE`, shipped in the app as `Moonphase-LICENSE.txt`). Porting does not transfer ownership of anyone's work.

The macOS app links LGPLv3 Qt, so, as for Windows, the app binary is conveyed under **GPLv3**, using the "or later" permission of the source license. The source itself stays GPL-2.0-or-later. GPLv3 and LGPLv3 texts are included (`GPL-3.0-only.txt`, `LGPL-3.0-only.txt`).

## What the app bundles

Distributed builds use the official open-source Qt 6.8.3 binaries. `mac/scripts/package.sh` copies Qt into `Moonphase.app/Contents/Frameworks` and `PlugIns`, then:

- removes the Qt modules and plugins Moonphase does not use;
- copies Qt's SBOM documents for the bundled modules into `Contents/Resources/Licenses/qt-sbom/`;
- writes `Contents/Resources/Licenses/THIRD-PARTY-LIBRARIES.md`, listing the bundled Qt modules and the third-party code Qt builds into them, with versions and SPDX licenses, from that SBOM;
- in release builds, adds each module's `LICENSES` folder from Qt's source (`Contents/Resources/Licenses/qtbase/`, `qtdeclarative/`).

The list is generated from the app being packaged, so it always matches what ships. Everything bundled is **Qt** (`qtbase`, `qtdeclarative`): LGPL-3.0 (or GPL-2.0/3.0), dynamically linked. Inside Qt are permissively licensed components such as FreeType, HarfBuzz, libpng, PCRE2, md4c, double-conversion and the Unicode data. Everything else comes from macOS itself. Qt Shader Tools is used only at build time to compile the shaders; it is not shipped.

A build made with Homebrew's Qt instead also bundles the libraries Homebrew's Qt links (such as GLib, ICU and OpenSSL); `package.sh` then lists them by Homebrew formula and copies each formula's license files.

## Corresponding source and replacing libraries

Release builds (`package.sh --release`) also write `Moonphase-<version>-sources.tar`, published next to the app on the same release page. It holds Qt's official source archives for the bundled modules at the exact version in the app, checked against Qt's published SHA-256. The app's own source is the matching Git tag of this repository. To rebuild the whole app, follow `mac/README.md`.

You may replace the bundled Qt frameworks or other libraries with compatible builds of your own; reverse engineering to debug such modifications is permitted. A distributed build is signed with a hardened runtime, which rejects libraries signed by anyone else. After replacing a library, re-sign the app for your own Mac (`codesign --force --deep --sign - Moonphase.app`) or build it from source with `mac/scripts/package.sh`.

## Shared imagery, calculations and services

The credits in the root README and `windows/THIRD-PARTY-NOTICES.md` apply unchanged and individually:

- **Moon:** NASA SVS CGI Moon Kit (Ernie Wright, USRA/NASA GSFC; LROC/Arizona State University; LOLA/NASA GSFC). Sources and hashes: `scripts/moon_assets_provenance.txt`.
- **Earth:** Blue Marble (Reto Stöckli, NASA Earth Observatory); Black Marble (Joshua Stevens, NASA Earth Observatory; Suomi NPP VIIRS data from Miguel Román, NASA GSFC); GEBCO-derived elevation and bathymetry (Jesse Allen, NASA Earth Observatory; BODC/GEBCO_08). Sources: `scripts/earth_assets_provenance.txt`.
- **Hijri conversion:** the Umm al-Qura month table from **moment-hijri**, Copyright (c) 2014 Suhail Alkowaileet, MIT; its notice ships as `moment-hijri-MIT.txt`.
- **Methods:** Jean Meeus, *Astronomical Algorithms*; no book text is copied.
- **AlAdhan / Islamic Network** supplies the optional online prayer times. With it turned on, the configured coordinates and method are sent to AlAdhan.

The macOS port adds an app icon cut from the project's own rendered Moon screenshot and a menu bar crescent drawn in code; it adds no other imagery. No endorsement by NASA, LROC, LOLA, GEBCO, KDE, Apple or The Qt Company is implied. No fonts are bundled: the app uses the macOS system font.

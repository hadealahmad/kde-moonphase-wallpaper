# macOS licensing and attribution

## Application source

Original project: **Hadi Alahmad**, Copyright 2026, <hade.alahmad1@gmail.com>, [KDE Moonphase Wallpaper](https://github.com/hadealahmad/kde-moonphase-wallpaper). Windows host: **Muhannad Al-Ahmad**, Copyright 2026. macOS host (`mac/`): ported from the Windows host, under the same license. All of it is **GPL-2.0-or-later** (the root `LICENSE`, shipped in the app as `Moonphase-LICENSE.txt`). Porting does not transfer ownership of anyone's work.

The macOS app links LGPLv3 Qt, so, as for Windows, the app binary is conveyed under **GPLv3**, using the "or later" permission of the source license. The source itself stays GPL-2.0-or-later. GPLv3 and LGPLv3 texts are included (`GPL-3.0-only.txt`, `LGPL-3.0-only.txt`).

## What the app bundles

`mac/scripts/package.sh` copies Qt and the libraries it depends on from Homebrew into `Moonphase.app/Contents/Frameworks` and `PlugIns`, then:

- removes the Qt modules and plugins Moonphase does not use;
- writes `Contents/Resources/Licenses/THIRD-PARTY-LIBRARIES.md`, listing every bundled library with its Homebrew formula, version, SPDX license, source URL and the files that came from it;
- copies each formula's license, copying and notice files into `Contents/Resources/Licenses/<formula>/`.

The list is generated from the app being packaged, so it always matches what ships. At the time of writing it covers:

- **Qt** (`qtbase`, `qtdeclarative`): LGPL-3.0 (or GPL-2.0/3.0), dynamically linked. Release builds add Qt's own `LICENSES` folders from its source. Qt Shader Tools is used only at build time to compile the shaders; it is not shipped.
- **Copyleft libraries Qt links:** GLib and gettext's libintl (LGPL-2.1-or-later), D-Bus's libdbus (AFL-2.1 or GPL-2.0-or-later), graphite2 (MIT, MPL-2.0, LGPL-2.1+ or GPL-2.0+).
- **Permissive libraries:** ICU, OpenSSL (Apache-2.0), FreeType (FTL), HarfBuzz, libpng, PCRE2, zstd, Brotli, md4c, double-conversion and libb2.

## Corresponding source and replacing libraries

Release builds (`package.sh --release`) also write `Moonphase-<version>-sources.tar`. It holds the exact source archive, patches and Homebrew build recipe of every bundled library under a GPL, LGPL, MPL or AFL license, and is published next to the app on the same release page. The app's own source is the matching Git tag of this repository. To rebuild the whole app, follow `mac/README.md`.

You may replace the bundled Qt frameworks or other libraries with compatible builds of your own; reverse engineering to debug such modifications is permitted. A distributed build is signed with a hardened runtime, which rejects libraries signed by anyone else. After replacing a library, re-sign the app for your own Mac (`codesign --force --deep --sign - Moonphase.app`) or build it from source with `mac/scripts/package.sh`.

## Shared imagery, calculations and services

The credits in the root README and `windows/THIRD-PARTY-NOTICES.md` apply unchanged and individually:

- **Moon:** NASA SVS CGI Moon Kit (Ernie Wright, USRA/NASA GSFC; LROC/Arizona State University; LOLA/NASA GSFC). Sources and hashes: `scripts/moon_assets_provenance.txt`.
- **Earth:** Blue Marble (Reto Stöckli, NASA Earth Observatory); Black Marble (Joshua Stevens, NASA Earth Observatory; Suomi NPP VIIRS data from Miguel Román, NASA GSFC); GEBCO-derived elevation and bathymetry (Jesse Allen, NASA Earth Observatory; BODC/GEBCO_08). Sources: `scripts/earth_assets_provenance.txt`.
- **Hijri conversion:** the Umm al-Qura month table from **moment-hijri**, Copyright (c) 2014 Suhail Alkowaileet, MIT; its notice ships as `moment-hijri-MIT.txt`.
- **Methods:** Jean Meeus, *Astronomical Algorithms*; no book text is copied.
- **AlAdhan / Islamic Network** supplies the optional online prayer times. With it turned on, the configured coordinates and method are sent to AlAdhan.

The macOS port adds an app icon cut from the project's own rendered Moon screenshot and a menu bar crescent drawn in code; it adds no other imagery. No endorsement by NASA, LROC, LOLA, GEBCO, KDE, Apple or The Qt Company is implied. No fonts are bundled: the app uses the macOS system font.

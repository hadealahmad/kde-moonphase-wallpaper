# Moonphase on macOS

Native Qt 6/Metal host for Hadi Alahmad's Moon Phase & Celestial Astrolabe wallpaper, built on the Windows host by Muhannad Al-Ahmad. It reuses the shared `contents/` (QML scenes, astronomy/prayer/Hijri code, shaders, textures) through the same adapter as `windows/`, so upstream changes carry over.

## Build

Needs macOS 13+, Xcode command-line tools, Homebrew `qt` (6.8+) and `ninja`, Python 3.11+ and, for the tests, Node 18+.

```bash
brew install qt ninja
mac/scripts/package.sh
```

This configures and builds into `build/mac`, runs the shared calculation tests plus the adapter test, then writes a self-contained, ad-hoc signed `mac/dist/Moonphase.app` (about 135 MB, Qt bundled). Drag it to `/Applications` if you like. It is for local use: not notarized, so another Mac's Gatekeeper will refuse it.

`mac/resources/Moonphase.icns` is generated once from the rendered Moon close-up with `swift mac/scripts/make_icon.swift docs/screenshots/closeup_moon.png mac/resources`.

## Use

Open **Moonphase.app**. The wallpaper starts on every display, behind the desktop icons, on every Space. The menu bar crescent and the Dock icon's menu have Start, Stop, Pause, Preview, Settings and Open at Login; the menu bar menu also has the pause options and Quit. Clicking the Dock icon opens Settings. Changes save immediately.

With more than one display, choose where the wallpaper runs under **Displays** in either menu, or **Show on displays** at the top of Settings. Displays you turn off keep their macOS wallpaper. The choice is saved per display (by its CoreGraphics UUID), so it survives unplugging and restarts, and a display connected for the first time starts on.

The first launch picks the preset city in this Mac's timezone, if there is one; otherwise it starts at Cairo until you set a location in Settings.

Rendering pauses during sleep, display sleep and screen lock, when windows or a full-screen app cover the desktop on every display, and in Low Power Mode (the last two can be turned off in the menu bar menu). The macOS wallpaper underneath is never changed, so Stop or Quit shows it again. The lock screen and Mission Control's Space thumbnails keep the macOS wallpaper.

Preferences and the log are in `~/Library/Application Support/MoonphaseMac/Moonphase/`. A second launch hands its command to the running app: `Moonphase.app/Contents/MacOS/Moonphase --preview` (or `--settings`, `--stop`, `--pause`, `--resume`, `--reattach`, `--quit`). Test runs take `--isolated --test-seconds N --capture file.png --report file.json`, plus `--phase`, `--day`, `--style` and `--set key=value`.

## How it works

Each display gets a borderless `QQuickView` (Metal) whose `NSWindow` sits at `kCGDesktopWindowLevel`, below Finder's icon level, with `CanJoinAllSpaces | Stationary | IgnoresCycle` and `ignoresMouseEvents`, so clicks and drags reach the desktop. Windows are rebuilt when displays change, and a two-second check reattaches any that move. `NSWindow.occlusionState` drives the covered-desktop pause. `SMAppService.mainApp` handles Open at Login.

## Licensing

Same as the project: GPL-2.0-or-later, with Qt under its own licenses (LGPLv3 for the modules used). See the root README and `windows/THIRD-PARTY-NOTICES.md`.

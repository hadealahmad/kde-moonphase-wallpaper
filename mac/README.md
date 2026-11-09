# Moonphase on macOS

Native Qt 6/Metal host for Hadi Alahmad's Moon Phase & Celestial Astrolabe wallpaper, built on the Windows host by Muhannad Al-Ahmad. It reuses the shared `contents/` (QML scenes, astronomy/prayer/Hijri code, shaders, textures) through the same adapter as `windows/`, so upstream changes carry over.

## Build

Needs macOS 13+, the Xcode command-line tools (`xcode-select --install`), Python 3.11+ (macOS's own `python3` is too old; Homebrew's is fine), CMake 3.24+, Ninja, and Qt 6.8+ with Qt Shader Tools. Node 18+ is optional: with it, the build also runs the calculation tests.

Use the official Qt 6.8.3 LTS binaries. They are universal and support macOS 12 and later, so the app runs on Apple Silicon and Intel Macs with macOS 13 or later. [aqtinstall](https://github.com/miurahr/aqtinstall) downloads them without a Qt account (about 5 GB):

```bash
brew install cmake ninja python
python3 -m venv ~/Qt/.aqt && ~/Qt/.aqt/bin/pip install aqtinstall
~/Qt/.aqt/bin/aqt install-qt mac desktop 6.8.3 clang_64 -m qtshadertools -O ~/Qt
mac/scripts/package.sh
```

`package.sh` uses `~/Qt/6.8.3/macos` when it exists; pass another Qt as its argument or in `QT_DIR`. It builds into `build/mac-qt<version>`, runs the shared calculation tests plus the adapter test, then writes a self-contained, ad-hoc signed `mac/dist/Moonphase.app` (about 90 MB, universal). It bundles only the parts of Qt the app uses, plus the license files of everything bundled in `Contents/Resources/Licenses` (see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). It prints the app's architectures and minimum macOS when it finishes. Drag the app to `/Applications` if you like.

Homebrew's Qt (`brew install qt`, then `mac/scripts/package.sh "$(brew --prefix qt)"`) also works for a build on your own Mac. Homebrew compiles its libraries for the macOS and processor of the Mac they were installed on, so that app only runs on the same macOS version or later and the same processor.

A build made this way is for the Mac that built it: macOS trusts apps you build yourself, but it is ad-hoc signed and not notarized, so Gatekeeper on another Mac refuses it.

### Signed builds for other people

Sharing a build that opens on any Mac needs an Apple Developer Program membership, a **Developer ID Application** certificate in your keychain, and a notarytool profile (`xcrun notarytool store-credentials <name> --apple-id <id> --team-id <team>`).

Package with `mac/scripts/package.sh --release`. It refuses a build that is not universal or needs more than macOS 13, so use the official Qt. It adds each Qt module's `LICENSES` folder to the app and writes `mac/dist/Moonphase-<version>-sources.tar` (about 80 MB): Qt's official source archives for the bundled modules, checked against Qt's published SHA-256. Publish that file next to the app; the licenses require it.

Then sign every library and framework in the bundle, then the app, with `codesign --force --timestamp --options runtime --sign "Developer ID Application: …"`. Give the app the `com.apple.security.cs.allow-jit` entitlement, since Qt's QML engine needs it under the hardened runtime. Then zip the app with `ditto -c -k --keepParent`, submit it with `xcrun notarytool submit … --keychain-profile <name> --wait`, and staple with `xcrun stapler staple`. Zip it again after stapling for distribution.

`mac/resources/Moonphase.icns` is generated once from the rendered Moon close-up with `swift mac/scripts/make_icon.swift docs/screenshots/closeup_moon.png mac/resources`.

## Use

Open **Moonphase.app**. Opened from anywhere but an Applications folder (say, Downloads after unzipping), it first offers to move itself to `/Applications` and relaunch from there; an older copy there goes to the Trash. "Don't ask again" is remembered in the preferences file. The wallpaper starts on every display, behind the desktop icons, on every Space. The menu bar crescent and the Dock icon's menu have Start, Stop, Pause, Preview, Settings and Open at Login; the menu bar menu also has the pause options and Quit. Clicking the Dock icon opens Settings. Changes save immediately.

With more than one display, choose where the wallpaper runs under **Displays** in either menu, or **Show on displays** at the top of Settings. Displays you turn off keep their macOS wallpaper. The choice is saved per display (by its CoreGraphics UUID), so it survives unplugging and restarts, and a display connected for the first time starts on.

The first launch picks the preset city in this Mac's timezone, if there is one; otherwise it starts at Cairo until you set a location in Settings.

Rendering pauses during sleep, display sleep and screen lock, when windows or a full-screen app cover the desktop on every display, and in Low Power Mode (the last two can be turned off in the menu bar menu). The macOS wallpaper underneath is never changed, so Stop or Quit shows it again. The lock screen and Mission Control's Space thumbnails keep the macOS wallpaper.

Preferences and the log are in `~/Library/Application Support/MoonphaseMac/Moonphase/`. A second launch hands its command to the running app: `Moonphase.app/Contents/MacOS/Moonphase --preview` (or `--settings`, `--stop`, `--pause`, `--resume`, `--reattach`, `--quit`). Test runs take `--isolated --test-seconds N --capture file.png --report file.json`, plus `--phase`, `--day`, `--style` and `--set key=value`.

## How it works

Each display gets a borderless `QQuickView` (Metal) whose `NSWindow` sits at `kCGDesktopWindowLevel`, below Finder's icon level, with `CanJoinAllSpaces | Stationary | IgnoresCycle` and `ignoresMouseEvents`, so clicks and drags reach the desktop. Windows are rebuilt when displays change, and a two-second check reattaches any that move. `NSWindow.occlusionState` drives the covered-desktop pause. `SMAppService.mainApp` handles Open at Login.

## Licensing

Same as the project: GPL-2.0-or-later, with Qt under its own licenses (LGPLv3 for the modules used). See the root README and `windows/THIRD-PARTY-NOTICES.md`.

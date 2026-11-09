#!/bin/zsh
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds mac/dist/Moonphase.app: a self-contained, ad-hoc signed app with the
# license texts of everything it bundles in Contents/Resources/Licenses.
#
#   mac/scripts/package.sh [--release] [path to Qt]
#
# Qt: the path given, else $QT_DIR, else the official Qt 6.8.3 in ~/Qt/6.8.3/macos
# (see mac/README.md), else Homebrew's. Official Qt builds a universal app for
# macOS 13 and later; Homebrew's Qt only runs on the Mac's own macOS and processor.
#
# --release (for builds you distribute) also downloads the exact sources of the
# bundled copyleft libraries, adds their license folders to the app, writes
# mac/dist/Moonphase-<version>-sources.tar to publish next to the app, and
# refuses a build that is not universal or needs more than macOS 13.
set -euo pipefail
setopt extendedglob nullglob
root=${0:A:h:h:h}
release=0
if [[ ${1:-} == --release ]]; then release=1; shift; fi
qt=${1:-${QT_DIR:-}}
if [[ -z $qt && -d $HOME/Qt/6.8.3/macos ]]; then qt=$HOME/Qt/6.8.3/macos; fi
if [[ -z $qt ]]; then qt=$(brew --prefix qt); fi
qt=${qt:A}
qtversion=$("$qt/bin/qmake" -query QT_VERSION)
homebrew=0
if [[ $qt == /opt/homebrew/* ]]; then homebrew=1; fi
build=$root/build/mac-qt$qtversion
if (( homebrew )); then build+=-homebrew; fi
dist=$root/mac/dist
app=$dist/Moonphase.app
appversion=$(sed -nE 's/^project\(MoonphaseMac VERSION ([0-9.]+).*/\1/p' "$root/mac/CMakeLists.txt")
minimum=13.0   # The app's own floor (SMAppService for Open at Login).

cmake_args=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$qt")
qt_archs=$(lipo -archs "$qt/lib/QtCore.framework/QtCore")
if [[ $qt_archs == *arm64* && $qt_archs == *x86_64* ]]; then cmake_args+=("-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64"); fi
echo "Qt $qtversion from $qt ($qt_archs)"
cmake -S "$root/mac" -B "$build" -G Ninja $cmake_args
cmake --build "$build"
ctest --test-dir "$build" --output-on-failure

rm -rf "$dist"; mkdir -p "$dist"
cp -R "$build/Moonphase.app" "$app"
# macdeployqt copies every QML module and plugin it finds, including some whose
# dependencies it cannot resolve (Homebrew splits Qt, the official SDK has SQL
# drivers for databases that are not installed). The trimming below fixes that.
"$qt/bin/macdeployqt" "$app" -qmldir="$build/adapted/contents/ui" 2>&1 | grep -v "^ERROR" || true

contents=$app/Contents
frameworks=$contents/Frameworks
qml=$contents/Resources/qml

# --- Keep only what Moonphase uses --------------------------------------------
# The scenes import nothing but QtQuick (which pulls in QtQml, QtQml.Models and
# QtQml.WorkerScript); the settings window needs the macOS style, AlAdhan needs TLS.
rm -rf "$contents/PlugIns/"{sqldrivers,multimedia,platforminputcontexts,imageformats,iconengines,networkinformation}
for dir in "$qml"/QtQuick/*(/); do rm -rf "$dir"; done
for dir in "$qml"/QtQml/*(/); do [[ ${dir:t} == (Models|WorkerScript) ]] || rm -rf "$dir"; done
used=(${(f)"$(find "$qml" -type l -exec readlink {} \; | sed 's|.*/||')"})
(( $#used )) || { echo "No QML plugin links found; refusing to trim PlugIns/quick" >&2; exit 1; }
for lib in "$contents"/PlugIns/quick/*.dylib; do (( ${used[(Ie)${lib:t}]} )) || rm -f "$lib"; done
find "$contents" -name '*.dSYM' -prune -exec rm -rf {} +

# Bundle-relative dependency → top-level entry in Frameworks (QtCore.framework, libz.1.dylib).
bundled() { otool -L "$1" | awk 'NR>1 {print $1}' | grep -E '^@(rpath|executable_path|loader_path)/' | sed -E 's|^.*/Frameworks/||; s|^@[a-z_]+/||; s|/.*||'; }
# Remove plugins whose dependencies are missing, until none are left.
while true; do
  removed=0
  for lib in $(find "$contents/PlugIns" -type f -name '*.dylib'); do
    for dep in $(bundled "$lib"); do
      [[ -e "$frameworks/$dep" ]] || { rm -f "$lib"; removed=1; break; }
    done
  done
  (( removed )) || break
done
# Links left pointing at removed plugins (codesign rejects dangling links).
find "$contents" -type l ! -exec test -e {} \; -exec rm -f {} +
# Drop frameworks and libraries nothing left in the app links against.
typeset -A keep
queue=("$contents/MacOS/Moonphase" ${(f)"$(find "$contents/PlugIns" -type f -name '*.dylib')"})
while (( $#queue )); do
  file=$queue[1]; shift queue
  for dep in $(bundled "$file"); do
    [[ -n ${keep[$dep]:-} ]] && continue
    keep[$dep]=1
    [[ $dep == *.framework ]] && queue+=("$frameworks/$dep/${dep%.framework}") || queue+=("$frameworks/$dep")
  done
done
for item in "$frameworks"/*; do [[ -n ${keep[${item:t}]:-} ]] || rm -rf "$item"; done
find "$contents" -type l ! -exec test -e {} \; -exec rm -f {} +

# The linker records the build machine's Qt folder as a library search path;
# a distributed app must only search inside itself.
for rpath in $(otool -l "$contents/MacOS/Moonphase" | awk '/LC_RPATH/ {getline; getline; print $2}'); do
  [[ $rpath == @* ]] || install_name_tool -delete_rpath "$rpath" "$contents/MacOS/Moonphase"
done
if otool -L $(find "$contents" -type f -perm +111) 2>/dev/null | grep -qE "/opt/homebrew|$qt"; then
  echo "Bundle still links outside itself" >&2; exit 1
fi

# --- License notices ------------------------------------------------------------
licenses=$contents/Resources/Licenses
mkdir -p "$licenses"
cp "$root/LICENSE" "$licenses/Moonphase-LICENSE.txt"
cp "$root/mac/THIRD-PARTY-NOTICES.md" "$licenses/"
cp "$root"/windows/licenses/*.txt "$licenses/"   # GPL-3.0, LGPL-3.0, moment-hijri MIT
sources=$dist/Moonphase-$appversion-sources
if (( release )); then mkdir -p "$sources"; fi
shipped=(${(f)"$(find "$contents/Frameworks" "$contents/PlugIns" -type f \( -perm +111 -o -name '*.dylib' \) -exec basename {} \; | sort -u)"})

if (( ! homebrew )); then
  # Official Qt: everything bundled is Qt. Its SBOM lists every Qt module and the
  # third-party code built into it, with versions and licenses.
  qtmodules=($(python3 - "$qt/sbom" "$qtversion" $shipped <<'PY'
import json, sys, glob, os
sbom, version, shipped = sys.argv[1], sys.argv[2], set(sys.argv[3:])
for path in sorted(glob.glob(os.path.join(sbom, f"*-{version}.spdx.json"))):
    doc = json.load(open(path))
    names = {os.path.basename(f.get("fileName", "")) for f in doc.get("files", [])}
    if names & shipped:
        print(os.path.basename(path)[: -len(f"-{version}.spdx.json")])
PY
  ))
  (( $#qtmodules )) || { echo "Could not match the bundled Qt to its SBOM in $qt/sbom" >&2; exit 1; }
  mkdir -p "$licenses/qt-sbom"
  for module in $qtmodules; do cp "$qt/sbom/$module-$qtversion".spdx* "$licenses/qt-sbom/"; done
  if (( release )); then
    # Corresponding source: Qt's official source archives, checked against
    # Qt's published SHA-256. Qt's license texts live only in its source tree.
    cache=$root/build/qt-sources; mkdir -p "$cache" "$sources/qt"
    base=https://download.qt.io/archive/qt/${qtversion%.*}/$qtversion/submodules
    for module in $qtmodules; do
      archive=$module-everywhere-src-$qtversion.tar.xz
      if [[ ! -f $cache/$archive ]]; then echo "Downloading $archive"; curl -fsSL --retry 3 -o "$cache/$archive" "$base/$archive"; fi
      expected=$(curl -fsL "$base/$archive.sha256" | awk '{print $1}')
      [[ $(shasum -a 256 "$cache/$archive" | awk '{print $1}') == $expected ]] || { echo "Checksum mismatch: $archive" >&2; exit 1; }
      cp "$cache/$archive" "$sources/qt/"
      mkdir -p "$licenses/$module"
      tar -xJf "$cache/$archive" -C "$licenses/$module" --strip-components 2 '*/LICENSES/*'
    done
  fi
  python3 - "$licenses/THIRD-PARTY-LIBRARIES.md" "$appversion" "$qtversion" "$qt/sbom" $qtmodules <<'PY'
import json, sys, os
out, version, qtversion, sbom, modules = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
lines = [f"# Libraries bundled in Moonphase {version} for macOS", "",
         f"Everything bundled is Qt {qtversion} (the official open-source binaries), dynamically linked:",
         f"the Qt modules {', '.join(modules)}, available under LGPL-3.0 (`LGPL-3.0-only.txt`; release builds",
         "also include each module's `LICENSES` folder from its source).", "",
         "Qt builds the third-party code below into its libraries. The list comes from Qt's SBOM (full",
         "documents in `qt-sbom/`); it covers whole modules, so it can name code from parts of Qt this app",
         "leaves out.", "",
         "| Component | Version | License (SPDX) | Qt module |", "|---|---|---|---|"]
rows = {}
for module in modules:
    doc = json.load(open(os.path.join(sbom, f"{module}-{qtversion}.spdx.json")))
    for p in doc["packages"]:
        name = p.get("name", "")
        # Third-party code shows up as "<Target>_Attribution_<name>" or "Bundled<Name>".
        if "_Attribution_" in name:
            component = name.split("_Attribution_", 1)[1]
        elif name.startswith("Bundled"):
            component = name[len("Bundled"):]
        else:
            continue
        license = p.get("licenseConcluded") or p.get("licenseDeclared") or "NOASSERTION"
        rows.setdefault((component.lower(), p.get("versionInfo", ""), license), (component, module))
for (_, version_info, license), (component, module) in sorted(rows.items()):
    lines.append(f"| {component} | {version_info} | {license} | {module} |")
open(out, "w").write("\n".join(lines) + "\n")
PY
else
  # Homebrew Qt: map each bundled library back to the formula it was copied from.
  typeset -A formula_version formula_files
  for item in "$frameworks"/*; do
    candidates=(/opt/homebrew/opt/*/lib/${item:t})
    (( $#candidates )) || { echo "No Homebrew formula found for ${item:t}" >&2; exit 1; }
    real=${candidates[1]:A}
    formula=$(sed -E 's|^/opt/homebrew/Cellar/([^/]+)/.*|\1|' <<< "$real")
    formula_version[$formula]=$(sed -E 's|^/opt/homebrew/Cellar/[^/]+/([^/]+)/.*|\1|' <<< "$real")
    formula_files[$formula]+="${item:t} "
  done
  for plugin in $(find "$contents/PlugIns" -type f -name '*.dylib'); do
    candidates=(/opt/homebrew/opt/*/share/qt/plugins/${plugin#$contents/PlugIns/})
    (( $#candidates )) || continue
    formula=$(sed -E 's|^/opt/homebrew/Cellar/([^/]+)/.*|\1|' <<< "${candidates[1]:A}")
    [[ -n ${formula_version[$formula]:-} ]] || formula_version[$formula]=$(sed -E 's|^/opt/homebrew/Cellar/[^/]+/([^/]+)/.*|\1|' <<< "${candidates[1]:A}")
    formula_files[$formula]+="plugins/${plugin#$contents/PlugIns/} "
  done
  formulas=(${(ko)formula_version})
  brew info --json=v2 $formulas > "$dist/formulas.json"
  for formula in $formulas; do
    keg=/opt/homebrew/Cellar/$formula/${formula_version[$formula]}
    texts=(${(f)"$(find "$keg" -maxdepth 1 -type f \( -iname 'licen[cs]e*' -o -iname 'copying*' -o -iname 'notice*' \
      -o -iname 'copyright*' -o -iname 'authors*' -o -iname '*gpl*' \))"})
    (( $#texts )) || continue
    mkdir -p "$licenses/$formula"
    cp $texts "$licenses/$formula/"
  done
  if (( release )); then
    for formula in $formulas; do
      license=$(python3 -c "import json,sys;print(next(f['license'] for f in json.load(open(sys.argv[1]))['formulae'] if f['name']==sys.argv[2]) or '')" "$dist/formulas.json" "$formula")
      [[ $license == *(GPL|MPL|AFL)* ]] || continue
      # Sources come from the current formula, so it must match what is installed.
      current=$(python3 -c "import json,sys;print(next(f['versions']['stable'] for f in json.load(open(sys.argv[1]))['formulae'] if f['name']==sys.argv[2]))" "$dist/formulas.json" "$formula")
      if [[ ${formula_version[$formula]%_*} != $current ]]; then
        echo "$formula ${formula_version[$formula]} is installed but the formula is now $current; run 'brew upgrade $formula' and package again." >&2
        exit 1
      fi
      mkdir -p "$sources/$formula"
      # The source archive plus any patches and resources the formula builds with.
      # (HOMEBREW_DEVELOPER for `brew ruby` and `brew cat`, developer commands that
      # would otherwise switch Homebrew's developer mode on for good.)
      brew fetch --build-from-source --quiet "$formula" >/dev/null
      paths=(${(f)"$(HOMEBREW_DEVELOPER=1 brew ruby -e 'f = Formula[ARGV[0]]; puts f.cached_download
        f.patchlist.select(&:external?).each { |p| puts p.resource.cached_download }
        f.resources.each { |r| puts r.cached_download }' "$formula")"})
      for file in $paths; do
        [[ -f $file ]] || { echo "Missing source download for $formula: $file" >&2; exit 1; }
        cp "$file" "$sources/$formula/${${file:t}#*--}"
      done
      HOMEBREW_DEVELOPER=1 brew cat "$formula" > "$sources/$formula/$formula.rb"
      if [[ $formula == qt* ]]; then   # Qt keeps its license texts only in the source tree.
        mkdir -p "$licenses/$formula"
        tar -xJf $sources/$formula/*.tar.xz -C "$licenses/$formula" --strip-components 2 '*/LICENSES/*'
      fi
    done
  fi
  rows=()
  for formula in $formulas; do rows+=("$formula" "${formula_version[$formula]}" "${formula_files[$formula]}"); done
  python3 - "$dist/formulas.json" "$licenses/THIRD-PARTY-LIBRARIES.md" "$appversion" $rows <<'PY'
import json, sys
info = {f["name"]: f for f in json.load(open(sys.argv[1]))["formulae"]}
out, version, rows = sys.argv[2], sys.argv[3], sys.argv[4:]
installed = {rows[i]: rows[i + 1] for i in range(0, len(rows), 3)}
files = {rows[i]: rows[i + 2] for i in range(0, len(rows), 3)}
lines = [f"# Libraries bundled in Moonphase {version} for macOS", "",
         "Each library was copied from the Homebrew formula named below. Its license texts are in the",
         "folder of the same name next to this file (Qt's license texts: `LGPL-3.0-only.txt`,",
         "`GPL-3.0-only.txt`, and the `qt*` folders in release builds).", "",
         "| Formula | Version | License (SPDX) | Source | Files in the app |", "|---|---|---|---|---|"]
for name in sorted(files):
    f = info[name]
    shipped = ", ".join(sorted(files[name].split()))
    lines.append(f"| {name} | {installed[name]} | {f['license']} | {f['urls']['stable']['url']} | {shipped} |")
open(out, "w").write("\n".join(lines) + "\n")
PY
  rm -f "$dist/formulas.json"
fi

if (( release )); then
  cat > "$sources/README.txt" <<EOF
Corresponding source for the copyleft libraries bundled in Moonphase $appversion
for macOS, at the exact versions in the app: Qt's official source archives
(checked against Qt's published SHA-256) or, for a Homebrew-based build, each
library's source archive, patches and Homebrew build recipe (.rb). The app's
own source is the Git tag for this release (mac/ and the shared contents/).
The full list of bundled components, with versions and licenses, is in
Moonphase.app/Contents/Resources/Licenses/.
EOF
  tar -cf "$dist/Moonphase-$appversion-sources.tar" -C "$dist" "${sources:t}"
  rm -rf "$sources"
fi

# Declare the real minimum macOS: the highest any bundled binary was built for.
# Older Macs then say the app needs a newer macOS instead of letting it crash.
minos=$(find "$contents" -type f \( -perm +111 -o -name '*.dylib' \) -exec vtool -show-build {} \; 2>/dev/null \
  | awk '/minos/ {print $2}' | sort -V | tail -1)
minos=${minos:-$minimum}
plutil -replace LSMinimumSystemVersion -string "$minos" "$contents/Info.plist"
archs=$(lipo -archs "$contents/MacOS/Moonphase")
if (( release )); then
  # A distributed build must run on every supported Mac.
  [[ $(printf '%s\n' "$minos" "$minimum" | sort -V | tail -1) == $minimum ]] \
    || { echo "Release build needs macOS $minos; use the official Qt (see mac/README.md)" >&2; exit 1; }
  [[ $archs == *arm64* && $archs == *x86_64* ]] \
    || { echo "Release build is $archs only; use the official Qt (see mac/README.md)" >&2; exit 1; }
fi

codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Built $app ($(du -sh "$app" | cut -f1), $archs, macOS $minos or later)"
(( release )) && echo "Sources: $dist/Moonphase-$appversion-sources.tar ($(du -sh "$dist/Moonphase-$appversion-sources.tar" | cut -f1))"
true

#!/bin/zsh
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds mac/dist/Moonphase.app: a self-contained, ad-hoc signed app with the
# license texts of everything it bundles in Contents/Resources/Licenses.
#
#   mac/scripts/package.sh [--release] [path to Qt, default: brew --prefix qt]
#
# --release (for builds you distribute) also downloads the exact sources of the
# bundled copyleft libraries (Qt, GLib, …) from Homebrew, adds Qt's own license
# files to the app, and writes mac/dist/Moonphase-<version>-sources.tar to
# publish next to the app.
set -euo pipefail
setopt extendedglob nullglob
root=${0:A:h:h:h}
release=0
[[ ${1:-} == --release ]] && { release=1; shift; }
qt=${1:-$(brew --prefix qt)}
build=$root/build/mac
dist=$root/mac/dist
app=$dist/Moonphase.app
appversion=$(sed -nE 's/^project\(MoonphaseMac VERSION ([0-9.]+).*/\1/p' "$root/mac/CMakeLists.txt")

cmake -S "$root/mac" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$qt"
cmake --build "$build"
ctest --test-dir "$build" --output-on-failure

rm -rf "$dist"; mkdir -p "$dist"
cp -R "$build/Moonphase.app" "$app"
# Homebrew splits Qt into many prefixes, so macdeployqt copies plugins whose
# modules it then cannot find. Its errors are expected; the trimming below fixes them.
"$qt/bin/macdeployqt" "$app" -qmldir="$build/adapted/contents/ui" 2>&1 | grep -v "^ERROR" || true

contents=$app/Contents
frameworks=$contents/Frameworks
qml=$contents/Resources/qml

# --- Keep only what Moonphase uses --------------------------------------------
# The scenes import nothing but QtQuick (which pulls in QtQml, QtQml.Models and
# QtQml.WorkerScript). macdeployqt copies every QML module and plugin it finds.
rm -rf "$contents/PlugIns/"{sqldrivers,multimedia,platforminputcontexts,imageformats,iconengines,networkinformation}
for dir in "$qml"/QtQuick/*(/); do rm -rf "$dir"; done
for dir in "$qml"/QtQml/*(/); do [[ ${dir:t} == (Models|WorkerScript) ]] || rm -rf "$dir"; done
used=(${(f)"$(find "$qml" -type l -exec readlink {} \; | sed 's|.*/||')"})
for lib in "$contents"/PlugIns/quick/*.dylib; do (( ${used[(Ie)${lib:t}]} )) || rm -f "$lib"; done

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

if otool -L $(find "$contents" -type f -perm +111) 2>/dev/null | grep -q '/opt/homebrew'; then
  echo "Bundle still links Homebrew paths" >&2; exit 1
fi

# --- License notices ------------------------------------------------------------
licenses=$contents/Resources/Licenses
mkdir -p "$licenses"
cp "$root/LICENSE" "$licenses/Moonphase-LICENSE.txt"
cp "$root/mac/THIRD-PARTY-NOTICES.md" "$licenses/"
cp "$root"/windows/licenses/*.txt "$licenses/"   # GPL-3.0, LGPL-3.0, moment-hijri MIT

# Map each bundled library back to the Homebrew formula it was copied from.
typeset -A formula_version formula_files
for item in "$frameworks"/*; do
  candidates=(/opt/homebrew/opt/*/lib/${item:t})
  if (( ! $#candidates )); then
    # A Qt from elsewhere (e.g. the Qt installer) has no formula to take notices from.
    (( release )) && { echo "No Homebrew formula found for ${item:t}; release builds need Homebrew's Qt" >&2; exit 1; }
    echo "warning: no Homebrew formula for ${item:t}; its license is not listed" >&2
    continue
  fi
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

# Corresponding source for the copyleft libraries (release builds only).
if (( release )); then
  sources=$dist/Moonphase-$appversion-sources
  mkdir -p "$sources"
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
    # Qt keeps its license texts only in the source tree.
    if [[ $formula == qt* ]]; then
      mkdir -p "$licenses/$formula"
      tar -xJf $sources/$formula/*.tar.xz -C "$licenses/$formula" --strip-components 2 '*/LICENSES/*'
    fi
  done
  cat > "$sources/README.txt" <<EOF
Corresponding source for the copyleft libraries bundled in Moonphase $appversion
for macOS: each folder holds the source archive, patches and Homebrew build
recipe (.rb) of the version in the app. The app's own source is the Git tag
for this release at https://github.com/hadealahmad/kde-moonphase-wallpaper
(mac/ and the shared contents/). The full list of bundled libraries, with
versions and licenses, is in Moonphase.app/Contents/Resources/Licenses/.
EOF
  tar -cf "$dist/Moonphase-$appversion-sources.tar" -C "$dist" "${sources:t}"
  rm -rf "$sources"
fi

# Readable list of every bundled library, its version, license and source.
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
    url = f["urls"]["stable"]["url"]
    shipped = ", ".join(sorted(files[name].split()))
    lines.append(f"| {name} | {installed[name]} | {f['license']} | {url} | {shipped} |")
open(out, "w").write("\n".join(lines) + "\n")
PY
rm -f "$dist/formulas.json"

# Declare the real minimum macOS: the highest any bundled binary was built for
# (Homebrew's libraries target the macOS they were built on). Older Macs then
# say the app needs a newer macOS instead of letting it crash at launch.
minos=$(find "$contents" -type f \( -perm +111 -o -name '*.dylib' \) -exec vtool -show-build {} \; 2>/dev/null \
  | awk '/minos/ {print $2}' | sort -V | tail -1)
plutil -replace LSMinimumSystemVersion -string "${minos:-13.0}" "$contents/Info.plist"

codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Built $app ($(du -sh "$app" | cut -f1), $(lipo -archs "$contents/MacOS/Moonphase"), macOS ${minos:-13.0} or later)"
(( release )) && echo "Sources: $dist/Moonphase-$appversion-sources.tar ($(du -sh "$dist/Moonphase-$appversion-sources.tar" | cut -f1))"
true

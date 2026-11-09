#!/bin/zsh
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds mac/dist/Moonphase.app: a self-contained, ad-hoc signed app for local use.
# Usage: mac/scripts/package.sh [path to Qt, default: brew --prefix qt]
set -euo pipefail
root=${0:A:h:h:h}
qt=${1:-$(brew --prefix qt)}
build=$root/build/mac
dist=$root/mac/dist
app=$dist/Moonphase.app

cmake -S "$root/mac" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$qt"
cmake --build "$build"
ctest --test-dir "$build" --output-on-failure

rm -rf "$dist"; mkdir -p "$dist"
cp -R "$build/Moonphase.app" "$app"
# Homebrew splits Qt into many prefixes, so macdeployqt copies plugins whose
# modules it then cannot find. Its errors are expected; the pruning below fixes them.
"$qt/bin/macdeployqt" "$app" -qmldir="$build/adapted/contents/ui" 2>&1 | grep -v "^ERROR" || true

contents=$app/Contents
# Not used by the wallpaper (no SQL, media, virtual keyboard or PDF).
rm -rf "$contents/PlugIns/"{sqldrivers,multimedia,platforminputcontexts}

# Remove any library whose @rpath dependencies are not in the bundle, until none are left.
while true; do
  removed=0
  for lib in $(find "$contents/PlugIns" "$contents/Resources/qml" -type f -name '*.dylib' 2>/dev/null); do
    for dep in $(otool -L "$lib" | awk 'NR>1 && $1 ~ /^@rpath\// {print $1}'); do
      if [[ ! -e "$contents/Frameworks/${dep#@rpath/}" ]]; then
        rm -f "$lib"; removed=1; break
      fi
    done
  done
  (( removed )) || break
done
# Resources/qml links into PlugIns; drop links left pointing at removed plugins
# (codesign rejects dangling links).
find "$contents" -type l ! -exec test -e {} \; -exec rm -f {} +
if otool -L $(find "$contents" -type f -perm +111) 2>/dev/null | grep -q '/opt/homebrew'; then
  echo "Bundle still links Homebrew paths" >&2; exit 1
fi
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Built $app ($(du -sh "$app" | cut -f1))"

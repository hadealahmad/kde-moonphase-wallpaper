# KDE Plasma 6 Moon Phase Wallpaper
#
# Build step: bake each GLSL fragment shader into a Qt shader pack (.qsb).
# Qt 6 Quick's ShaderEffect supplies its own default vertex stage, so no
# vertex shaders are needed.

QSB ?= $(shell command -v qsb 2>/dev/null || echo /usr/lib64/qt6/bin/qsb)

SHADER_DIR := contents/shaders
FRAGS      := $(SHADER_DIR)/moon.frag $(SHADER_DIR)/orbit.frag $(SHADER_DIR)/earth.frag $(SHADER_DIR)/background.frag $(SHADER_DIR)/prayer_clock.frag
QSB_OUTS   := $(FRAGS:.frag=.frag.qsb)

# Same target set as Qt's `qsb --qt6`, written out explicitly so the exact
# GLSL versions are visible in the build log.
QSB_FLAGS := --glsl "100 es,120,150" --hlsl 50 --msl 12

.PHONY: all shader install clean smoke preview preview-full test

all: shader

shader: $(QSB_OUTS)

%.frag.qsb: %.frag
	$(QSB) $(QSB_FLAGS) -o $@ $<

# Install into the user's Plasma wallpaper package directory.  Use
# --upgrade when the package is already installed.
install: shader
	kpackagetool6 --type Plasma/Wallpaper --install . || \
	kpackagetool6 --type Plasma/Wallpaper --upgrade .

# Visual smoke test (optional; needs a GL context).
# Note: QT_QPA_PLATFORM=offscreen cannot create a GL context here and yields
# a fully transparent image, so use a virtual X server instead.
smoke: shader
	mkdir -p /tmp/opencode/shader_smoke
	xvfb-run -a env QSG_RHI_BACKEND=opengl qml6 tests/shader_smoke.qml

# Render the four principal phases with the real textures into
# /tmp/opencode/moon_preview/ (contact_sheet.png + one PNG per phase).
preview: shader
	mkdir -p /tmp/opencode/moon_preview
	xvfb-run -a env QSG_RHI_BACKEND=opengl qml6 tests/preview.qml

# Render the complete 1920x1080 scene at four seasonal checkpoints into
# /tmp/opencode/full_wallpaper/.
preview-full: shader
	mkdir -p /tmp/opencode/full_wallpaper
	xvfb-run -a env QSG_RHI_BACKEND=opengl qml6 tests/render_full_wallpaper.qml

# Pure-JS ephemeris tests (no Qt required).
test:
	node tests/test_astronomy.mjs
	node tests/test_earth_orbit.mjs
	node tests/test_hijri.mjs
	node tests/test_prayer.mjs

clean:
	rm -f $(QSB_OUTS)

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

# KDE Store artifact: the KPackage root (metadata, license, contents), with
# the prebuilt .qsb shader packs, so users never need qsb installed.
PACKAGE_ID      := io.github.hadealahmad.moonphase
PACKAGE_VERSION := $(shell sed -n 's/^[[:space:]]*"Version": "\([^"]*\)".*/\1/p' metadata.json | head -n 1)
PACKAGE_DIR     := build/package
PACKAGE_TARBALL := build/$(PACKAGE_ID)-$(PACKAGE_VERSION).tar.gz

ifeq ($(strip $(PACKAGE_VERSION)),)
$(error Could not read KPlugin.Version from metadata.json)
endif

.PHONY: all shader install package package-test clean smoke preview preview-full test

all: shader

shader: $(QSB_OUTS)

%.frag.qsb: %.frag
	$(QSB) $(QSB_FLAGS) -o $@ $<

# Install the same clean archive that is uploaded to the KDE Store.  Use
# --upgrade when the package is already installed.
install: package
	kpackagetool6 --type Plasma/Wallpaper --install $(PACKAGE_TARBALL) || \
	kpackagetool6 --type Plasma/Wallpaper --upgrade $(PACKAGE_TARBALL)

# Build the archive for a KDE Store "Plasma 6 Wallpaper Plugins" product.
package: shader
	rm -rf $(PACKAGE_DIR)
	mkdir -p $(PACKAGE_DIR)
	cp metadata.json LICENSE $(PACKAGE_DIR)/
	cp -a contents $(PACKAGE_DIR)/
	tar -C $(PACKAGE_DIR) -czf $(PACKAGE_TARBALL) metadata.json LICENSE contents
	@echo "KDE Store package: $(PACKAGE_TARBALL)"

# Install the generated archive into a throwaway prefix, exactly like KNewStuff.
package-test: package
	rm -rf build/test-data
	XDG_DATA_HOME="$(CURDIR)/build/test-data" \
		kpackagetool6 --type Plasma/Wallpaper --install $(PACKAGE_TARBALL)

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
	rm -rf build

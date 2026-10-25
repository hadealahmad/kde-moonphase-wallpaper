/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Renders a single-line string curved along a circular arc centered at
    (centerX, centerY) with radius arcRadius. `arcSide` selects the bottom
    (default) or the mirrored top arc.

    Latin text and punctuation are laid out glyph by glyph with proportional
    per-glyph advance widths so kerning remains natural around the curve.
    Arabic words are kept as whole items because Qt must shape and join their
    letters; splitting them per character would break the script. Mixed
    strings are split into words, reordered for the base direction, and the
    Arabic runs are mirrored to their bidi visual order.
*/

import QtQuick

import org.kde.kirigami as Kirigami

Item {
    id: root

    property string text: ""
    property string arcSide: "bottom"      // "bottom" | "top"
    property string textDirection: "auto"  // "auto" | "ltr" | "rtl"
    property real centerX: width * 0.5
    property real centerY: height * 0.5
    property real arcRadius: width * 0.5
    property color color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
    property string fontFamily: Kirigami.Theme.defaultFont.family
    property int pixelSize: 10
    property int fontWeight: Font.Light
    property real letterSpacing: 1.0
    property int textStyle: Text.Normal
    property color styleColor: Qt.rgba(0.0, 0.0, 0.0, 0.25)

    /* Layout atoms, already in visual (left-to-right) order. */
    readonly property var atoms: root.buildAtoms(root.text, root.textDirection)

    onTextChanged: Qt.callLater(root.layoutGlyphs)
    onAtomsChanged: Qt.callLater(root.layoutGlyphs)
    onArcSideChanged: root.layoutGlyphs()
    onCenterXChanged: root.layoutGlyphs()
    onCenterYChanged: root.layoutGlyphs()
    onArcRadiusChanged: root.layoutGlyphs()
    onPixelSizeChanged: Qt.callLater(root.layoutGlyphs)
    onLetterSpacingChanged: root.layoutGlyphs()
    Component.onCompleted: root.layoutGlyphs()

    readonly property var arabicPattern: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
    readonly property var digitPattern: /[0-9\u0660-\u0669\u06F0-\u06F9]/
    readonly property var latinPattern: /[A-Za-z\u00C0-\u024F]/

    function classifyWord(word) {
        /* Arabic-Indic digits live inside the Arabic block, so digits are
           tested first: a purely numeric token stays a single LTR atom. */
        if (root.digitPattern.test(word) && !root.arabicPattern.test(word)) {
            return "num";
        }
        if (root.arabicPattern.test(word)) {
            return "ar";
        }
        if (root.digitPattern.test(word) && !root.latinPattern.test(word)) {
            return "num";
        }
        return "other";
    }

    function splitUnits(value) {
        var units = [];
        var i = 0;
        while (i < value.length) {
            if (/\s/.test(value.charAt(i))) {
                units.push({ text: value.charAt(i), cls: "space" });
                ++i;
                continue;
            }
            var j = i;
            while (j < value.length && !/\s/.test(value.charAt(j))) {
                ++j;
            }
            var word = value.slice(i, j);
            units.push({ text: word, cls: root.classifyWord(word) });
            i = j;
        }
        return units;
    }

    function isRtlRunPart(unit) {
        return unit.cls === "ar" || unit.cls === "num" || unit.cls === "space";
    }

    function baseDirection(units) {
        for (var i = 0; i < units.length; ++i) {
            if (units[i].cls === "ar") {
                return "rtl";
            }
            if (units[i].cls === "other") {
                return "ltr";
            }
        }
        return "ltr";
    }

    function reorderUnits(units, direction) {
        if (direction === "rtl") {
            return units.slice().reverse();
        }

        /* LTR base: reverse only runs that contain Arabic, keeping the
           boundary spaces in place so separators do not jump sides. */
        var out = [];
        var i = 0;
        while (i < units.length) {
            if (!root.isRtlRunPart(units[i])) {
                out.push(units[i]);
                ++i;
                continue;
            }

            var j = i;
            var hasArabic = false;
            while (j < units.length && root.isRtlRunPart(units[j])) {
                if (units[j].cls === "ar") {
                    hasArabic = true;
                }
                ++j;
            }

            if (hasArabic) {
                var start = i;
                var end = j;
                while (start < end && units[start].cls === "space") {
                    ++start;
                }
                while (end > start && units[end - 1].cls === "space") {
                    --end;
                }
                for (var lead = i; lead < start; ++lead) {
                    out.push(units[lead]);
                }
                for (var k = end - 1; k >= start; --k) {
                    out.push(units[k]);
                }
                for (var trail = end; trail < j; ++trail) {
                    out.push(units[trail]);
                }
            } else {
                for (var keep = i; keep < j; ++keep) {
                    out.push(units[keep]);
                }
            }
            i = j;
        }
        return out;
    }

    function buildAtoms(value, direction) {
        if (!value) {
            return [];
        }

        var units = root.splitUnits(value);
        var resolved = (direction === "auto") ? root.baseDirection(units) : direction;
        var ordered = root.reorderUnits(units, resolved);

        var atoms = [];
        for (var i = 0; i < ordered.length; ++i) {
            var unit = ordered[i];
            if (unit.cls === "ar" || unit.cls === "num") {
                atoms.push({ text: unit.text });
            } else {
                for (var c = 0; c < unit.text.length; ++c) {
                    atoms.push({ text: unit.text.charAt(c) });
                }
            }
        }
        return atoms;
    }

    function atomAdvance(item, atom) {
        if (item && item.implicitWidth > 0) {
            return item.implicitWidth + root.letterSpacing;
        }
        var value = atom ? atom.text : " ";
        if (value === " ") {
            return root.pixelSize * 0.34 + root.letterSpacing;
        }
        return root.pixelSize * 0.60 * value.length + root.letterSpacing;
    }

    function layoutGlyphs() {
        var count = glyphRepeater.count;
        if (count === 0 || root.arcRadius <= 1.0) {
            return;
        }

        var advances = [];
        var totalArc = 0.0;
        for (var i = 0; i < count; ++i) {
            var item = glyphRepeater.itemAt(i);
            var atom = root.atoms[i];
            var adv = root.atomAdvance(item, atom);
            advances.push(adv);
            totalArc += adv;
        }
        if (count > 1) {
            totalArc -= root.letterSpacing;
        }

        var topArc = (root.arcSide === "top");
        var cursor = -totalArc * 0.5;
        for (var j = 0; j < count; ++j) {
            var glyph = glyphRepeater.itemAt(j);
            var w = advances[j];
            if (glyph) {
                var s = cursor + (w - root.letterSpacing) * 0.5;
                var alpha = s / root.arcRadius;
                var gx = root.centerX + root.arcRadius * Math.sin(alpha);
                var gy = topArc
                         ? root.centerY - root.arcRadius * Math.cos(alpha)
                         : root.centerY + root.arcRadius * Math.cos(alpha);
                glyph.x = gx - glyph.width * 0.5;
                glyph.y = gy - glyph.height * 0.5;
                glyph.rotation = (topArc ? 1.0 : -1.0) * alpha * 180.0 / Math.PI;
            }
            cursor += w;
        }
    }

    Repeater {
        id: glyphRepeater

        model: root.atoms

        onItemAdded: root.layoutGlyphs()
        onItemRemoved: root.layoutGlyphs()

        delegate: Text {
            required property var modelData

            text: modelData.text
            color: root.color
            font.family: root.fontFamily
            font.pixelSize: root.pixelSize
            font.weight: root.fontWeight
            style: root.textStyle
            styleColor: root.styleColor
            wrapMode: Text.NoWrap
            transformOrigin: Item.Center

            onImplicitWidthChanged: root.layoutGlyphs()
            onImplicitHeightChanged: root.layoutGlyphs()
        }
    }
}

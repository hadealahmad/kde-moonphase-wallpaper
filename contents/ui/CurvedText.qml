/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Renders a single-line telemetry string curved along a circular bottom arc
    centered at (centerX, centerY) with radius arcRadius, using proportional
    per-glyph advance widths so kerning remains natural around the curve.
*/

import QtQuick

import org.kde.kirigami as Kirigami

Item {
    id: root

    property string text: ""
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

    readonly property var characters: root.text ? root.text.split("") : []

    onTextChanged: Qt.callLater(root.layoutGlyphs)
    onCenterXChanged: root.layoutGlyphs()
    onCenterYChanged: root.layoutGlyphs()
    onArcRadiusChanged: root.layoutGlyphs()
    onPixelSizeChanged: Qt.callLater(root.layoutGlyphs)
    onLetterSpacingChanged: root.layoutGlyphs()
    Component.onCompleted: root.layoutGlyphs()

    function glyphAdvance(item, ch) {
        if (item && item.implicitWidth > 0) {
            return item.implicitWidth + root.letterSpacing;
        }
        if (ch === " ") {
            return root.pixelSize * 0.34 + root.letterSpacing;
        }
        return root.pixelSize * 0.60 + root.letterSpacing;
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
            var ch = root.characters[i] || " ";
            var adv = root.glyphAdvance(item, ch);
            advances.push(adv);
            totalArc += adv;
        }
        if (count > 1) {
            totalArc -= root.letterSpacing;
        }

        var cursor = -totalArc * 0.5;
        for (var j = 0; j < count; ++j) {
            var glyph = glyphRepeater.itemAt(j);
            var w = advances[j];
            if (glyph) {
                var s = cursor + (w - root.letterSpacing) * 0.5;
                var alpha = s / root.arcRadius;
                var gx = root.centerX + root.arcRadius * Math.sin(alpha);
                var gy = root.centerY + root.arcRadius * Math.cos(alpha);
                glyph.x = gx - glyph.width * 0.5;
                glyph.y = gy - glyph.height * 0.5;
                glyph.rotation = -alpha * 180.0 / Math.PI;
            }
            cursor += w;
        }
    }

    Repeater {
        id: glyphRepeater

        model: root.characters

        onItemAdded: root.layoutGlyphs()
        onItemRemoved: root.layoutGlyphs()

        delegate: Text {
            required property string modelData

            text: modelData
            color: root.color
            font.family: root.fontFamily
            font.pixelSize: root.pixelSize
            font.weight: root.fontWeight
            style: root.textStyle
            styleColor: root.styleColor
            transformOrigin: Item.Center

            onImplicitWidthChanged: root.layoutGlyphs()
            onImplicitHeightChanged: root.layoutGlyphs()
        }
    }
}

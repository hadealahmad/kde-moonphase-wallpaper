/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Bottom-left flat top-down heliocentric orbit & seasons astrolabe widget.
*/

import QtQuick

import org.kde.kirigami as Kirigami

import "../code/style.js" as Style

Item {
    id: root

    // --- Data contract (filled by main.qml from astronomy.js) ---------------
    property real earthHelioLonRad: 0.0
    property real jan1HelioLonRad: 1.754
    property real yearProgress: 0.0
    property real orbitTiltRad: 0.0
    property real axialTiltRad: 0.4091
    property bool showGhostEarths: true
    property bool showTelemetry: true

    property string seasonName: "Winter"
    property int dayOfYear: 1
    property int daysInYear: 365

    // --- Geometry (flat circular top-down projection) -----------------------
    readonly property real orbitRadius: width * 0.36
    readonly property real labelSize: Style.labelSize(width)
    readonly property real captionSize: Style.captionSize(width)
    readonly property bool compact: width < Style.COMPACT_WIDTH

    // Season labels clear the hollow station rings (r = 0.017w in orbit.frag)
    // by a fixed pixel gap at every widget size.
    readonly property real seasonLabelRadius: root.orbitRadius + root.width * 0.024 + 3

    implicitWidth: 230
    implicitHeight: Math.round(width * 1.08)

    function pointAt(theta) {
        return Qt.point(root.width * 0.5 + root.orbitRadius * Math.cos(theta),
                        root.width * 0.5 - root.orbitRadius * Math.sin(theta));
    }

    function labelPointAt(theta, factor) {
        return Qt.point(root.width * 0.5 + root.orbitRadius * factor * Math.cos(theta),
                        root.width * 0.5 - root.orbitRadius * factor * Math.sin(theta));
    }

    ShaderEffect {
        id: orbitShader

        width: root.width
        height: root.width

        property real earthHelioLonRad: root.earthHelioLonRad
        property real jan1HelioLonRad: root.jan1HelioLonRad
        property real yearProgress: root.yearProgress
        property real orbitTiltRad: root.orbitTiltRad
        property real axialTiltRad: root.axialTiltRad
        property real showGhostEarths: root.showGhostEarths ? 1.0 : 0.0

        fragmentShader: Qt.resolvedUrl("../shaders/orbit.frag.qsb")
    }

    // Season labels at all four cardinal orbital points around the flat ring.
    Repeater {
        model: [
            { "label": "MAR", "angle": 0.0 },
            { "label": "JUN", "angle": Math.PI * 0.5 },
            { "label": "SEP", "angle": Math.PI },
            { "label": "DEC", "angle": Math.PI * 1.5 }
        ]

        delegate: Text {
            required property var modelData

            readonly property point origin: Style.labelOrigin(root.width * 0.5, root.width * 0.5,
                                                              root.seasonLabelRadius, modelData.angle,
                                                              width, height)

            x: origin.x
            y: origin.y

            text: modelData.label
            color: Style.ink(Style.LABEL_ALPHA)
            font.family: Kirigami.Theme.defaultFont.family
            font.pixelSize: root.labelSize
            font.weight: Font.Medium
            font.letterSpacing: Style.labelTracking(root.labelSize)
        }
    }

    // Subtle Jan 1 reference marker just inside the ring.
    Text {
        readonly property point jan1Point: root.labelPointAt(root.jan1HelioLonRad, 0.72)

        x: jan1Point.x - width * 0.5
        y: jan1Point.y - height * 0.5

        text: "JAN 1"
        color: Style.accent(Style.MINOR_ALPHA)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: Style.minorSize(root.width)
        font.weight: Font.Medium
        font.letterSpacing: Style.labelTracking(Style.minorSize(root.width))
    }

    CurvedText {
        id: caption

        anchors.fill: parent
        visible: root.showTelemetry
        centerX: root.width * 0.5
        centerY: root.width * 0.5
        // Seated outside the DEC season label so the two never touch.
        arcRadius: Math.max(root.width * Style.CAPTION_RADIUS,
                            root.seasonLabelRadius + root.labelSize * 1.2 + root.captionSize * 0.7)

        text: root.compact
              ? root.seasonName.toUpperCase() + "  \u2022  " + root.dayOfYear + "/" + root.daysInYear
              : root.seasonName.toUpperCase()
                + "  \u2022  DAY " + root.dayOfYear + " / " + root.daysInYear
                + "  \u2022  " + (root.yearProgress * 100).toFixed(1) + "%"

        color: Style.ink(Style.CAPTION_ALPHA)
        pixelSize: root.captionSize
        fontWeight: Font.Normal
        letterSpacing: Style.captionTracking(root.captionSize)
    }
}

/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Bottom-left flat top-down heliocentric orbit & seasons astrolabe widget.
*/

import QtQuick

import org.kde.kirigami as Kirigami

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
    readonly property real labelSize: Math.max(7, Math.round(width * 0.039))
    readonly property real captionSize: Math.max(7, Math.round(width * 0.040))

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

        layer.enabled: true
        layer.smooth: true

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
            { "label": "MAR", "angle": 0.0,           "factor": 1.21 },
            { "label": "JUN", "angle": Math.PI * 0.5, "factor": 1.21 },
            { "label": "SEP", "angle": Math.PI,       "factor": 1.21 },
            { "label": "DEC", "angle": Math.PI * 1.5, "factor": 1.21 }
        ]

        delegate: Text {
            required property var modelData

            readonly property point labelPoint: root.labelPointAt(modelData.angle, modelData.factor)

            x: labelPoint.x - width * 0.5
            y: labelPoint.y - height * 0.5

            text: modelData.label
            color: Qt.rgba(0.86, 0.88, 0.92, 0.48)
            font.family: Kirigami.Theme.defaultFont.family
            font.pixelSize: root.labelSize
            font.letterSpacing: 0.8
        }
    }

    // Jan 1 start/end marker label, placed inside the orbit ring so it never
    // collides with the outer DEC label.
    Text {
        id: jan1Label

        readonly property point anchorPoint: root.labelPointAt(root.jan1HelioLonRad, 0.68)

        x: anchorPoint.x - width * 0.5
        y: anchorPoint.y - height * 0.5

        text: "JAN 1"
        color: Qt.rgba(0.95, 0.89, 0.74, 0.72)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: Math.max(7, root.labelSize - 1)
        font.letterSpacing: 0.6
    }

    CurvedText {
        id: caption

        anchors.fill: parent
        visible: root.showTelemetry
        centerX: root.width * 0.5
        centerY: root.width * 0.5
        arcRadius: root.width * 0.518

        text: root.seasonName.toUpperCase()
              + "  \u2022  DAY " + root.dayOfYear + " / " + root.daysInYear
              + "  \u2022  " + (root.yearProgress * 100).toFixed(1) + "%"

        color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
        fontFamily: Kirigami.Theme.defaultFont.family
        pixelSize: root.captionSize
        fontWeight: Font.Light
        letterSpacing: 1.0
    }
}

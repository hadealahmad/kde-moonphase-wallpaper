/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Bottom-left heliocentric orbit & seasons widget.
*/

import QtQuick

import org.kde.kirigami as Kirigami

Item {
    id: root

    // --- Data contract (filled by main.qml from astronomy.js) ---------------
    property real earthHelioLonRad: 0.0
    property real jan1HelioLonRad: 1.754
    property real yearProgress: 0.0
    property real orbitTiltRad: 0.95
    property real axialTiltRad: 0.4091
    property bool showGhostEarths: true

    property string seasonName: "Winter"
    property int dayOfYear: 1
    property int daysInYear: 365

    // --- Geometry -----------------------------------------------------------
    readonly property real orbitRadiusX: width * 0.36
    readonly property real orbitRadiusY: width * 0.36 * Math.cos(root.orbitTiltRad)
    readonly property real labelSize: Math.max(7, Math.round(width * 0.042))
    readonly property real captionSize: Math.max(7, Math.round(width * 0.040))

    implicitWidth: 230
    implicitHeight: width + caption.height + Math.round(width * 0.02)

    function pointAt(theta) {
        return Qt.point(root.width * 0.5 + root.orbitRadiusX * Math.cos(theta),
                        root.width * 0.5 - root.orbitRadiusY * Math.sin(theta));
    }

    // Labels are pushed slightly away from the orbit line: the cardinal
    // season names sit outside the ring, the Jan 1 marker sits inside it.
    // This keeps DEC and JAN 1 (only ~10 degrees apart) from overlapping and
    // leaves the active Earth visible on the ring.
    function labelPointAt(theta, factor) {
        return Qt.point(root.width * 0.5 + root.orbitRadiusX * factor * Math.cos(theta),
                        root.width * 0.5 - root.orbitRadiusY * factor * Math.sin(theta));
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

    // Season labels at the four cardinal orbital points.
    Repeater {
        model: [
            { "label": "MAR", "angle": 0.0, "factor": 1.26 },
            { "label": "JUN", "angle": Math.PI * 0.5, "factor": 1.40 },
            { "label": "SEP", "angle": Math.PI, "factor": 1.26 }
            // DEC is intentionally unlabelled: the JAN 1 marker sits next to
            // it and the two labels would collide at 230 px.
        ]

        delegate: Text {
            required property var modelData

            readonly property point labelPoint: root.labelPointAt(modelData.angle, modelData.factor)

            x: labelPoint.x - width * 0.5
            y: labelPoint.y - height * 0.5

            text: modelData.label
            color: Qt.rgba(0.72, 0.82, 1.0, 0.45)
            font.family: Kirigami.Theme.defaultFont.family
            font.pixelSize: root.labelSize
            font.letterSpacing: 0.6
        }
    }

    // Jan 1 start/end marker label, placed on the orbit itself.
    Text {
        id: jan1Label

        readonly property point anchorPoint: root.labelPointAt(root.jan1HelioLonRad, 0.60)

        x: anchorPoint.x - width * 0.5
        y: anchorPoint.y - height * 0.5

        text: "JAN 1"
        color: Qt.rgba(1.0, 0.84, 0.52, 0.85)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: root.labelSize
        font.letterSpacing: 0.6
    }

    Text {
        id: caption

        anchors.top: orbitShader.bottom
        anchors.topMargin: Math.round(root.width * 0.02)
        width: root.width
        horizontalAlignment: Text.AlignHCenter

        text: root.seasonName.toUpperCase()
              + "  \u2022  DAY " + root.dayOfYear + " / " + root.daysInYear
              + "  \u2022  " + (root.yearProgress * 100).toFixed(1) + "% OF YEAR"

        color: Qt.rgba(0.78, 0.86, 1.0, 0.62)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: root.captionSize
        font.weight: Font.Light
        font.letterSpacing: 0.5
    }
}

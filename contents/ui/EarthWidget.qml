/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Bottom-right observer-centered day/night Earth globe.
*/

import QtQuick

import org.kde.kirigami as Kirigami

Item {
    id: root

    // --- Data contract (filled by main.qml from astronomy.js) ---------------
    property vector3d sunVectorWorld: Qt.vector3d(1.0, 0.0, 0.0)
    property real observerLatDeg: 30.0
    property real observerLonDeg: 31.2
    property real localSolarTimeHours: 12.0
    property real nightLightsBoost: 1.1
    property real atmosphereIntensity: 0.75
    property bool showObserverPin: true

    readonly property real observerLatRad: root.observerLatDeg * Math.PI / 180.0
    readonly property real observerLonRad: root.observerLonDeg * Math.PI / 180.0

    readonly property real captionSize: Math.max(7, Math.round(width * 0.040))

    implicitWidth: 230
    implicitHeight: width + caption.height + Math.round(width * 0.02)

    function formatLatitude(degrees) {
        return Math.abs(degrees).toFixed(1) + "\u00b0" + (degrees >= 0 ? "N" : "S");
    }

    function formatLongitude(degrees) {
        return Math.abs(degrees).toFixed(1) + "\u00b0" + (degrees >= 0 ? "E" : "W");
    }

    function formatSolarTime(hours) {
        var totalMinutes = Math.round(((hours % 24) + 24) % 24 * 60);
        var hh = Math.floor(totalMinutes / 60) % 24;
        var mm = totalMinutes % 60;
        return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    ShaderEffect {
        id: earthShader

        width: root.width
        height: root.width

        layer.enabled: true
        layer.smooth: true

        property vector3d sunVectorWorld: root.sunVectorWorld
        property real observerLatRad: root.observerLatRad
        property real observerLonRad: root.observerLonRad
        property real nightLightsBoost: root.nightLightsBoost
        property real atmosphereIntensity: root.atmosphereIntensity
        property real showObserverPin: root.showObserverPin ? 1.0 : 0.0

        property variant daySource: dayImage
        property variant nightSource: nightImage

        fragmentShader: Qt.resolvedUrl("../shaders/earth.frag.qsb")
    }

    Image {
        id: dayImage

        source: Qt.resolvedUrl("../images/earth_day.png")
        visible: false
        asynchronous: false
        mipmap: true
        smooth: true
        sourceSize: Qt.size(2048, 1024)
    }

    Image {
        id: nightImage

        source: Qt.resolvedUrl("../images/earth_night.jpg")
        visible: false
        asynchronous: false
        mipmap: true
        smooth: true
        sourceSize: Qt.size(2048, 1024)
    }

    Text {
        id: caption

        anchors.top: earthShader.bottom
        anchors.topMargin: Math.round(root.width * 0.02)
        width: root.width
        horizontalAlignment: Text.AlignHCenter

        text: root.formatLatitude(root.observerLatDeg)
              + ", " + root.formatLongitude(root.observerLonDeg)
              + "  \u2022  SOLAR " + root.formatSolarTime(root.localSolarTimeHours)

        color: Qt.rgba(0.78, 0.86, 1.0, 0.62)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: root.captionSize
        font.weight: Font.Light
        font.letterSpacing: 0.5
    }
}

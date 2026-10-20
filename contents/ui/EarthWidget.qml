/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Bottom-right observer-centered day/night Earth globe with NASA GEBCO
    topography + bathymetry normal relief and Render-and-Evict VRAM caching.
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
    property bool showTelemetry: true

    // --- Render-and-Evict state ---------------------------------------------
    // Keeps the source 1024x512 textures loaded only while rendering a frame,
    // then locks earthCache (ShaderEffectSource) and evicts the source textures
    // from RAM and VRAM during the 15-minute idle interval.
    property bool texturesLoaded: true
    property bool cacheLocked: false

    readonly property real observerLatRad: root.observerLatDeg * Math.PI / 180.0
    readonly property real observerLonRad: root.observerLonDeg * Math.PI / 180.0
    readonly property real captionSize: Math.max(7, Math.round(width * 0.040))
    readonly property bool texturesReady: dayImage.status === Image.Ready
                                          && normalImage.status === Image.Ready

    implicitWidth: 230
    implicitHeight: Math.round(width * 1.12)

    function requestRender() {
        if (!root.visible) {
            return;
        }
        unloadTimer.stop();
        root.texturesLoaded = true;
        if (root.texturesReady) {
            root.cacheLocked = false;
            evictTimer.restart();
        }
    }

    onSunVectorWorldChanged: root.requestRender()
    onObserverLatDegChanged: root.requestRender()
    onObserverLonDegChanged: root.requestRender()
    onNightLightsBoostChanged: root.requestRender()
    onAtmosphereIntensityChanged: root.requestRender()
    onShowObserverPinChanged: root.requestRender()
    onWidthChanged: root.requestRender()
    onVisibleChanged: {
        if (root.visible) {
            root.requestRender();
        } else {
            evictTimer.stop();
            unloadTimer.stop();
            root.texturesLoaded = false;
        }
    }
    onTexturesReadyChanged: {
        if (root.texturesReady && root.visible) {
            root.cacheLocked = false;
            evictTimer.restart();
        }
    }

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
        visible: false

        property vector3d sunVectorWorld: root.sunVectorWorld
        property real observerLatRad: root.observerLatRad
        property real observerLonRad: root.observerLonRad
        property real nightLightsBoost: root.nightLightsBoost
        property real atmosphereIntensity: root.atmosphereIntensity
        property real showObserverPin: root.showObserverPin ? 1.0 : 0.0

        property variant daySource: dayImage
        property variant normalSource: normalImage

        fragmentShader: Qt.resolvedUrl("../shaders/earth.frag.qsb")
    }

    ShaderEffectSource {
        id: earthCache

        width: root.width
        height: root.width
        sourceItem: earthShader
        hideSource: true
        smooth: true
        live: !root.cacheLocked && root.texturesReady
    }

    Timer {
        id: evictTimer
        interval: 1500
        repeat: false
        onTriggered: {
            if (root.texturesReady && root.width > 0) {
                earthCache.scheduleUpdate();
                root.cacheLocked = true;
                unloadTimer.restart();
            }
        }
    }

    Timer {
        id: unloadTimer
        interval: 60
        repeat: false
        onTriggered: {
            root.texturesLoaded = false;
        }
    }

    Image {
        id: dayImage

        source: (root.visible && root.texturesLoaded) ? Qt.resolvedUrl("../images/earth_day.png") : ""
        cache: false
        visible: false
        asynchronous: false
        mipmap: true
        smooth: true
        sourceSize: Qt.size(1024, 512)
    }

    Image {
        id: normalImage

        source: (root.visible && root.texturesLoaded) ? Qt.resolvedUrl("../images/earth_normal.png") : ""
        cache: false
        visible: false
        asynchronous: false
        mipmap: true
        smooth: true
        sourceSize: Qt.size(1024, 512)
    }

    CurvedText {
        id: caption

        anchors.fill: parent
        visible: root.showTelemetry
        centerX: root.width * 0.5
        centerY: root.width * 0.5
        arcRadius: root.width * 0.560

        text: root.formatLatitude(root.observerLatDeg) + ", "
              + root.formatLongitude(root.observerLonDeg)
              + "  \u2022  SOLAR " + root.formatSolarTime(root.localSolarTimeHours)

        color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
        pixelSize: root.captionSize
        fontWeight: Font.Normal
        letterSpacing: 0.7
    }
}

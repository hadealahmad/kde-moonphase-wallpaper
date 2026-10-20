/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Low-GPU seasonal background layer with smart FBO caching and throttled timer
    animation. Supports Concept 1 (Celestial Planisphere), Concept 3
    (Astrolabe & Seasonal Etchings), or Combined mode.
*/

import QtQuick

Item {
    id: root

    // --- Public contract ----------------------------------------------------
    // seasonIndex: -1 = Off (solid colour only), 0 = Spring, 1 = Summer,
    //              2 = Autumn, 3 = Winter.
    // styleMode:   0 = Celestial Planisphere & Star Chart (Concept 1)
    //              1 = Astrolabe & Seasonal Etchings (Concept 3)
    //              2 = Combined (Planisphere + Etchings)
    property color baseColor: "#05070d"
    property int seasonIndex: 3
    property int styleMode: 0
    property bool animate: true
    property real intensity: 0.65
    property int fps: 20
    property real moonIllumination: 0.5
    property real resolutionScale: 1.0
    property real time: 0.0

    readonly property bool shaderActive: root.seasonIndex >= 0 && root.intensity > 0.001

    // --- Solid fallback -----------------------------------------------------
    Rectangle {
        anchors.fill: parent
        color: root.baseColor
        visible: !root.shaderActive
    }

    // --- Seasonal shader ----------------------------------------------------
    ShaderEffect {
        id: backgroundShader

        anchors.fill: parent
        visible: root.shaderActive

        // Only allocate a full-screen FBO when static (!root.animate). When
        // animating, rendering directly to the backbuffer avoids allocating
        // 15–33 MB of full-screen offscreen VRAM and saves a full-screen blit.
        layer.enabled: root.shaderActive && !root.animate
        layer.smooth: true
        layer.textureSize: Qt.size(Math.max(1, Math.round(root.width * root.resolutionScale)),
                                   Math.max(1, Math.round(root.height * root.resolutionScale)))

        // Uniform names must match the UBO in contents/shaders/background.frag.
        property color baseColor: root.baseColor
        property real seasonIndex: Math.max(0, root.seasonIndex)
        property real time: root.time
        property real aspectRatio: root.height > 0 ? root.width / root.height : 1.7778
        property real intensity: root.intensity
        property real moonIllumination: root.moonIllumination
        property real styleMode: root.styleMode

        fragmentShader: Qt.resolvedUrl("../shaders/background.frag.qsb")
    }

    // --- Throttled animation ------------------------------------------------
    Timer {
        id: animTimer

        readonly property int clampedFps: Math.max(5, Math.min(30, root.fps))

        interval: Math.round(1000 / clampedFps)
        running: root.shaderActive && root.animate && root.visible && Qt.application.state === Qt.ApplicationActive
        repeat: true

        onTriggered: {
            root.time = (root.time + animTimer.interval * 0.001) % 3600.0;
        }
    }
}

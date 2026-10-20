/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Low-GPU seasonal background layer with half-resolution FBO caching
    and throttled timer animation.
*/

import QtQuick

Item {
    id: root

    // --- Public contract ----------------------------------------------------
    // seasonIndex: -1 = Off (solid colour only), 0 = Spring, 1 = Summer,
    //              2 = Autumn, 3 = Winter.
    property color baseColor: "#05070d"
    property int seasonIndex: 3
    property bool animate: true
    property real intensity: 0.65
    property int fps: 20
    property real moonIllumination: 0.5
    property real resolutionScale: 0.5
    property real time: 0.0

    readonly property bool shaderActive: root.seasonIndex >= 0 && root.intensity > 0.001

    // --- Solid fallback -----------------------------------------------------
    // Shown when the shader is off (or unavailable); also the colour the
    // shader blends towards at low intensity.
    Rectangle {
        anchors.fill: parent
        color: root.baseColor
        visible: !root.shaderActive
    }

    // --- Seasonal shader ----------------------------------------------------
    // Rendered into a half-resolution offscreen texture and upscaled smoothly.
    // On a 2560x1440 panel that is ~1.8 MP of fragment work instead of ~3.7 MP,
    // and the layer is cached so a static scene costs no GPU time at all.
    ShaderEffect {
        id: backgroundShader

        anchors.fill: parent
        visible: root.shaderActive

        layer.enabled: root.shaderActive
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

        fragmentShader: Qt.resolvedUrl("../shaders/background.frag.qsb")
    }

    // --- Throttled animation ------------------------------------------------
    // Deliberately a Timer rather than a frame-driven animation: the clock
    // advances at `fps` (clamped to 5..30) and only while the widget is
    // actually on screen and the application is active.
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

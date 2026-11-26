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

    // Moon disc diameter in pixels; drives the soft lunar halo (0 disables it).
    property real moonDiameter: 0.0

    // Strength of the atmospheric touches (0 = off, 1 = reference, 2 = max).
    property real milkyWayIntensity: 1.0
    property real haloIntensity: 1.0
    property real vignetteStrength: 1.0

    // Corner instrument layout, mirrored from main.qml so the sky can be
    // quietened behind each enabled widget. Bottom widgets are 1.08x taller
    // than wide with the dial on top, so their dial centre sits higher.
    property int cornerSize: 230
    property int cornerMargin: 36
    property bool plateTopRight: false
    property bool plateBottomLeft: false
    property bool plateBottomRight: false

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

        // Only allocate an offscreen FBO when sub-native resolution scaling
        // (resolutionScale < 0.99) is requested. At default 1.0x scale, rendering
        // the procedural quad directly into the scene graph avoids ~34-49 MB of
        // full-screen FBO + depth/stencil VRAM overhead at 1440p/4K.
        layer.enabled: root.shaderActive && root.resolutionScale < 0.99
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
        property real milkyWayIntensity: root.milkyWayIntensity
        property real haloIntensity: root.haloIntensity
        property real vignetteStrength: root.vignetteStrength
        property real moonRadius: root.height > 0 ? root.moonDiameter * 0.5 / root.height : 0.0
        property vector4d cornerPlate: root.height > 0
            ? Qt.vector4d(0.5 * root.width / root.height - (root.cornerMargin + root.cornerSize * 0.5) / root.height,
                          0.5 - (root.cornerMargin + root.cornerSize * 0.5) / root.height,
                          -0.5 + (root.cornerMargin + root.cornerSize * 0.58) / root.height,
                          root.cornerSize * 0.57 / root.height)
            : Qt.vector4d(0, 0, 0, 0)
        property vector4d cornerMask: Qt.vector4d(root.plateTopRight ? 1 : 0,
                                                  root.plateBottomLeft ? 1 : 0,
                                                  root.plateBottomRight ? 1 : 0,
                                                  0)

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

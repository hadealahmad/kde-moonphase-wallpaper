/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Standalone preview harness for the moon phase shader.

    Renders the four principal phases with the real packed texture and writes
    one contact sheet plus four individual PNGs.

    Run:
        xvfb-run -a qml6 tests/preview.qml
    (QT_QPA_PLATFORM=offscreen cannot create a GL context on all systems.)
*/

import QtQuick
import QtQuick.Window

pragma ComponentBehavior: Bound

Window {
    id: window

    width: 1120
    height: 1140
    visible: true
    color: "#05070d"
    title: "Moon Phase shader preview"

    readonly property string outputDir: "file:///tmp/opencode/moon_preview/"

    readonly property var phases: [
        { name: "NEW MOON", phase: 0.0 },
        { name: "FIRST QUARTER", phase: 0.25 },
        { name: "FULL MOON", phase: 0.5 },
        { name: "LAST QUARTER", phase: 0.75 }
    ]

    function sunDirectionFor(phase) {
        const angle = 2.0 * Math.PI * phase;
        return Qt.vector3d(Math.sin(angle), 0.0, -Math.cos(angle));
    }

    Image {
        id: normalImage

        source: Qt.resolvedUrl("../contents/images/moon_normal.png")
        visible: false
        asynchronous: false
        mipmap: true
        smooth: true
    }

    Item {
        id: scene

        anchors.fill: parent
        anchors.margins: 20

        Grid {
            anchors.centerIn: parent
            columns: 2
            spacing: 12

            Repeater {
                id: phaseRepeater

                model: window.phases

                delegate: Item {
                    id: tile

                    required property var modelData
                    required property int index

                    readonly property vector3d lightDirection: window.sunDirectionFor(tile.modelData.phase)

                    width: 530
                    height: 530

                    Rectangle {
                        anchors.fill: parent
                        color: "#05070d"
                    }

                    ShaderEffect {
                        id: effect

                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.top: parent.top
                        anchors.topMargin: 6

                        width: 470
                        height: 470

                        layer.enabled: true
                        layer.smooth: true

                        property vector3d sunDirection: tile.lightDirection
                        property vector2d libration: Qt.vector2d(0.0, 0.0)
                        property real earthshine: 0.035
                        property real normalStrength: 1.2
                        property real rollAngleRad: 0.0
                        property real usePackedAlbedo: 1.0

                        property variant albedoSource: normalImage
                        property variant normalSource: normalImage

                        fragmentShader: Qt.resolvedUrl("../contents/shaders/moon.frag.qsb")
                    }

                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.top: effect.bottom
                        anchors.topMargin: 4

                        text: tile.modelData.name
                        color: Qt.rgba(1.0, 1.0, 1.0, 0.6)
                        font.pixelSize: 14
                        font.letterSpacing: 1.5
                    }
                }
            }
        }
    }

    property int grabIndex: 0

    function grabNextTile() {
        if (window.grabIndex >= window.phases.length) {
            scene.grabToImage(function (sheet) {
                const okSheet = sheet.saveToFile(window.outputDir + "contact_sheet.png");
                console.log("moonphase preview:", window.outputDir + "contact_sheet.png",
                            okSheet ? "saved" : "FAILED");
                Qt.quit();
            });
            return;
        }

        const index = window.grabIndex;
        const phase = window.phases[index];
        const tile = phaseRepeater.itemAt(index);

        if (!tile) {
            console.log("moonphase preview: missing tile", index);
            window.grabIndex = index + 1;
            grabDelay.start();
            return;
        }

        tile.grabToImage(function (result) {
            const path = window.outputDir + "phase_"
                         + String(index).padStart(1, "0") + "_"
                         + phase.name.toLowerCase().replace(/ /g, "_") + ".png";
            const ok = result.saveToFile(path);
            console.log("moonphase preview:", path, ok ? "saved" : "FAILED");
            window.grabIndex = index + 1;
            grabDelay.start();
        });
    }

    Timer {
        id: settleTimer

        interval: 2500
        running: true
        repeat: false

        onTriggered: window.grabNextTile()
    }

    Timer {
        id: grabDelay

        interval: 350
        repeat: false

        onTriggered: window.grabNextTile()
    }
}

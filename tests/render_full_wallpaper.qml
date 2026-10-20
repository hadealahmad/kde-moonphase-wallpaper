/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Full-wallpaper QA harness: renders the moon plus both corner widgets at
    four seasonal / time-of-day checkpoints into /tmp/opencode/full_wallpaper.

    Run:
        xvfb-run -a env QSG_RHI_BACKEND=opengl qml6 tests/render_full_wallpaper.qml
*/

import QtQuick
import QtQuick.Window

import "../contents/ui"
import "../contents/ui" as UI
import "../contents/code/astronomy.js" as Astronomy

Window {
    id: window

    width: 1920
    height: 1080
    visible: true
    color: "#05070d"
    title: "Moon Phase - full wallpaper QA"

    readonly property string outputDir: "file:///tmp/opencode/full_wallpaper/"
    readonly property string backgroundColor: "#05070d"
    readonly property real observerLat: 30.0
    readonly property real observerLon: 31.2

    readonly property var checkpoints: [
        {
            "name": "Winter - Jan 1 - 12:00 UTC",
            "file": "01_winter_jan1.png",
            "date": new Date(Date.UTC(2026, 0, 1, 12, 0, 0))
        },
        {
            "name": "Spring - Apr 15 - 12:00 UTC",
            "file": "02_spring_blossoms.png",
            "date": new Date(Date.UTC(2026, 3, 15, 12, 0, 0))
        },
        {
            "name": "Summer - June Solstice - 08:24 UTC",
            "file": "03_summer_clouds.png",
            "date": new Date(Date.UTC(2026, 5, 21, 8, 24, 0))
        },
        {
            "name": "Autumn - Oct 19 - 19:00 UTC (local evening)",
            "file": "04_autumn_leaves.png",
            "date": new Date(Date.UTC(2026, 9, 19, 19, 0, 0))
        }
    ]

    property var moonState: null
    property var orbitState: null
    property string checkpointName: ""
    property int checkpointIndex: 0

    function updateCheckpoint(index) {
        const checkpoint = window.checkpoints[index];
        window.checkpointName = checkpoint.name;
        window.moonState = Astronomy.getMoonState(checkpoint.date,
                                                  window.observerLat,
                                                  window.observerLon);
        window.orbitState = Astronomy.getEarthAndOrbitState(checkpoint.date,
                                                            window.observerLat,
                                                            window.observerLon);
    }

    function renderNext() {
        if (window.checkpointIndex >= window.checkpoints.length) {
            Qt.quit();
            return;
        }

        window.updateCheckpoint(window.checkpointIndex);
        settleTimer.restart();
    }

    function grabCheckpoint() {
        const checkpoint = window.checkpoints[window.checkpointIndex];

        scene.grabToImage(function (result) {
            const path = window.outputDir + checkpoint.file;
            const ok = result.saveToFile(path);
            console.log("moonphase QA:", checkpoint.name, "->", path, ok ? "saved" : "FAILED");
            window.checkpointIndex += 1;
            window.renderNext();
        });
    }

    Item {
        id: scene

        width: window.width
        height: window.height

        UI.BackgroundWidget {
            id: backgroundWidget

            anchors.fill: parent
            baseColor: window.backgroundColor
            seasonIndex: window.orbitState ? window.orbitState.observerSeasonIndex : 3
            animate: false
            time: 42.0
            intensity: 0.75
            moonIllumination: window.moonState ? window.moonState.illumination : 0.5
        }

        // --- Moon ----------------------------------------------------------
        Item {
            id: moonContainer

            width: Math.min(scene.width, scene.height) * 0.45
            height: width
            anchors.centerIn: parent

            ShaderEffect {
                anchors.fill: parent

                layer.enabled: true
                layer.smooth: true

                property vector3d sunDirection: window.moonState
                                                ? Qt.vector3d(window.moonState.sunDirection.x,
                                                              window.moonState.sunDirection.y,
                                                              window.moonState.sunDirection.z)
                                                : Qt.vector3d(0.0, 0.0, 1.0)
                property vector2d libration: window.moonState
                                             ? Qt.vector2d(window.moonState.librationLonRad,
                                                           window.moonState.librationLatRad)
                                             : Qt.vector2d(0.0, 0.0)
                property real earthshine: 0.035
                property real normalStrength: 1.2
                property real rollAngleRad: 0.0

                property variant albedoSource: albedoImage
                property variant normalSource: normalImage

                fragmentShader: Qt.resolvedUrl("../contents/shaders/moon.frag.qsb")
            }

            Image {
                id: albedoImage

                source: Qt.resolvedUrl("../contents/images/moon_albedo.jpg")
                visible: false
                asynchronous: false
                mipmap: true
                smooth: true
            }

            Image {
                id: normalImage

                source: Qt.resolvedUrl("../contents/images/moon_normal.png")
                visible: false
                asynchronous: false
                mipmap: true
                smooth: true
            }
        }

        OrbitWidget {
            width: 230
            height: implicitHeight

            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 36

            earthHelioLonRad: window.orbitState ? window.orbitState.earthHelioLonRad : 0.0
            jan1HelioLonRad: window.orbitState ? window.orbitState.jan1HelioLonRad : 1.754
            yearProgress: window.orbitState ? window.orbitState.yearProgress : 0.0
            showGhostEarths: true

            seasonName: window.orbitState
                ? (window.orbitState.observerSeasonName || window.orbitState.seasonNameNorth)
                : "Winter"
            dayOfYear: window.orbitState ? window.orbitState.dayOfYear : 1
            daysInYear: window.orbitState ? window.orbitState.daysInYear : 365
        }

        EarthWidget {
            width: 230
            height: implicitHeight

            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 36

            sunVectorWorld: window.orbitState && window.orbitState.sunVectorWorld
                            ? Qt.vector3d(window.orbitState.sunVectorWorld.x,
                                          window.orbitState.sunVectorWorld.y,
                                          window.orbitState.sunVectorWorld.z)
                            : Qt.vector3d(1.0, 0.0, 0.0)
            observerLatDeg: window.observerLat
            observerLonDeg: window.observerLon
            localSolarTimeHours: window.orbitState ? window.orbitState.localSolarTimeHours : 12.0
            nightLightsBoost: 3.2
            showObserverPin: true
        }

        Text {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.margins: 24

            text: window.checkpointName
            color: Qt.rgba(1.0, 1.0, 1.0, 0.35)
            font.pixelSize: 14
            font.letterSpacing: 1.0
        }
    }

    Timer {
        id: settleTimer

        interval: 700
        repeat: false

        onTriggered: window.grabCheckpoint()
    }

    Component.onCompleted: window.renderNext()
}

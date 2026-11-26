/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Layout QA harness: renders the full scene across a matrix of screen
    sizes, aspect ratios, Moon scales, corner widget sizes/margins and
    enabled-widget combinations into /tmp/opencode/layouts.

    The scene mirrors main.qml's layout (it cannot load the WallpaperItem
    itself outside plasmashell), so keep the two in step.

    Run:
        xvfb-run -a -s "-screen 0 3840x2160x24" \
            env QSG_RHI_BACKEND=opengl qml6 tests/render_layouts.qml
*/

import QtQuick
import QtQuick.Window

import "../contents/ui" as UI
import "../contents/code/astronomy.js" as Astronomy
import "../contents/code/hijri.js" as Hijri
import "../contents/code/prayer.js" as Prayer
import "../contents/code/style.js" as Style

Window {
    id: window

    width: 1280
    height: 720
    visible: true
    color: "#05070d"
    title: "Moon Phase - layout QA"

    readonly property string outputDir: "file:///tmp/opencode/layouts/"
    readonly property real observerLat: 30.0
    readonly property real observerLon: 31.2
    readonly property date sceneDate: new Date(Date.UTC(2026, 9, 19, 19, 0, 0))

    // w, h: screen; moon: MoonScale; size/margin: corner widgets;
    // o/e/p: orbit/earth/prayer enabled; t: captions; style: background style.
    readonly property var configs: [
        { "file": "01_1080p_default.png",        "w": 1920, "h": 1080, "moon": 0.45, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "02_1080p_small_tight.png",    "w": 1920, "h": 1080, "moon": 0.45, "size": 140, "margin": 16, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "03_1080p_large_loose.png",    "w": 1920, "h": 1080, "moon": 0.45, "size": 400, "margin": 96, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "04_1080p_big_moon.png",       "w": 1920, "h": 1080, "moon": 0.90, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "05_1080p_tiny_moon.png",      "w": 1920, "h": 1080, "moon": 0.15, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "06_768p_laptop.png",          "w": 1366, "h": 768,  "moon": 0.45, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "07_4k_default.png",           "w": 3840, "h": 2160, "moon": 0.45, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 },
        { "file": "08_ultrawide.png",            "w": 3440, "h": 1440, "moon": 0.45, "size": 300, "margin": 48, "o": true,  "e": true,  "p": true,  "t": true,  "style": 2 },
        { "file": "09_1610_etchings.png",        "w": 1920, "h": 1200, "moon": 0.55, "size": 260, "margin": 40, "o": true,  "e": true,  "p": true,  "t": true,  "style": 1 },
        { "file": "10_earth_only_no_text.png",   "w": 1920, "h": 1080, "moon": 0.45, "size": 230, "margin": 36, "o": false, "e": true,  "p": false, "t": false, "style": 0 },
        { "file": "11_no_widgets.png",           "w": 1920, "h": 1080, "moon": 0.45, "size": 230, "margin": 36, "o": false, "e": false, "p": false, "t": true,  "style": 0 },
        { "file": "12_portrait.png",             "w": 1080, "h": 1920, "moon": 0.45, "size": 230, "margin": 36, "o": true,  "e": true,  "p": true,  "t": true,  "style": 0 }
    ]

    property int index: 0
    property var cfg: window.configs[0]

    property var moonState: Astronomy.getMoonState(window.sceneDate, window.observerLat, window.observerLon)
    property var orbitState: Astronomy.getEarthAndOrbitState(window.sceneDate, window.observerLat, window.observerLon)
    property var hijriDate: Hijri.getHijriDate(window.sceneDate)
    property var prayerState: Prayer.getPrayerState(window.sceneDate, window.observerLat, window.observerLon, 3, 0)

    readonly property real moonSize: Math.min(scene.width, scene.height)
                                     * Math.max(0.15, Math.min(0.90, window.cfg.moon))

    function renderNext() {
        if (window.index >= window.configs.length) {
            Qt.quit();
            return;
        }
        window.cfg = window.configs[window.index];
        settleTimer.restart();
    }

    Item {
        id: scene

        width: window.cfg.w
        height: window.cfg.h

        UI.BackgroundWidget {
            anchors.fill: parent
            baseColor: "#05070d"
            seasonIndex: window.orbitState.observerSeasonIndex
            styleMode: window.cfg.style
            animate: false
            time: 42.0
            intensity: 0.65
            moonIllumination: window.moonState.illumination
            moonDiameter: window.moonSize
            cornerSize: window.cfg.size
            cornerMargin: window.cfg.margin
            plateTopRight: window.cfg.p
            plateBottomLeft: window.cfg.o
            plateBottomRight: window.cfg.e
        }

        Item {
            id: moonContainer

            width: window.moonSize
            height: width
            anchors.centerIn: parent

            ShaderEffect {
                anchors.fill: parent

                property vector3d sunDirection: Qt.vector3d(window.moonState.sunDirection.x,
                                                            window.moonState.sunDirection.y,
                                                            window.moonState.sunDirection.z)
                property vector2d libration: Qt.vector2d(window.moonState.librationLonRad,
                                                         window.moonState.librationLatRad)
                property real earthshine: 0.035
                property real normalStrength: 1.2
                property real rollAngleRad: 0.0
                property real usePackedAlbedo: 1.0
                property variant albedoSource: normalImage
                property variant normalSource: normalImage

                fragmentShader: Qt.resolvedUrl("../contents/shaders/moon.frag.qsb")
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

        UI.CurvedText {
            anchors.fill: parent
            visible: window.cfg.t && Style.moonCaptionFits(window.moonSize, scene.height, Style.moonCaptionSize(window.moonSize, scene.height))
            centerX: scene.width * 0.5
            centerY: scene.height * 0.5
            arcRadius: Style.moonCaptionRadius(window.moonSize, scene.height, Style.moonCaptionSize(window.moonSize, scene.height))
            text: window.moonState.phaseName.toUpperCase()
                  + "  •  " + (window.moonState.illumination * 100).toFixed(1) + "%"
                  + "  •  DAY " + window.moonState.ageDays.toFixed(1)
                  + "  •  " + window.hijriDate.weekdayName + " " + window.hijriDate.day
            color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
            pixelSize: Style.moonCaptionSize(window.moonSize, scene.height)
            fontWeight: Font.Light
            letterSpacing: Math.max(1.2, window.moonSize * 0.004)
        }

        UI.CurvedText {
            anchors.fill: parent
            visible: window.cfg.t && Style.moonCaptionFits(window.moonSize, scene.height, Style.moonCaptionSize(window.moonSize, scene.height))
            centerX: scene.width * 0.5
            centerY: scene.height * 0.5
            arcRadius: Style.moonCaptionRadius(window.moonSize, scene.height, Style.moonCaptionSize(window.moonSize, scene.height))
            arcSide: "top"
            text: window.hijriDate.monthName + " " + window.hijriDate.year + " هـ"
            color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
            pixelSize: Style.moonCaptionSize(window.moonSize, scene.height)
            fontWeight: Font.Light
            letterSpacing: Math.max(1.2, window.moonSize * 0.004)
        }

        UI.OrbitWidget {
            visible: window.cfg.o
            width: window.cfg.size
            height: implicitHeight
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: window.cfg.margin

            earthHelioLonRad: window.orbitState.earthHelioLonRad
            jan1HelioLonRad: window.orbitState.jan1HelioLonRad
            yearProgress: window.orbitState.yearProgress
            showGhostEarths: true
            showTelemetry: window.cfg.t
            seasonName: window.orbitState.observerSeasonName || window.orbitState.seasonNameNorth
            dayOfYear: window.orbitState.dayOfYear
            daysInYear: window.orbitState.daysInYear
        }

        UI.EarthWidget {
            visible: window.cfg.e
            width: window.cfg.size
            height: implicitHeight
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: window.cfg.margin

            sunVectorWorld: Qt.vector3d(window.orbitState.sunVectorWorld.x,
                                        window.orbitState.sunVectorWorld.y,
                                        window.orbitState.sunVectorWorld.z)
            observerLatDeg: window.observerLat
            observerLonDeg: window.observerLon
            localSolarTimeHours: window.orbitState.localSolarTimeHours
            nightLightsBoost: 3.2
            showObserverPin: true
            showTelemetry: window.cfg.t
        }

        UI.PrayerClockWidget {
            visible: window.cfg.p
            width: window.cfg.size
            height: implicitHeight
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: window.cfg.margin

            localTimeHours: window.prayerState.localTimeHours
            fajrHours: window.prayerState.fajrHours
            sunriseHours: window.prayerState.sunriseHours
            dhuhrHours: window.prayerState.dhuhrHours
            asrHours: window.prayerState.asrHours
            maghribHours: window.prayerState.maghribHours
            ishaHours: window.prayerState.ishaHours
            nextPrayerHours: window.prayerState.nextPrayerHours
            nextPrayerIndex: window.prayerState.nextPrayerIndex
            nextPrayerName: window.prayerState.nextPrayerName
            minutesToNextPrayer: window.prayerState.minutesToNextPrayer
            methodName: window.prayerState.methodName
            showTelemetry: window.cfg.t
        }
    }

    Timer {
        id: settleTimer

        interval: 900
        repeat: false

        onTriggered: {
            const c = window.cfg;
            scene.grabToImage(function (result) {
                const ok = result.saveToFile(window.outputDir + c.file);
                console.log("moonphase layout QA:", c.file, ok ? "saved" : "FAILED");
                window.index += 1;
                window.renderNext();
            });
        }
    }

    Component.onCompleted: window.renderNext()
}

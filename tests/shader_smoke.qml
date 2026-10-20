// Self-contained visual smoke test for all four compiled shaders:
// moon.frag.qsb, background.frag.qsb, orbit.frag.qsb and earth.frag.qsb
//
// It does NOT depend on the astronomy code or the real moon textures: both
// samplers are fed from procedural QML items rendered through
// ShaderEffectSource.
//
//   make smoke
//
// which runs:
//   xvfb-run -a env QSG_RHI_BACKEND=opengl qml6 tests/shader_smoke.qml
//
// QT_QPA_PLATFORM=offscreen does not get a GL context on this machine and
// silently produces a fully transparent image, hence the virtual X server.
//
// On success it writes /tmp/opencode/shader_smoke/moon_smoke.png and quits.
// The 2x2 grid is: full moon, first quarter, waxing crescent (earthshine),
// full moon with libration (+lon, +lat) and roll +0.4 rad.
// The 512x128 strip underneath loads background.frag.qsb twice (winter and
// summer motifs), and the last row renders OrbitWidget + EarthWidget, so a
// single run loads all four compiled shaders: moon, background, orbit, earth.

import QtQuick
import QtQuick.Window

import "../contents/ui" as UI

Window {
    id: win
    width: 512
    height: 880
    visible: true
    color: "#0b0d12"
    title: "moon/background/orbit/earth shader smoke test"

    // ------------------------------------------------------------------
    //  Procedural albedo: 2:1, north up, prime meridian (u = 0.5) marked
    //  in red, u = 0.55 in blue, equator in green.
    // ------------------------------------------------------------------
    Item {
        id: albedoArt
        width: 256
        height: 128

        Rectangle { anchors.fill: parent; color: "#9a9a9a" }

        // prime meridian, u = 0.5
        Rectangle {
            x: 127; y: 0; width: 2; height: parent.height
            color: "#c83c3c"
        }
        // u = 0.55 (eastern feature used to check libration)
        Rectangle {
            x: 140; y: 0; width: 2; height: parent.height
            color: "#3c64c8"
        }
        // equator, v = 0.5
        Rectangle {
            x: 0; y: 63; width: parent.width; height: 2
            color: "#3cc85a"
        }
        // a few equatorial "craters"
        Repeater {
            model: 5
            Rectangle {
                width: 16; height: 16; radius: 8
                x: 20 + index * 45
                y: 82 + (index % 2) * 14
                color: "#707070"
            }
        }
    }

    // ------------------------------------------------------------------
    //  Procedural normal map: flat (0, 0, 1) with a bump in the middle.
    // ------------------------------------------------------------------
    Item {
        id: normalArt
        width: 256
        height: 128

        Rectangle { anchors.fill: parent; color: "#8080ff" }
        Rectangle {
            x: 112; y: 48; width: 32; height: 32; radius: 16
            color: "#a080ff"     // tilts east
        }
        Rectangle {
            x: 150; y: 90; width: 28; height: 28; radius: 14
            color: "#80a0ff"     // tilts north
        }
    }

    ShaderEffectSource {
        id: albedoTex
        sourceItem: albedoArt
        hideSource: true
        live: true
        width: 256
        height: 128
        textureSize: Qt.size(256, 128)
    }

    ShaderEffectSource {
        id: normalTex
        sourceItem: normalArt
        hideSource: true
        live: true
        width: 256
        height: 128
        textureSize: Qt.size(256, 128)
    }

    // ------------------------------------------------------------------
    //  Four phases / configurations.
    // ------------------------------------------------------------------
    Item {
        id: captureRoot
        anchors.fill: parent

        // Opaque backdrop so the grabbed PNG matches what the window shows:
        // grabToImage() of an Item keeps its own alpha, which otherwise leaves
        // the widget captions floating on a transparent (white-in-viewer) page.
        Rectangle {
            anchors.fill: parent
            color: win.color
            z: -1
        }

        Grid {
            columns: 2
            y: 0
            width: parent.width
            height: 512

            Repeater {
                model: [
                    { sun: Qt.vector3d(0.0, 0.0, 1.0),  lib: Qt.vector2d(0.0, 0.0),   roll: 0.0, earth: 0.035 },
                    { sun: Qt.vector3d(1.0, 0.0, 0.0),  lib: Qt.vector2d(0.0, 0.0),   roll: 0.0, earth: 0.035 },
                    { sun: Qt.vector3d(0.35, 0.10, -0.93), lib: Qt.vector2d(0.0, 0.0), roll: 0.0, earth: 0.06 },
                    // Libration check: with lon = +0.12 the red u=0.5 meridian
                    // moves ~15 px LEFT of the disk centre and the blue u=0.55
                    // meridian stays right of it, i.e. the centre now shows an
                    // eastern feature.  lat = +0.06 puts the green v=0.5
                    // equator slightly BELOW the centre.  roll = +0.4 turns
                    // the image CLOCKWISE (green line slope ~22.5 deg).
                    { sun: Qt.vector3d(0.0, 0.0, 1.0),  lib: Qt.vector2d(0.12, 0.06), roll: 0.4, earth: 0.035 }
                ]

                delegate: ShaderEffect {
                    width: 256
                    height: 256

                    fragmentShader: Qt.resolvedUrl("../contents/shaders/moon.frag.qsb")
                    property vector3d sunDirection: modelData.sun
                    property vector2d libration: modelData.lib
                    property real earthshine: modelData.earth
                    property real normalStrength: 1.2
                    property real rollAngleRad: modelData.roll
                    property variant albedoSource: albedoTex
                    property variant normalSource: normalTex
                }
            }
        }

        // --- background.frag.qsb: winter and summer motifs ----------------
        // Loads the seasonal shader through the real wrapper component so the
        // UBO layout, the .qsb file and the fallback path are all exercised.
        Row {
            y: 512
            width: parent.width
            height: 128

            UI.BackgroundWidget {
                width: 256
                height: 128
                baseColor: "#05070d"
                seasonIndex: 3          // Winter: snow + bokeh crystals
                animate: false
                time: 42.0
                intensity: 0.75
                moonIllumination: 1.0
            }

            UI.BackgroundWidget {
                width: 256
                height: 128
                baseColor: "#05070d"
                seasonIndex: 1          // Summer: sparse moonlit cirrus
                animate: false
                time: 42.0
                intensity: 0.75
                moonIllumination: 1.0
            }
        }

        // --- orbit.frag.qsb + earth.frag.qsb -----------------------------
        // The corner widgets own the remaining two shaders; rendering them
        // here means `make smoke` compiles and draws every .qsb in one pass.
        UI.OrbitWidget {
            x: 40
            y: 660
            width: 200
            height: implicitHeight

            earthHelioLonRad: 1.754
            jan1HelioLonRad: 1.754
            yearProgress: 0.0
            showGhostEarths: true
            seasonName: "Winter"
            dayOfYear: 1
            daysInYear: 365
        }

        UI.EarthWidget {
            x: 272
            y: 660
            width: 200
            height: implicitHeight

            sunVectorWorld: Qt.vector3d(1.0, 0.0, 0.0)
            observerLatDeg: 30.0
            observerLonDeg: 31.2
            localSolarTimeHours: 12.0
            nightLightsBoost: 3.2
            showObserverPin: true
        }
    }

    Timer {
        interval: 1200
        running: true
        onTriggered: {
            captureRoot.grabToImage(function(result) {
                if (!result.saveToFile("/tmp/opencode/shader_smoke/moon_smoke.png"))
                    console.error("grabToImage: saveToFile failed")
                else
                    console.log("wrote /tmp/opencode/shader_smoke/moon_smoke.png")
                Qt.quit()
            })
        }
    }

    // Emergency exit if grabToImage never calls back.
    Timer {
        interval: 8000
        running: true
        onTriggered: {
            console.error("smoke test: grab timed out")
            Qt.exit(2)
        }
    }
}

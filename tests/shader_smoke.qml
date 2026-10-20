// Self-contained visual smoke test for contents/shaders/moon.frag.qsb
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

import QtQuick
import QtQuick.Window

Window {
    id: win
    width: 512
    height: 512
    visible: true
    color: "#0b0d12"
    title: "moon.frag smoke test"

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

        Grid {
            columns: 2
            anchors.fill: parent

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

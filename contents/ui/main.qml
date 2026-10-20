/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later
*/

import QtQuick

import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid

import "../code/astronomy.js" as Astronomy

WallpaperItem {
    id: root

    readonly property bool debugActive: root.configuration
                                        ? root.configuration.DebugTimeOverrideEnabled
                                        : false
    readonly property real debugPhase: root.configuration
                                       ? root.configuration.DebugPhaseValue
                                       : 0.5
    readonly property real debugDay: root.configuration
                                     ? root.configuration.DebugDayOfYearOverride
                                     : 292.0
    readonly property real debugHour: root.configuration
                                      ? root.configuration.DebugUTCHourOverride
                                      : 19.0

    readonly property real observerLat: root.configuration
                                        ? root.configuration.ObserverLatitude
                                        : 30.0
    readonly property real observerLon: root.configuration
                                        ? root.configuration.ObserverLongitude
                                        : 31.2
    readonly property bool showObserverPin: root.configuration
                                            ? root.configuration.ShowObserverPin
                                            : true
    readonly property bool showOrbit: root.configuration
                                      ? root.configuration.ShowOrbitWidget
                                      : true
    readonly property bool showEarth: root.configuration
                                      ? root.configuration.ShowEarthWidget
                                      : true
    readonly property int cornerSize: root.configuration
                                      ? root.configuration.CornerWidgetSize
                                      : 230
    readonly property int cornerMargin: root.configuration
                                        ? root.configuration.CornerMargin
                                        : 36
    readonly property color backgroundColor: root.configuration
                                           ? root.configuration.BackgroundColor
                                           : "#05070d"

    readonly property int seasonalBackgroundMode:
        (root.configuration.SeasonalBackgroundMode !== undefined)
            ? Number(root.configuration.SeasonalBackgroundMode) : 0
    readonly property bool seasonalBackgroundAnimate:
        (root.configuration.SeasonalBackgroundAnimate !== undefined)
            ? Boolean(root.configuration.SeasonalBackgroundAnimate) : true
    readonly property real seasonalBackgroundIntensity:
        (root.configuration.SeasonalBackgroundIntensity !== undefined)
            ? Number(root.configuration.SeasonalBackgroundIntensity) : 0.65
    readonly property int seasonalBackgroundFps:
        (root.configuration.SeasonalBackgroundFps !== undefined)
            ? Number(root.configuration.SeasonalBackgroundFps) : 20

    // Resolved season index for BackgroundWidget:
    // -1 = Off, 0 = Spring, 1 = Summer, 2 = Autumn, 3 = Winter
    readonly property int activeSeasonIndex: {
        if (root.seasonalBackgroundMode === 5) {
            return -1;
        }
        if (root.seasonalBackgroundMode >= 1 && root.seasonalBackgroundMode <= 4) {
            return root.seasonalBackgroundMode - 1;
        }
        return (root.orbitState && root.orbitState.observerSeasonIndex !== undefined)
            ? root.orbitState.observerSeasonIndex : 3;
    }

    // Scrubbing any of these settings recomputes the scene deterministically.
    onDebugActiveChanged: root.updateAstronomy()
    onDebugPhaseChanged: {
        if (root.debugActive) {
            root.updateAstronomy();
        }
    }
    onDebugDayChanged: {
        if (root.debugActive) {
            root.updateAstronomy();
        }
    }
    onDebugHourChanged: {
        if (root.debugActive) {
            root.updateAstronomy();
        }
    }
    onObserverLatChanged: root.updateAstronomy()
    onObserverLonChanged: root.updateAstronomy()

    // Synodic month, used only to nudge the ephemeris towards a manually
    // selected phase while the settings preview is active.
    readonly property real lunarCycleMs: 29.530588853 * 24 * 60 * 60 * 1000

    readonly property real moonSize: Math.min(root.width, root.height)
                                     * Math.max(0.15, Math.min(0.90, root.configuration.MoonScale))

    // Sensible initial values so the very first frame is never blank.
    property var moonState: ({
        phase: 0.5,
        phaseAngleRad: Math.PI,
        illumination: 1.0,
        ageDays: 14.77,
        phaseName: "Full Moon",
        sunDirection: { x: 0.0, y: 0.0, z: 1.0 },
        librationLonRad: 0.0,
        librationLatRad: 0.0
    })

    property var orbitState: null

    // Luminance of the configured background, used to keep the telemetry
    // readable on both very dark and very light wallpapers.
    readonly property real backgroundLuminance: {
        const c = root.configuration.BackgroundColor;
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    }
    readonly property color telemetryColor: root.backgroundLuminance > 0.5
                                            ? Qt.rgba(0.0, 0.0, 0.0, 0.55)
                                            : Qt.rgba(1.0, 1.0, 1.0, 0.55)

    function syntheticDate(dayOfYear, utcHour) {
        const year = new Date().getUTCFullYear();
        const start = Date.UTC(year, 0, 1, 0, 0, 0);
        const day = Math.max(1.0, Math.min(365.25, dayOfYear));
        const hour = Math.max(0.0, Math.min(24.0, utcHour));
        return new Date(start + (day - 1.0) * 86400000 + hour * 3600000);
    }

    function updateAstronomy() {
        try {
            const lat = root.observerLat;
            const lon = root.observerLon;
            let date = new Date();

            if (root.debugActive) {
                date = root.syntheticDate(root.debugDay, root.debugHour);
            }

            if (root.debugActive) {
                root.moonState = root.stateForPhase(root.debugPhase, date.getTime(), lat, lon);
            } else {
                root.moonState = Astronomy.getMoonState(date, lat, lon);
            }

            root.orbitState = Astronomy.getEarthAndOrbitState(date, lat, lon);
        } catch (e) {
            // Keep the last known-good scene rather than blanking the desktop.
            console.warn("moonphase: ephemeris failed:", e);
        }
    }

    // Walk the ephemeris to the requested phase. Two refinement passes are
    // enough to land within a few thousandths of a degree of the target.
    function stateForPhase(phase, baseMs, latitude, longitude) {
        const target = ((phase % 1.0) + 1.0) % 1.0;
        let timestamp = (baseMs === undefined) ? Date.now() : baseMs;

        let state = Astronomy.getMoonState(new Date(timestamp), latitude, longitude);
        let delta = target - state.phase;
        if (delta > 0.5) {
            delta -= 1.0;
        } else if (delta < -0.5) {
            delta += 1.0;
        }

        timestamp += delta * root.lunarCycleMs;
        state = Astronomy.getMoonState(new Date(timestamp), latitude, longitude);

        delta = target - state.phase;
        if (delta > 0.5) {
            delta -= 1.0;
        } else if (delta < -0.5) {
            delta += 1.0;
        }

        timestamp += delta * root.lunarCycleMs;
        return Astronomy.getMoonState(new Date(timestamp), latitude, longitude);
    }

    BackgroundWidget {
        id: backgroundWidget
        anchors.fill: parent
        baseColor: root.backgroundColor
        seasonIndex: root.activeSeasonIndex
        animate: root.seasonalBackgroundAnimate
        intensity: root.seasonalBackgroundIntensity
        fps: root.seasonalBackgroundFps
        moonIllumination: root.moonState ? root.moonState.illumination : 0.5
    }

    Column {
        anchors.centerIn: parent
        spacing: root.configuration.ShowTelemetryOverlay
                 ? Math.max(6, Math.round(root.moonSize * 0.025))
                 : 0

        Item {
            id: moonContainer

            width: root.moonSize
            height: root.moonSize

            ShaderEffect {
                id: moonShader

                anchors.fill: parent

                // Rendering the shader into an offscreen layer means Qt only
                // re-runs the fragment shader when a uniform, the size or the
                // textures change -- not on every desktop repaint.
                layer.enabled: true
                layer.smooth: true

                property vector3d sunDirection: root.moonState.sunDirection
                                                ? Qt.vector3d(root.moonState.sunDirection.x,
                                                              root.moonState.sunDirection.y,
                                                              root.moonState.sunDirection.z)
                                                : Qt.vector3d(0.0, 0.0, 1.0)
                property vector2d libration: Qt.vector2d(root.moonState.librationLonRad || 0.0,
                                                         root.moonState.librationLatRad || 0.0)
                property real earthshine: root.configuration.EarthshineIntensity
                property real normalStrength: root.configuration.CraterReliefStrength
                property real rollAngleRad: root.configuration.SouthernHemisphereFlip
                                            ? Math.PI
                                            : 0.0

                // Image exposes a texture provider, so the decoded texture is
                // passed straight to the shader (mipmaps included).
                property variant albedoSource: albedoImage
                property variant normalSource: normalImage

                fragmentShader: Qt.resolvedUrl("../shaders/moon.frag.qsb")
            }

            Image {
                id: albedoImage

                source: Qt.resolvedUrl("../images/moon_albedo.jpg")
                visible: false
                asynchronous: false
                mipmap: true
                smooth: true
                sourceSize: Qt.size(2048, 1024)
            }

            Image {
                id: normalImage

                source: Qt.resolvedUrl("../images/moon_normal.png")
                visible: false
                asynchronous: false
                mipmap: true
                smooth: true
                sourceSize: Qt.size(2048, 1024)
            }
        }

        Text {
            id: telemetry

            anchors.horizontalCenter: parent.horizontalCenter
            visible: root.configuration.ShowTelemetryOverlay
            width: Math.min(root.width * 0.92, implicitWidth)
            horizontalAlignment: Text.AlignHCenter

            text: root.moonState.phaseName.toUpperCase()
                  + "  \u2022  " + (root.moonState.illumination * 100).toFixed(1) + "%"
                  + "  \u2022  DAY " + root.moonState.ageDays.toFixed(1)

            color: root.telemetryColor
            font.family: Kirigami.Theme.defaultFont.family
            font.pixelSize: Math.max(9, Math.round(root.moonSize * 0.026))
            font.weight: Font.Light
            font.letterSpacing: Math.max(0.5, root.moonSize * 0.003)
            style: Text.Raised
            styleColor: root.backgroundLuminance > 0.5
                        ? Qt.rgba(1.0, 1.0, 1.0, 0.15)
                        : Qt.rgba(0.0, 0.0, 0.0, 0.25)
        }
    }

    OrbitWidget {
        id: orbitWidget

        visible: root.showOrbit && root.orbitState !== null

        width: root.cornerSize
        height: implicitHeight

        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: root.cornerMargin

        earthHelioLonRad: root.orbitState ? root.orbitState.earthHelioLonRad : 0.0
        jan1HelioLonRad: root.orbitState ? root.orbitState.jan1HelioLonRad : 1.754
        yearProgress: root.orbitState ? root.orbitState.yearProgress : 0.0
        showGhostEarths: root.configuration.ShowSeasonalGhostEarths

        seasonName: root.orbitState
            ? (root.orbitState.observerSeasonName || root.orbitState.seasonNameNorth)
            : "Winter"
        dayOfYear: root.orbitState ? root.orbitState.dayOfYear : 1
        daysInYear: root.orbitState ? root.orbitState.daysInYear : 365
    }

    EarthWidget {
        id: earthWidget

        visible: root.showEarth && root.orbitState !== null

        width: root.cornerSize
        height: implicitHeight

        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: root.cornerMargin

        sunVectorWorld: root.orbitState && root.orbitState.sunVectorWorld
                        ? Qt.vector3d(root.orbitState.sunVectorWorld.x,
                                      root.orbitState.sunVectorWorld.y,
                                      root.orbitState.sunVectorWorld.z)
                        : Qt.vector3d(1.0, 0.0, 0.0)
        observerLatDeg: root.observerLat
        observerLonDeg: root.observerLon
        localSolarTimeHours: root.orbitState ? root.orbitState.localSolarTimeHours : 12.0
        // The Black Marble source is deliberately very dark; at a 230 px
        // thumbnail the city lights need a boost to read as more than noise.
        nightLightsBoost: 3.2
        showObserverPin: root.showObserverPin
    }

    Timer {
        id: refreshTimer

        interval: Math.max(1, root.configuration.UpdateIntervalMinutes) * 60 * 1000
        running: !root.debugActive
        repeat: true
        triggeredOnStart: true

        onTriggered: root.updateAstronomy()
    }

    Component.onCompleted: root.updateAstronomy()
}

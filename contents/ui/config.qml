/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later
*/

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kquickcontrols as KQuickControls
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root
    twinFormLayouts: parentLayout

    // --- Plasma config property contract (matches contents/config/main.xml) ---
    property alias cfg_MoonScale: moonScaleSlider.value
    property alias cfg_BackgroundColor: backgroundColorButton.color
    property alias cfg_CraterReliefStrength: craterReliefSlider.value
    property alias cfg_EarthshineIntensity: earthshineSlider.value
    property alias cfg_SouthernHemisphereFlip: southernFlipCheck.checked
    property alias cfg_ShowTelemetryOverlay: telemetryCheck.checked
    property alias cfg_UpdateIntervalMinutes: updateIntervalSpin.value
    property alias cfg_DebugTimeOverrideEnabled: debugCheck.checked
    property alias cfg_DebugPhaseValue: debugPhaseSlider.value
    property alias cfg_ShowOrbitWidget: orbitWidgetCheck.checked
    property alias cfg_ShowEarthWidget: earthWidgetCheck.checked
    property alias cfg_CornerWidgetSize: cornerSizeSlider.value
    property alias cfg_CornerMargin: cornerMarginSlider.value
    property alias cfg_ObserverLatitude: observerLatitudeSpin.value
    property alias cfg_ObserverLongitude: observerLongitudeSpin.value
    property alias cfg_ShowObserverPin: observerPinCheck.checked
    property alias cfg_ShowSeasonalGhostEarths: seasonalGhostsCheck.checked
    property alias cfg_DebugDayOfYearOverride: debugDaySlider.value
    property alias cfg_DebugUTCHourOverride: debugUtcSlider.value
    property alias cfg_SeasonalBackgroundAnimate: seasonalAnimateCheck.checked
    property alias cfg_SeasonalBackgroundIntensity: seasonalIntensitySlider.value
    property alias cfg_SeasonalBackgroundFps: seasonalFpsSpin.value

    // Explicit properties for controls that combine or map values.
    property int cfg_SeasonalBackgroundMode: 0
    property int cfg_SeasonalBackgroundStyle: 0
    property bool cfg_ShowPrayerClockWidget: true
    property int cfg_PrayerCalculationMethod: 3
    property int cfg_PrayerAsrSchool: 0
    property bool cfg_PrayerUseApi: true

    readonly property bool debugEnabled: debugCheck.checked
    readonly property bool backgroundEnabled: root.cfg_SeasonalBackgroundMode !== 5
    readonly property bool anyCornerEnabled: orbitWidgetCheck.checked
                                             || earthWidgetCheck.checked
                                             || root.cfg_ShowPrayerClockWidget

    // Curated world cities for one-click coordinate & hemisphere setup.
    readonly property var cityPresets: [
        { name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Custom Coordinates"), lat: null, lon: null },
        { name: "Makkah (21.4\u00b0N, 39.8\u00b0E)",       lat: 21.4,  lon: 39.8 },
        { name: "Madinah (24.5\u00b0N, 39.6\u00b0E)",      lat: 24.5,  lon: 39.6 },
        { name: "Cairo (30.0\u00b0N, 31.2\u00b0E)",        lat: 30.0,  lon: 31.2 },
        { name: "Jerusalem (31.8\u00b0N, 35.2\u00b0E)",    lat: 31.8,  lon: 35.2 },
        { name: "Amman (32.0\u00b0N, 35.9\u00b0E)",        lat: 32.0,  lon: 35.9 },
        { name: "Damascus (33.5\u00b0N, 36.3\u00b0E)",     lat: 33.5,  lon: 36.3 },
        { name: "Baghdad (33.3\u00b0N, 44.4\u00b0E)",      lat: 33.3,  lon: 44.4 },
        { name: "Riyadh (24.7\u00b0N, 46.7\u00b0E)",       lat: 24.7,  lon: 46.7 },
        { name: "Dubai (25.2\u00b0N, 55.3\u00b0E)",        lat: 25.2,  lon: 55.3 },
        { name: "Doha (25.3\u00b0N, 51.5\u00b0E)",         lat: 25.3,  lon: 51.5 },
        { name: "Istanbul (41.0\u00b0N, 29.0\u00b0E)",     lat: 41.0,  lon: 29.0 },
        { name: "Karachi (24.9\u00b0N, 67.0\u00b0E)",      lat: 24.9,  lon: 67.0 },
        { name: "Kuala Lumpur (3.1\u00b0N, 101.7\u00b0E)", lat: 3.1,   lon: 101.7 },
        { name: "Jakarta (6.2\u00b0S, 106.8\u00b0E)",      lat: -6.2,  lon: 106.8 },
        { name: "London (51.5\u00b0N, 0.1\u00b0W)",        lat: 51.5,  lon: -0.1 },
        { name: "Paris (48.9\u00b0N, 2.4\u00b0E)",         lat: 48.9,  lon: 2.4 },
        { name: "Berlin (52.5\u00b0N, 13.4\u00b0E)",       lat: 52.5,  lon: 13.4 },
        { name: "New York (40.7\u00b0N, 74.0\u00b0W)",     lat: 40.7,  lon: -74.0 },
        { name: "Toronto (43.7\u00b0N, 79.4\u00b0W)",      lat: 43.7,  lon: -79.4 },
        { name: "Tokyo (35.7\u00b0N, 139.7\u00b0E)",       lat: 35.7,  lon: 139.7 },
        { name: "Sydney (33.9\u00b0S, 151.2\u00b0E)",      lat: -33.9, lon: 151.2 },
        { name: "S\u00e3o Paulo (23.6\u00b0S, 46.6\u00b0W)", lat: -23.6, lon: -46.6 },
        { name: "Johannesburg (26.2\u00b0S, 28.0\u00b0E)", lat: -26.2, lon: 28.0 }
    ]

    function matchingCityIndex(lat, lon) {
        for (let i = 1; i < root.cityPresets.length; i++) {
            const c = root.cityPresets[i];
            if (Math.abs(c.lat - lat) < 0.15 && Math.abs(c.lon - lon) < 0.15) {
                return i;
            }
        }
        return 0;
    }

    function normalizedPhase(phase) {
        return ((phase % 1) + 1) % 1;
    }

    function illuminationFraction(phase) {
        return (1 - Math.cos(2 * Math.PI * normalizedPhase(phase))) / 2;
    }

    function phaseName(phase) {
        const p = normalizedPhase(phase);
        if (p < 1 / 16 || p >= 15 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "New Moon");
        } else if (p < 3 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Waxing Crescent");
        } else if (p < 5 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "First Quarter");
        } else if (p < 7 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Waxing Gibbous");
        } else if (p < 9 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Full Moon");
        } else if (p < 11 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Waning Gibbous");
        } else if (p < 13 / 16) {
            return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Last Quarter");
        }
        return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Waning Crescent");
    }

    function dayOfYearLabel(day) {
        const date = new Date(2025, 0, 1);
        date.setDate(Math.max(1, Math.min(365, Math.round(day))));
        return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase",
                     "%1 (%2)",
                     Qt.formatDate(date, "MMM d"),
                     seasonName(day));
    }

    function seasonName(day) {
        const d = Math.round(day);
        const south = observerLatitudeSpin.value < 0;
        if (d >= 79 && d < 172) {
            return south
                ? i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Autumn")
                : i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Spring");
        } else if (d >= 172 && d < 266) {
            return south
                ? i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Winter")
                : i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Summer");
        } else if (d >= 266 && d < 355) {
            return south
                ? i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Spring")
                : i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Autumn");
        }
        return south
            ? i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Summer")
            : i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Winter");
    }

    function formatHourMin(hours) {
        const wrapped = ((hours % 24) + 24) % 24;
        const totalMinutes = Math.round(wrapped * 60) % 1440;
        const hh = Math.floor(totalMinutes / 60);
        const mm = totalMinutes % 60;
        return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    function formatTimeWithLocal(utcHours) {
        const localSolarHours = utcHours + observerLongitudeSpin.value / 15.0;
        return i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase",
                     "%1 Local \u00b7 %2 UTC",
                     formatHourMin(localSolarHours),
                     formatHourMin(utcHours));
    }

    function coordinateText(value) {
        return value.toLocaleString(Qt.locale(), "f", 1);
    }

    function coordinateValue(text) {
        const cleaned = text.replace(/[^\d.,+\-]/g, "").replace(",", ".");
        const parsed = Number(cleaned);
        return isNaN(parsed) ? 0.0 : parsed;
    }

    // =========================================================================
    // 1. YOUR LOCATION
    // =========================================================================
    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Your Location")
        Kirigami.FormData.isSection: true
    }

    QQC2.ComboBox {
        id: cityPresetCombo

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "City preset:")
        Layout.fillWidth: true

        model: root.cityPresets
        textRole: "name"

        currentIndex: root.matchingCityIndex(observerLatitudeSpin.value, observerLongitudeSpin.value)

        onActivated: function(index) {
            if (index > 0 && index < root.cityPresets.length) {
                const preset = root.cityPresets[index];
                observerLatitudeSpin.value = preset.lat;
                observerLongitudeSpin.value = preset.lon;
                southernFlipCheck.checked = (preset.lat < 0);
            }
        }

        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "City location preset")
        Accessible.description: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase",
                                      "Select a city to fill in latitude, longitude, and hemisphere orientation automatically.")
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Coordinates:")

        QQC2.Label {
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Lat:")
            opacity: 0.75
        }

        QQC2.DoubleSpinBox {
            id: observerLatitudeSpin

            from: -90.0
            to: 90.0
            stepSize: 0.1
            decimals: 1
            editable: true

            textFromValue: function(value) {
                return root.coordinateText(value) + "\u00b0";
            }
            valueFromText: function(text) {
                return root.coordinateValue(text);
            }
            onValueModified: {
                southernFlipCheck.checked = (value < 0);
            }

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Observer latitude")
        }

        QQC2.Label {
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Lon:")
            opacity: 0.75
            Layout.leftMargin: Kirigami.Units.smallSpacing
        }

        QQC2.DoubleSpinBox {
            id: observerLongitudeSpin

            from: -180.0
            to: 180.0
            stepSize: 0.1
            decimals: 1
            editable: true

            textFromValue: function(value) {
                return root.coordinateText(value) + "\u00b0";
            }
            valueFromText: function(text) {
                return root.coordinateValue(text);
            }

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Observer longitude")
        }
    }

    QQC2.CheckBox {
        id: southernFlipCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Moon orientation:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Southern Hemisphere view (flip lunar disc)")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Southern hemisphere flip")
    }

    // =========================================================================
    // 2. CENTER MOON & LABELS
    // =========================================================================
    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Center Moon & Labels")
        Kirigami.FormData.isSection: true
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Moon size:")

        QQC2.Slider {
            id: moonScaleSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.15
            to: 0.90
            stepSize: 0.01
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Moon size")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.2
            horizontalAlignment: Text.AlignRight
            text: Math.round(moonScaleSlider.value * 100) + "%"
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Crater depth:")

        QQC2.Slider {
            id: craterReliefSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.0
            to: 2.5
            stepSize: 0.05
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Crater depth")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.2
            horizontalAlignment: Text.AlignRight
            // 1.20 is the physical default (100%).
            text: Math.round((craterReliefSlider.value / 1.2) * 100) + "%"
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Dark-side glow:")

        QQC2.Slider {
            id: earthshineSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.0
            to: 0.15
            stepSize: 0.005
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Dark-side earthshine glow")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.2
            horizontalAlignment: Text.AlignRight
            text: Math.round((earthshineSlider.value / 0.15) * 100) + "%"
        }
    }

    QQC2.CheckBox {
        id: telemetryCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Info captions:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show curved text captions around Moon and active widgets")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show curved info captions")
    }

    // =========================================================================
    // 3. BACKGROUND & STAR CHART
    // =========================================================================
    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Background & Star Chart")
        Kirigami.FormData.isSection: true
    }

    // Unified style selector: combines SeasonalBackgroundStyle (0..2) with
    // "Solid Color Only (Off)" (SeasonalBackgroundMode == 5) in one place.
    QQC2.ComboBox {
        id: unifiedBackgroundStyleCombo

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Background style:")
        Layout.fillWidth: true

        model: [
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Star Chart (Planisphere & Constellations)"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Seasonal Wireframe Etchings (Astrolabe)"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Combined (Star Chart + Seasonal Etchings)"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Solid Color Only (Off)")
        ]

        currentIndex: {
            if (root.cfg_SeasonalBackgroundMode === 5) {
                return 3;
            }
            return Math.max(0, Math.min(2, root.cfg_SeasonalBackgroundStyle));
        }

        onActivated: function(index) {
            if (index === 3) {
                root.cfg_SeasonalBackgroundMode = 5;
            } else {
                root.cfg_SeasonalBackgroundStyle = index;
                if (root.cfg_SeasonalBackgroundMode === 5) {
                    root.cfg_SeasonalBackgroundMode = 0;
                }
            }
        }

        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Background style")
    }

    QQC2.ComboBox {
        id: seasonalModeCombo

        visible: root.backgroundEnabled
        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Season theme:")
        Layout.fillWidth: true

        model: [
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Automatic (Follow Current Season)"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Spring"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Summer"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Autumn"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Winter")
        ]

        currentIndex: (root.cfg_SeasonalBackgroundMode >= 0 && root.cfg_SeasonalBackgroundMode <= 4)
                      ? root.cfg_SeasonalBackgroundMode : 0

        onActivated: function(index) {
            root.cfg_SeasonalBackgroundMode = index;
        }

        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Season theme")
    }

    RowLayout {
        visible: root.backgroundEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Line brightness:")

        QQC2.Slider {
            id: seasonalIntensitySlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.10
            to: 1.00
            stepSize: 0.05
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Background line brightness")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.2
            horizontalAlignment: Text.AlignRight
            text: Math.round(seasonalIntensitySlider.value * 100) + "%"
        }
    }

    RowLayout {
        visible: root.backgroundEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Gentle motion:")

        QQC2.CheckBox {
            id: seasonalAnimateCheck
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Slowly drift background pattern")
            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Animate seasonal background")
        }

        QQC2.SpinBox {
            id: seasonalFpsSpin
            visible: seasonalAnimateCheck.checked
            from: 5
            to: 30
            stepSize: 5
            editable: true
            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Animation frame rate")
        }

        QQC2.Label {
            visible: seasonalAnimateCheck.checked
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "FPS")
            opacity: 0.7
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Base color:")

        KQuickControls.ColorButton {
            id: backgroundColorButton
            dialogTitle: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Select Background Color")
            showAlphaChannel: false
            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Background color")
        }

        QQC2.Label {
            font: Kirigami.Theme.fixedWidthFont
            opacity: 0.7
            text: backgroundColorButton.color.toString().toUpperCase()
        }
    }

    // =========================================================================
    // 4. CORNER INSTRUMENTS
    // =========================================================================
    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Corner Instruments")
        Kirigami.FormData.isSection: true
    }

    // --- 4A. Top-Right: Prayer Times Clock -----------------------------------
    QQC2.CheckBox {
        id: prayerClockCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Top-right:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Prayer Times Analogue Clock (dual 12-hour rings)")
        checked: root.cfg_ShowPrayerClockWidget
        onCheckedChanged: root.cfg_ShowPrayerClockWidget = checked
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show prayer times clock widget")
    }

    QQC2.ComboBox {
        id: prayerMethodCombo

        visible: root.cfg_ShowPrayerClockWidget
        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "    Calculation authority:")
        Layout.fillWidth: true

        model: [
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Muslim World League (MWL)"), methodId: 3 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Umm al-Qura (Makkah)"), methodId: 4 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Egyptian General Authority"), methodId: 5 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "ISNA (North America)"), methodId: 2 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Diyanet (Turkey)"), methodId: 13 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "University of Islamic Sciences, Karachi"), methodId: 1 },
            { label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "University of Tehran"), methodId: 7 }
        ]
        textRole: "label"
        valueRole: "methodId"

        currentIndex: {
            const index = prayerMethodCombo.indexOfValue(root.cfg_PrayerCalculationMethod);
            return index >= 0 ? index : 0;
        }
        onActivated: root.cfg_PrayerCalculationMethod = prayerMethodCombo.currentValue

        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Prayer calculation method")
    }

    QQC2.ComboBox {
        id: prayerAsrCombo

        visible: root.cfg_ShowPrayerClockWidget
        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "    Asr juristic school:")
        Layout.fillWidth: true

        model: [
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Standard (Shafi'i, Maliki, Hanbali)"),
            i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Hanafi")
        ]

        currentIndex: root.cfg_PrayerAsrSchool
        onActivated: root.cfg_PrayerAsrSchool = prayerAsrCombo.currentIndex

        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Asr juristic method")
    }

    QQC2.CheckBox {
        id: prayerApiCheck

        visible: root.cfg_ShowPrayerClockWidget
        Kirigami.FormData.label: ""
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Sync daily prayer timings via AlAdhan API (automatic offline fallback)")
        checked: root.cfg_PrayerUseApi
        onCheckedChanged: root.cfg_PrayerUseApi = checked
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Fetch prayer times from AlAdhan")
    }

    // --- 4B. Bottom-Left: Solar Orbit & Seasons ------------------------------
    QQC2.CheckBox {
        id: orbitWidgetCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Bottom-left:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Solar Orbit & Seasons Astrolabe")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show orbit and seasons widget")
    }

    QQC2.CheckBox {
        id: seasonalGhostsCheck

        visible: orbitWidgetCheck.checked
        Kirigami.FormData.label: ""
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show equinox & solstice markers along the orbit")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show seasonal cardinal markers")
    }

    // --- 4C. Bottom-Right: Topographic Earth Globe ---------------------------
    QQC2.CheckBox {
        id: earthWidgetCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Bottom-right:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Topographic Day/Night Earth Globe")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show Earth globe widget")
    }

    QQC2.CheckBox {
        id: observerPinCheck

        visible: earthWidgetCheck.checked
        Kirigami.FormData.label: ""
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show my location pin on the Earth globe")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Show observer location pin")
    }

    // --- 4D. Shared Corner Sizing (hidden if all 3 widgets are off) ----------
    RowLayout {
        visible: root.anyCornerEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Instrument size:")

        QQC2.Slider {
            id: cornerSizeSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 140
            to: 400
            stepSize: 10
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Corner instrument size")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.8
            horizontalAlignment: Text.AlignRight
            text: Math.round(cornerSizeSlider.value) + " px"
        }
    }

    RowLayout {
        visible: root.anyCornerEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Edge margin:")

        QQC2.Slider {
            id: cornerMarginSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 16
            to: 96
            stepSize: 4
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Corner screen margin")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3.8
            horizontalAlignment: Text.AlignRight
            text: Math.round(cornerMarginSlider.value) + " px"
        }
    }

    // =========================================================================
    // 5. TIME-TRAVEL SANDBOX & ADVANCED
    // =========================================================================
    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Time-Travel Sandbox & Advanced")
        Kirigami.FormData.isSection: true
    }

    QQC2.CheckBox {
        id: debugCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Simulation mode:")
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Simulate custom date, time & moon phase")
        Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Simulate custom date, time and moon phase")
    }

    Kirigami.InlineMessage {
        visible: root.debugEnabled
        Layout.fillWidth: true
        Kirigami.FormData.isSection: true
        type: Kirigami.MessageType.Warning
        text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase",
                    "Simulation mode is active \u2014 live clock and real-time updates are paused.")
        actions: [
            Kirigami.Action {
                text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Return to Live Time")
                onTriggered: debugCheck.checked = false
            }
        ]
    }

    RowLayout {
        visible: root.debugEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Moon phase:")

        QQC2.Slider {
            id: debugPhaseSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10

            from: 0.0
            to: 1.0
            stepSize: 0.005
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Manual moon phase")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10
            horizontalAlignment: Text.AlignRight
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase",
                        "%1 (%2%)",
                        root.phaseName(debugPhaseSlider.value),
                        Math.round(root.illuminationFraction(debugPhaseSlider.value) * 100))
        }
    }

    RowLayout {
        visible: root.debugEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Date & season:")

        QQC2.Slider {
            id: debugDaySlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10

            from: 1.0
            to: 365.25
            stepSize: 1.0
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Preview day of year")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10
            horizontalAlignment: Text.AlignRight
            text: root.dayOfYearLabel(debugDaySlider.value)
        }
    }

    RowLayout {
        visible: root.debugEnabled
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Time of day:")

        QQC2.Slider {
            id: debugUtcSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10

            from: 0.0
            to: 24.0
            stepSize: 0.25
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Preview time of day")
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 10
            horizontalAlignment: Text.AlignRight
            text: root.formatTimeWithLocal(debugUtcSlider.value)
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Ephemeris refresh:")

        QQC2.SpinBox {
            id: updateIntervalSpin

            from: 1
            to: 1440
            stepSize: 5
            editable: true

            Accessible.name: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "Update interval in minutes")
        }

        QQC2.Label {
            text: i18nd("plasma_wallpaper_io.github.hadealahmad.moonphase", "minutes")
            opacity: 0.7
        }
    }
}

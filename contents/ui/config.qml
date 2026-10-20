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

    // Plasma injects one cfg_<Key> property per entry in contents/config/main.xml.
    // Each alias is the single source of truth for its setting; never bind a
    // control's property back to the same cfg_ alias or a binding loop results.
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
    property alias cfg_CornerWidgetSize: cornerSizeSpin.value
    property alias cfg_CornerMargin: cornerMarginSpin.value
    property alias cfg_ObserverLatitude: observerLatitudeSpin.value
    property alias cfg_ObserverLongitude: observerLongitudeSpin.value
    property alias cfg_ShowObserverPin: observerPinCheck.checked
    property alias cfg_ShowSeasonalGhostEarths: seasonalGhostsCheck.checked
    property alias cfg_DebugDayOfYearOverride: debugDaySlider.value
    property alias cfg_DebugUTCHourOverride: debugUtcSlider.value
    property alias cfg_SeasonalBackgroundMode: seasonalModeCombo.currentIndex
    property alias cfg_SeasonalBackgroundStyle: seasonalStyleCombo.currentIndex
    property alias cfg_SeasonalBackgroundAnimate: seasonalAnimateCheck.checked
    property alias cfg_SeasonalBackgroundIntensity: seasonalIntensitySlider.value
    property alias cfg_SeasonalBackgroundFps: seasonalFpsSpin.value

    readonly property bool debugEnabled: debugCheck.checked

    // DebugPhaseValue is a normalized phase: 0 = new, 0.5 = full, 1 = new.
    function normalizedPhase(phase) {
        return ((phase % 1) + 1) % 1;
    }

    function illuminationFraction(phase) {
        return (1 - Math.cos(2 * Math.PI * normalizedPhase(phase))) / 2;
    }

    function phaseName(phase) {
        const p = normalizedPhase(phase);
        // Buckets centred on the principal phases, matching astronomy.js.
        if (p < 1 / 16 || p >= 15 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "New Moon");
        } else if (p < 3 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Waxing Crescent");
        } else if (p < 5 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "First Quarter");
        } else if (p < 7 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Waxing Gibbous");
        } else if (p < 9 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Full Moon");
        } else if (p < 11 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Waning Gibbous");
        } else if (p < 13 / 16) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Last Quarter");
        }
        return i18nd("plasma_wallpaper_org.kde.moonphase", "Waning Crescent");
    }

    // Day-of-year readout. Uses a non-leap reference year so day 60 is
    // always March 1 and the stored 1..365.25 range maps to real dates.
    function dayOfYearLabel(day) {
        const date = new Date(2025, 0, 1);
        date.setDate(Math.max(1, Math.min(365, Math.round(day))));
        return i18nd("plasma_wallpaper_org.kde.moonphase",
                     "Day %1 \u00b7 %2",
                     Math.round(day),
                     Qt.formatDate(date, "MMM d"));
    }

    // Approximate meteorological seasons, Northern Hemisphere only.
    function seasonName(day) {
        const d = Math.round(day);
        if (d >= 79 && d < 172) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Spring");
        } else if (d >= 172 && d < 266) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Summer");
        } else if (d >= 266 && d < 355) {
            return i18nd("plasma_wallpaper_org.kde.moonphase", "Autumn");
        }
        return i18nd("plasma_wallpaper_org.kde.moonphase", "Winter");
    }

    function formatUtcTime(hours) {
        const totalMinutes = Math.round(hours * 60);
        const hh = Math.floor(totalMinutes / 60);
        const mm = totalMinutes % 60;
        return i18nd("plasma_wallpaper_org.kde.moonphase",
                     "%1:%2 UTC",
                     String(hh).padStart(2, "0"),
                     String(mm).padStart(2, "0"));
    }

    // One-decimal coordinate text using the user's decimal separator.
    function coordinateText(value) {
        return value.toLocaleString(Qt.locale(), "f", 1);
    }

    function coordinateValue(text) {
        const cleaned = text.replace(/[^\d.,+\-]/g, "").replace(",", ".");
        const parsed = Number(cleaned);
        return isNaN(parsed) ? 0.0 : parsed;
    }

    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Appearance")
        Kirigami.FormData.isSection: true
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Moon size:")

        QQC2.Slider {
            id: moonScaleSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.15
            to: 0.90
            stepSize: 0.01
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Moon size")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Moon diameter as a percentage of the screen height. Current value: %1%",
                                          Math.round(moonScaleSlider.value * 100))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            text: Math.round(moonScaleSlider.value * 100) + "%"
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Moon size: %1%",
                                   Math.round(moonScaleSlider.value * 100))
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Background color:")

        KQuickControls.ColorButton {
            id: backgroundColorButton

            dialogTitle: i18nd("plasma_wallpaper_org.kde.moonphase", "Select Background Color")
            showAlphaChannel: false

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Background color")
        }

        QQC2.Label {
            font: Kirigami.Theme.fixedWidthFont
            opacity: 0.7
            text: backgroundColorButton.color.toString().toUpperCase()
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Background color value: %1",
                                   backgroundColorButton.color.toString().toUpperCase())
        }
    }

    QQC2.ComboBox {
        id: seasonalModeCombo

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Seasonal background:")

        // Index order must match the SeasonalBackgroundMode config entry:
        // 0 = Auto, 1..4 = Spring..Winter, 5 = Off.
        model: [
            i18nd("plasma_wallpaper_org.kde.moonphase", "Automatic (Follow Season)"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Spring"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Summer"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Autumn"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Winter"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Off (Solid Color)")
        ]

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Seasonal background")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Automatic follows the current season. Choose Off for a plain solid background.")
    }

    QQC2.ComboBox {
        id: seasonalStyleCombo

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Background style:")
        enabled: seasonalModeCombo.currentIndex !== 5

        // Index order must match the SeasonalBackgroundStyle config entry:
        // 0 = Celestial Planisphere, 1 = Astrolabe & Seasonal Etchings, 2 = Combined.
        model: [
            i18nd("plasma_wallpaper_org.kde.moonphase", "Celestial Planisphere & Star Chart"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Astrolabe & Engraved Seasonal Etchings"),
            i18nd("plasma_wallpaper_org.kde.moonphase", "Combined (Planisphere + Etchings)")
        ]

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Background style")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Choose between the celestial star chart planisphere, engraved seasonal corner etchings, or both.")
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Background effect:")

        QQC2.Slider {
            id: seasonalIntensitySlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.10
            to: 1.00
            stepSize: 0.05
            snapMode: QQC2.Slider.SnapAlways
            enabled: seasonalModeCombo.currentIndex !== 5

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Background effect intensity")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Opacity and density of the seasonal texture. Current value: %1%",
                                          Math.round(seasonalIntensitySlider.value * 100))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            enabled: seasonalModeCombo.currentIndex !== 5
            text: Math.round(seasonalIntensitySlider.value * 100) + "%"
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Background effect intensity: %1%",
                                   Math.round(seasonalIntensitySlider.value * 100))
        }
    }

    QQC2.CheckBox {
        id: seasonalAnimateCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Background motion:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Animate seasonal background (low GPU mode)")
        enabled: seasonalModeCombo.currentIndex !== 5
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Animate seasonal background")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Draw a slowly moving texture. Disable to keep a static seasonal pattern.")
    }

    QQC2.SpinBox {
        id: seasonalFpsSpin

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Animation frame rate (FPS):")

        from: 5
        to: 30
        stepSize: 5
        editable: true
        enabled: seasonalModeCombo.currentIndex !== 5 && seasonalAnimateCheck.checked
        // Deliberately no value binding: cfg_SeasonalBackgroundFps aliases this
        // property, and Plasma supplies the stored value when it loads the page.

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Seasonal background animation frame rate")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "How often the seasonal texture is redrawn, from 5 to 30 frames per second.")
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Crater relief:")

        QQC2.Slider {
            id: craterReliefSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.0
            to: 2.5
            stepSize: 0.05
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Crater relief strength")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Strength of the crater relief shading. Current value: %1",
                                          craterReliefSlider.value.toFixed(2))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            text: craterReliefSlider.value.toFixed(2)
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Crater relief strength: %1",
                                   craterReliefSlider.value.toFixed(2))
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Earthshine:")

        QQC2.Slider {
            id: earthshineSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.0
            to: 0.15
            stepSize: 0.005
            snapMode: QQC2.Slider.SnapAlways

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Earthshine brightness")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Brightness of the earthshine on the unlit side of the Moon. Current value: %1%",
                                          (earthshineSlider.value * 100).toFixed(1))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            text: (earthshineSlider.value * 100).toFixed(1) + "%"
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Earthshine brightness: %1%",
                                   (earthshineSlider.value * 100).toFixed(1))
        }
    }

    QQC2.CheckBox {
        id: southernFlipCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Hemisphere:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Flip the view for the southern hemisphere")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Southern hemisphere flip")
    }

    QQC2.CheckBox {
        id: telemetryCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Overlay:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Show telemetry overlay")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Show telemetry overlay")
    }

    QQC2.SpinBox {
        id: updateIntervalSpin

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Update interval (minutes):")

        from: 1
        to: 1440
        stepSize: 1
        editable: true
        // Deliberately no value binding: cfg_UpdateIntervalMinutes aliases this
        // property, and Plasma supplies the stored value when it loads the page.

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Update interval in minutes")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "How often the moon phase is recalculated, from 1 to 1440 minutes.")
    }

    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Corner Widgets & Observer Location")
        Kirigami.FormData.isSection: true
    }

    QQC2.CheckBox {
        id: orbitWidgetCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Orbit widget:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Show bottom-left orbit & seasons")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Show orbit and seasons widget")
    }

    QQC2.CheckBox {
        id: earthWidgetCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Earth widget:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Show bottom-right Earth globe")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Show Earth globe widget")
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Corner widget size:")

        QQC2.SpinBox {
            id: cornerSizeSpin

            // Int, matching the CornerWidgetSize config entry.
            from: 140
            to: 400
            stepSize: 10
            editable: true

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Corner widget size")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Diameter of the orbit and Earth widgets, from 140 to 400 pixels.")
        }

        QQC2.Label {
            text: i18nd("plasma_wallpaper_org.kde.moonphase", "px")
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "pixels")
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Corner screen margin:")

        QQC2.SpinBox {
            id: cornerMarginSpin

            // Int, matching the CornerMargin config entry.
            from: 16
            to: 96
            stepSize: 4
            editable: true

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Corner screen margin")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Distance between the corner widgets and the screen edges, from 16 to 96 pixels.")
        }

        QQC2.Label {
            text: i18nd("plasma_wallpaper_org.kde.moonphase", "px")
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "pixels")
        }
    }

    QQC2.DoubleSpinBox {
        id: observerLatitudeSpin

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Observer latitude (\u00b0N):")

        from: -90.0
        to: 90.0
        stepSize: 0.1
        decimals: 1
        editable: true

        textFromValue: function(value) {
            return root.coordinateText(value);
        }
        valueFromText: function(text) {
            return root.coordinateValue(text);
        }

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Observer latitude")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Latitude in decimal degrees; positive values are north, negative values are south.")
    }

    QQC2.DoubleSpinBox {
        id: observerLongitudeSpin

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Observer longitude (\u00b0E):")

        from: -180.0
        to: 180.0
        stepSize: 0.1
        decimals: 1
        editable: true

        textFromValue: function(value) {
            return root.coordinateText(value);
        }
        valueFromText: function(text) {
            return root.coordinateValue(text);
        }

        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Observer longitude")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Longitude in decimal degrees; positive values are east, negative values are west.")
    }

    QQC2.CheckBox {
        id: observerPinCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Observer pin:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Show location pin on globe")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Show observer location pin")
    }

    QQC2.CheckBox {
        id: seasonalGhostsCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Seasonal markers:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Show seasonal cardinal markers")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Show seasonal cardinal markers")
    }

    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Preview")
        Kirigami.FormData.isSection: true
    }

    QQC2.CheckBox {
        id: debugCheck

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Time preview:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Preview manual moon phase")
        Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Preview manual moon phase")
        Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                      "Use the phase slider below instead of the current date and time.")
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Phase:")

        QQC2.Slider {
            id: debugPhaseSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            // Normalized phase, not a 0-100 illumination percentage.
            from: 0.0
            to: 1.0
            stepSize: 0.001
            snapMode: QQC2.Slider.SnapAlways
            enabled: root.debugEnabled

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Manual moon phase")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "%1, %2% illuminated. Normalized phase %3.",
                                          root.phaseName(debugPhaseSlider.value),
                                          Math.round(root.illuminationFraction(debugPhaseSlider.value) * 100),
                                          debugPhaseSlider.value.toFixed(3))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            enabled: root.debugEnabled
            text: Math.round(debugPhaseSlider.value * 100) + "%"
            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase",
                                   "Normalized phase: %1%",
                                   Math.round(debugPhaseSlider.value * 100))
        }
    }

    QQC2.Label {
        id: phaseReadout

        enabled: root.debugEnabled
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Simulated:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase",
                    "%1 \u00b7 %2% illuminated",
                    root.phaseName(debugPhaseSlider.value),
                    Math.round(root.illuminationFraction(debugPhaseSlider.value) * 100))
        Accessible.name: text
    }

    QQC2.Label {
        Layout.fillWidth: true
        font: Kirigami.Theme.smallFont
        opacity: 0.7
        wrapMode: Text.Wrap
        text: i18nd("plasma_wallpaper_org.kde.moonphase",
                    "Normalized phase \u2014 0% New \u00b7 25% First Quarter \u00b7 50% Full \u00b7 75% Last Quarter \u00b7 100% New")
        Kirigami.FormData.isSection: true
        Accessible.name: text
    }

    Kirigami.Heading {
        level: 4
        text: i18nd("plasma_wallpaper_org.kde.moonphase", "Time & Season Preview")
        Kirigami.FormData.isSection: true
    }

    QQC2.Label {
        Layout.fillWidth: true
        font: Kirigami.Theme.smallFont
        opacity: 0.7
        wrapMode: Text.Wrap
        text: i18nd("plasma_wallpaper_org.kde.moonphase",
                    "These controls take effect when \u201cPreview manual moon phase\u201d above is enabled.")
        Kirigami.FormData.isSection: true
        Accessible.name: text
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Day of year:")

        QQC2.Slider {
            id: debugDaySlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            // A real value: cfg_DebugDayOfYearOverride is a Double. The XML
            // maximum of 365.25 keeps the stored value in range.
            from: 1.0
            to: 365.25
            stepSize: 1.0
            snapMode: QQC2.Slider.SnapAlways
            enabled: root.debugEnabled

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Preview day of year")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "%1, approximate season: %2.",
                                          root.dayOfYearLabel(debugDaySlider.value),
                                          root.seasonName(debugDaySlider.value))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 8
            horizontalAlignment: Text.AlignRight
            enabled: root.debugEnabled
            text: root.dayOfYearLabel(debugDaySlider.value)
            Accessible.name: text
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "UTC time of day:")

        QQC2.Slider {
            id: debugUtcSlider

            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 12

            from: 0.0
            to: 24.0
            stepSize: 0.25
            snapMode: QQC2.Slider.SnapAlways
            enabled: root.debugEnabled

            Accessible.name: i18nd("plasma_wallpaper_org.kde.moonphase", "Preview UTC time of day")
            Accessible.description: i18nd("plasma_wallpaper_org.kde.moonphase",
                                          "Current value: %1.",
                                          root.formatUtcTime(debugUtcSlider.value))
        }

        QQC2.Label {
            Layout.minimumWidth: Kirigami.Units.gridUnit * 6
            horizontalAlignment: Text.AlignRight
            enabled: root.debugEnabled
            text: root.formatUtcTime(debugUtcSlider.value)
            Accessible.name: text
        }
    }

    QQC2.Label {
        enabled: root.debugEnabled
        Kirigami.FormData.label: i18nd("plasma_wallpaper_org.kde.moonphase", "Approximate season:")
        text: i18nd("plasma_wallpaper_org.kde.moonphase",
                    "%1 (Northern Hemisphere)",
                    root.seasonName(debugDaySlider.value))
        Accessible.name: text
    }
}

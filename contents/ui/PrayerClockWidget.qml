/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Top-right dual-ring analogue prayer times clock: the inner ring carries the
    00:00-12:00 (AM) prayers, the outer ring the 12:00-24:00 (PM) prayers, each
    marked with an engraved astronomical vector symbol.
*/

import QtQuick

import org.kde.kirigami as Kirigami

Item {
    id: root

    // --- Data contract (filled by main.qml from astronomy.js) ---------------
    property real localTimeHours: 12.5
    property real fajrHours: 4.8
    property real sunriseHours: 6.1
    property real dhuhrHours: 11.9
    property real asrHours: 15.3
    property real maghribHours: 17.7
    property real ishaHours: 19.0
    property real nextPrayerHours: 15.3
    property int nextPrayerIndex: 3
    property string nextPrayerName: "Asr"
    property int minutesToNextPrayer: 168
    property string methodName: "MWL"
    property bool showSunrise: true

    // --- Geometry (matches prayer_clock.frag) -------------------------------
    readonly property real innerRadius: width * 0.245
    readonly property real outerRadius: width * 0.365
    readonly property real labelSize: Math.max(7, Math.round(width * 0.039))
    readonly property real captionSize: Math.max(7, Math.round(width * 0.040))

    implicitWidth: 230
    implicitHeight: width + caption.height + Math.round(width * 0.02)

    function hourToTheta(h) {
        return (Math.PI * 0.5) - (((h % 12.0) + 12.0) % 12.0) / 12.0 * (Math.PI * 2.0);
    }

    function pointOnRing(rPx, theta) {
        return Qt.point(root.width * 0.5 + rPx * Math.cos(theta),
                        root.width * 0.5 - rPx * Math.sin(theta));
    }

    function formatHHMM(hours) {
        var totalMinutes = Math.round(((hours % 24) + 24) % 24 * 60);
        var hh = Math.floor(totalMinutes / 60) % 24;
        var mm = totalMinutes % 60;
        return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    function formatCountdown(mins) {
        var totalMinutes = Math.max(0, Math.round(mins));
        var hh = Math.floor(totalMinutes / 60);
        var mm = totalMinutes % 60;
        return "-" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    function prayerColor(index, hours) {
        if (index === root.nextPrayerIndex) {
            return Qt.rgba(1.0, 0.949, 0.8, 0.96);          // warm gold/white
        }

        var onActiveRing = (hours >= 12.0) === (root.localTimeHours >= 12.0);

        if (onActiveRing) {
            if (index === 1 || index === 2 || index === 3) {
                return Qt.rgba(0.980, 0.855, 0.471, 0.88);  // solar yellow
            }
            return Qt.rgba(0.941, 0.961, 1.0, 0.88);        // crisp white
        }

        return Qt.rgba(0.569, 0.608, 0.686, 0.48);          // muted gray
    }

    // --- Miniature astronomical line-art symbols ----------------------------
    function drawPrayerSymbol(ctx, index, cx, cy, s, color) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.lineWidth = Math.max(1.1, root.width * 0.0055);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        if (index === 0) {
            // Fajr: horizon, dawn dome and three rays rising out of it.
            ctx.beginPath();
            ctx.moveTo(-s, 0.0);
            ctx.lineTo(s, 0.0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(0.0, 0.0, s * 0.44, Math.PI, Math.PI * 2.0, false);
            ctx.stroke();

            for (var f = -1; f <= 1; f++) {
                var fa = Math.PI * 1.5 + f * 0.42;
                ctx.beginPath();
                ctx.moveTo(Math.cos(fa) * s * 0.60, Math.sin(fa) * s * 0.60);
                ctx.lineTo(Math.cos(fa) * s * 0.95, Math.sin(fa) * s * 0.95);
                ctx.stroke();
            }
        } else if (index === 1) {
            // Sunrise: horizon, half sun above it, one short zenith ray.
            ctx.beginPath();
            ctx.moveTo(-s, 0.0);
            ctx.lineTo(s, 0.0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(0.0, 0.0, s * 0.45, Math.PI, Math.PI * 2.0, false);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0.0, -s * 0.64);
            ctx.lineTo(0.0, -s * 0.94);
            ctx.stroke();
        } else if (index === 2) {
            // Dhuhr: full zenith sun disc with eight short radial rays.
            ctx.beginPath();
            ctx.arc(0.0, 0.0, s * 0.40, 0.0, Math.PI * 2.0, false);
            ctx.stroke();

            for (var d = 0; d < 8; d++) {
                var da = d * Math.PI * 0.25;
                ctx.beginPath();
                ctx.moveTo(Math.cos(da) * s * 0.56, Math.sin(da) * s * 0.56);
                ctx.lineTo(Math.cos(da) * s * 0.84, Math.sin(da) * s * 0.84);
                ctx.stroke();
            }
        } else if (index === 3) {
            // Asr: sun disc half lit along a 45 degree shadow line.
            var ar = s * 0.48;

            ctx.save();
            ctx.beginPath();
            ctx.arc(0.0, 0.0, ar, 0.0, Math.PI * 2.0, false);
            ctx.clip();
            ctx.globalAlpha = 0.62;
            ctx.rotate(Math.PI * 0.25);
            ctx.fillRect(-ar * 2.0, 0.0, ar * 4.0, ar * 2.0);
            ctx.restore();

            ctx.beginPath();
            ctx.arc(0.0, 0.0, ar, 0.0, Math.PI * 2.0, false);
            ctx.stroke();
        } else if (index === 4) {
            // Maghrib: horizon with the sun slipping below it.
            ctx.beginPath();
            ctx.moveTo(-s, 0.0);
            ctx.lineTo(s, 0.0);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(0.0, 0.0, s * 0.45, 0.0, Math.PI, false);
            ctx.stroke();
        } else if (index === 5) {
            // Isha: crescent moon carved by a second arc, plus a small star.
            var cr = s * 0.52;
            var br = s * 0.46;
            var off = s * 0.34;

            var ix = (off * off + cr * cr - br * br) / (2.0 * off);
            var iy = Math.sqrt(Math.max(0.0, cr * cr - ix * ix));
            var tip = Math.atan2(iy, ix);
            var bite = Math.atan2(iy, ix - off);

            ctx.beginPath();
            ctx.arc(0.0, 0.0, cr, -tip, tip - Math.PI * 2.0, true);
            ctx.arc(off, 0.0, br, bite, Math.PI * 2.0 - bite, false);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.arc(s * 0.62, -s * 0.62, Math.max(0.9, s * 0.13), 0.0, Math.PI * 2.0, false);
            ctx.fill();
        }

        ctx.restore();
    }

    ShaderEffect {
        id: clockShader

        width: root.width
        height: root.width

        layer.enabled: true
        layer.smooth: true

        property real localTimeHours: root.localTimeHours
        property real fajrHours: root.fajrHours
        property real sunriseHours: root.sunriseHours
        property real dhuhrHours: root.dhuhrHours
        property real asrHours: root.asrHours
        property real maghribHours: root.maghribHours
        property real ishaHours: root.ishaHours
        property real nextPrayerHours: root.nextPrayerHours
        property real nextPrayerIndex: root.nextPrayerIndex
        property real showSunrise: root.showSunrise ? 1.0 : 0.0

        fragmentShader: Qt.resolvedUrl("../shaders/prayer_clock.frag.qsb")
    }

    // Crisp vector prayer glyphs, radially offset from each ring so they never
    // sit on top of the ring tracks or the cardinal labels.
    Canvas {
        id: symbolCanvas

        width: root.width
        height: root.width
        antialiasing: true

        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        Component.onCompleted: requestPaint()

        Connections {
            target: root

            function onLocalTimeHoursChanged() { symbolCanvas.requestPaint(); }
            function onFajrHoursChanged() { symbolCanvas.requestPaint(); }
            function onSunriseHoursChanged() { symbolCanvas.requestPaint(); }
            function onDhuhrHoursChanged() { symbolCanvas.requestPaint(); }
            function onAsrHoursChanged() { symbolCanvas.requestPaint(); }
            function onMaghribHoursChanged() { symbolCanvas.requestPaint(); }
            function onIshaHoursChanged() { symbolCanvas.requestPaint(); }
            function onNextPrayerHoursChanged() { symbolCanvas.requestPaint(); }
            function onNextPrayerIndexChanged() { symbolCanvas.requestPaint(); }
            function onNextPrayerNameChanged() { symbolCanvas.requestPaint(); }
            function onShowSunriseChanged() { symbolCanvas.requestPaint(); }
        }

        onPaint: {
            var ctx = getContext("2d");
            ctx.clearRect(0, 0, width, height);

            if (root.width <= 0) {
                return;
            }

            var s = Math.max(4.0, root.width * 0.033);
            var prayers = [
                { index: 0, hours: root.fajrHours },
                { index: 1, hours: root.sunriseHours },
                { index: 2, hours: root.dhuhrHours },
                { index: 3, hours: root.asrHours },
                { index: 4, hours: root.maghribHours },
                { index: 5, hours: root.ishaHours }
            ];

            for (var i = 0; i < prayers.length; i++) {
                var prayer = prayers[i];
                if (!isFinite(prayer.hours)) {
                    continue;
                }
                if (prayer.index === 1 && !root.showSunrise) {
                    continue;
                }

                var rSym = prayer.hours < 12.0 ? root.width * 0.182 : root.width * 0.422;
                var anchor = root.pointOnRing(rSym, root.hourToTheta(prayer.hours));

                root.drawPrayerSymbol(ctx, prayer.index, anchor.x, anchor.y, s,
                                      root.prayerColor(prayer.index, prayer.hours));
            }
        }
    }

    // Cardinal dial positions around the outer perimeter: each label names the
    // twin AM/PM hour that shares that quarter of the dial.
    Repeater {
        model: [
            { "label": "00\u00b712", "angle": Math.PI * 0.5 },
            { "label": "03\u00b715", "angle": 0.0 },
            { "label": "06\u00b718", "angle": Math.PI * 1.5 },
            { "label": "09\u00b721", "angle": Math.PI }
        ]

        delegate: Text {
            required property var modelData

            readonly property point labelPoint: root.pointOnRing(root.width * 0.455, modelData.angle)

            x: labelPoint.x - width * 0.5
            y: labelPoint.y - height * 0.5

            text: modelData.label
            color: Qt.rgba(0.86, 0.88, 0.92, 0.46)
            font.family: Kirigami.Theme.defaultFont.family
            font.pixelSize: root.labelSize
            font.letterSpacing: 0.6
        }
    }

    Text {
        id: caption

        anchors.top: clockShader.bottom
        anchors.topMargin: Math.round(root.width * 0.02)
        width: root.width
        horizontalAlignment: Text.AlignHCenter

        text: root.nextPrayerName.toUpperCase()
              + " " + root.formatHHMM(root.nextPrayerHours)
              + " (" + root.formatCountdown(root.minutesToNextPrayer) + ")"
              + "  \u2022  " + root.formatHHMM(root.localTimeHours)

        color: Qt.rgba(0.86, 0.88, 0.92, 0.58)
        font.family: Kirigami.Theme.defaultFont.family
        font.pixelSize: root.captionSize
        font.weight: Font.Light
        font.letterSpacing: 0.8
    }
}

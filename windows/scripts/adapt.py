# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
"""Generate Windows-compatible copies while retaining shared render/cache/Hijri logic."""
import pathlib
import shutil
import sys


def replace_once(text, old, new):
    count = text.count(old)
    if count != 1:
        raise ValueError(f"Expected one compatibility hook {old!r}; found {count}. Review upstream changes.")
    return text.replace(old, new, 1)


def adapt(source, output, font='"Segoe UI"'):
    source, output = source.resolve(), output.resolve()
    if output == source or source.is_relative_to(output) or output.is_relative_to(source / 'contents'):
        raise ValueError("Generated files must be outside the shared contents tree")
    for folder in ('code', 'images', 'config'):
        shutil.copytree(source / 'contents' / folder, output / 'contents' / folder, dirs_exist_ok=True)
    prayer = output / 'contents' / 'code' / 'prayer.js'
    text = prayer.read_text(encoding='utf-8')
    text = replace_once(text, 'asrSchool, callback) {', 'asrSchool, callback, timezoneId) {')
    text = replace_once(text, 'return dateKey(date) + "|" + latitudeDeg',
        'return dateKey(windowsCalendarDate(date)) + "|" + _windowsZone + "|" + _windowsOffset + "|" + latitudeDeg')
    text = replace_once(text, 'var url = "https://api.aladhan.com/v1/timings/"',
        'var requestDate = windowsCalendarDate(d);\n    var url = "https://api.aladhan.com/v1/timings/"')
    text = replace_once(text, 'pad2(d.getUTCDate()) + "-" + pad2(d.getUTCMonth() + 1)',
        'pad2(requestDate.getUTCDate()) + "-" + pad2(requestDate.getUTCMonth() + 1)')
    text = replace_once(text, '+ d.getUTCFullYear()\n        + "?latitude="',
        '+ requestDate.getUTCFullYear()\n        + "?latitude="')
    text = replace_once(text, '+ "&school=" + school;',
        '+ "&school=" + school\n        + (timezoneId ? "&timezonestring=" + encodeURIComponent(timezoneId) : "");')
    text += '''
// Windows adapter: separate daily caches by observer timezone and offset.
var _windowsZone = "";
var _windowsOffset = NaN;
function setWindowsZone(id, offset) { _windowsZone = id; _windowsOffset = offset; }
function windowsCalendarDate(date) {
    return isFiniteNumber(_windowsOffset) ? new Date(date.getTime() + _windowsOffset * 60000) : date;
}
'''
    prayer.write_text(text, encoding='utf-8')
    target = output / 'contents' / 'ui'
    target.mkdir(parents=True, exist_ok=True)
    for path in (source / 'contents' / 'ui').glob('*.qml'):
        if path.name == 'config.qml':  # Native settings replace the KDE form.
            continue
        text = path.read_text(encoding='utf-8')
        text = text.replace('import org.kde.kirigami as Kirigami', '')
        text = text.replace('import org.kde.plasma.plasmoid', '')
        text = text.replace('Kirigami.Theme.defaultFont.family', font)
        if path.name == 'main.qml':
            text = replace_once(text, 'WallpaperItem {', '''Item {
    property var configuration: AppConfig
    readonly property bool suspended: Host.paused
    property string prayerSource: "offline"
    property real prayerTzHours: 0''')
            text = replace_once(text, 'root.prayerLocalTimeHours = pState.localTimeHours;',
                'root.prayerSource = pState.source;\n        root.prayerTzHours = pState.tzHours;\n        root.prayerLocalTimeHours = pState.localTimeHours;')
            text = replace_once(text, 'root.prayerAsrSchool);',
                'root.prayerAsrSchool, false, Host.utcOffset(date.getTime()));')
            text = replace_once(text, 'return Prayer.getPrayerState(date,',
                'Prayer.setWindowsZone(Host.timeZoneId(), Host.utcOffset(date.getTime()));\n            return Prayer.getPrayerState(date,')
            text = replace_once(text, 'root.applyPrayerState(apiState);', 'root.applyPrayerState(root.prayerStateFor(date));')
            text = replace_once(text, '                });\n            }\n        } catch',
                '                }, Host.timeZoneId());\n            }\n        } catch')
            start = text.index('    Connections {')
            end = text.index('    // Synodic month', start)
            text = text[:start] + '''    Connections {
        target: Host
        // updateAstronomy requests the upstream Moon cache refresh for
        // relief, Earthshine and orientation changes as well.
        function onSettingsChanged() { root.updateAstronomy(); }
        function onPausedChanged() { if (!Host.paused) root.updateAstronomy(); }
    }

''' + text[end:]
            text = replace_once(text, 'animate: root.seasonalBackgroundAnimate', 'animate: root.seasonalBackgroundAnimate && !root.suspended')
            text = replace_once(text, 'running: !root.debugActive', 'running: !root.debugActive && !root.suspended')
            text = replace_once(text, 'running: root.showPrayerClockWidget && !root.useDemoDate',
                'running: root.showPrayerClockWidget && !root.useDemoDate && !root.suspended')
        if path.name == 'BackgroundWidget.qml':
            # A wallpaper does not own keyboard focus.
            text = replace_once(text, ' && Qt.application.state === Qt.ApplicationActive', '')
        (target / path.name).write_text(text, encoding='utf-8')


if __name__ == '__main__':
    # Optional third argument: the QML font expression that replaces Kirigami's
    # default font (the macOS host passes Qt.application.font.family).
    adapt(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), *sys.argv[3:4])

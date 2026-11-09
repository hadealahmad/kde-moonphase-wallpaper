// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
#include "desktop.h"
#include <dwmapi.h>
#include <QDebug>
#include <QScreen>
#include <QtGui/qscreen_platform.h>

QString Desktop::className(HWND w) {
    wchar_t name[256]{};
    GetClassNameW(w, name, 256);
    return QString::fromWCharArray(name);
}

Desktop::Layer Desktop::discover() {
    Layer result;
    HWND progman = FindWindowW(L"Progman", nullptr);
    if (!progman) return result;
    // There is no documented live-wallpaper API. Bound every shell message.
    DWORD_PTR response = 0;
    SendMessageTimeoutW(progman, 0x052c, 0xd, 0, SMTO_ABORTIFHUNG, 1000, &response);
    SendMessageTimeoutW(progman, 0x052c, 0xd, 1, SMTO_ABORTIFHUNG, 1000, &response);
    HWND icons = FindWindowExW(progman, nullptr, L"SHELLDLL_DefView", nullptr);
    // Windows 11's raised desktop puts WorkerW under Progman.
    if (icons) {
        HWND child = FindWindowExW(progman, nullptr, L"WorkerW", nullptr);
        if (child && IsWindowVisible(child)) return {child, icons, "Progman child WorkerW"};
    }
    EnumWindows([](HWND top, LPARAM data) -> BOOL {
        auto &layer = *reinterpret_cast<Layer *>(data);
        HWND view = FindWindowExW(top, nullptr, L"SHELLDLL_DefView", nullptr);
        if (!view) return TRUE;
        HWND sibling = FindWindowExW(nullptr, top, L"WorkerW", nullptr);
        if (sibling && IsWindowVisible(sibling) && !FindWindowExW(sibling, nullptr, L"SHELLDLL_DefView", nullptr)) {
            layer = {sibling, view, "classic sibling WorkerW"};
            return FALSE;
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&result));
    if (result.host) return result;
    // Safe fallback only if the icon layer is an actual child: order below it.
    if (icons) return {progman, icons, "Progman below icons"};
    return result;
}

bool Desktop::attach(HWND window, const Layer &layer, QScreen *screen, QString &error) {
    if (!IsWindow(layer.host) || !IsWindow(layer.icons)) { error = "Desktop shell layer unavailable"; return false; }
    // Qt may report an EDID friendly name, not a Win32 DISPLAY device name.
    auto native = screen->nativeInterface<QNativeInterface::QWindowsScreen>();
    MONITORINFO info{sizeof(info)};
    if (!native || !GetMonitorInfoW(native->handle(), &info)) {
        error = "Cannot resolve Windows monitor: " + screen->name(); return false;
    }
    RECT rect = info.rcMonitor;
    auto style = GetWindowLongPtrW(window, GWL_STYLE);
    SetWindowLongPtrW(window, GWL_STYLE, (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD);
    auto ex = GetWindowLongPtrW(window, GWL_EXSTYLE);
    SetWindowLongPtrW(window, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT);
    SetLastError(0);
    HWND old = SetParent(window, layer.host);
    DWORD code = GetLastError();
    if (!old && code) { error = QString("SetParent failed: %1").arg(code); return false; }
    if (GetParent(window) != layer.host) { error = "Desktop parent verification failed"; return false; }
    POINT origin{rect.left, rect.top};
    MapWindowPoints(HWND_DESKTOP, layer.host, &origin, 1);
    HWND order = (layer.host == GetParent(layer.icons)) ? layer.icons : HWND_BOTTOM;
    if (!SetWindowPos(window, order, origin.x, origin.y, rect.right - rect.left,
                      rect.bottom - rect.top, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) {
        error = QString("Desktop positioning failed: %1").arg(GetLastError()); return false;
    }
    qInfo() << "Attached" << screen->name() << layer.method << "host" << quintptr(layer.host);
    return true;
}

bool Desktop::isFullscreen(HWND ownWindow) {
    HWND w = GetForegroundWindow();
    if (!w || w == ownWindow || IsIconic(w)) return false;
    DWORD pid = 0; GetWindowThreadProcessId(w, &pid);
    if (pid == GetCurrentProcessId()) return false;
    QString cls = className(w);
    if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return false;
    DWORD cloaked = 0;
    DwmGetWindowAttribute(w, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
    if (cloaked) return false;
    RECT rect{};
    if (FAILED(DwmGetWindowAttribute(w, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect)))) GetWindowRect(w, &rect);
    MONITORINFO mi{sizeof(mi)};
    if (!GetMonitorInfoW(MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST), &mi)) return false;
    return rect.left <= mi.rcMonitor.left && rect.top <= mi.rcMonitor.top &&
           rect.right >= mi.rcMonitor.right && rect.bottom >= mi.rcMonitor.bottom;
}

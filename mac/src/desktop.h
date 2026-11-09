// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QString>
#include <functional>
class QWindow;
class QScreen;

// AppKit side of the macOS host: desktop-level windows, system state and the
// login item. Everything here runs on the main thread.
namespace Desktop {
enum class Event { Sleep, Wake, DisplaySleep, DisplayWake, Lock, Unlock, SpaceChanged };

// Stable identifier for a display (CoreGraphics display UUID), the same across
// reconnects and restarts. Falls back to the screen name.
QString displayId(QScreen *screen);

// Puts the window behind the desktop icons on every Space, ignoring input.
bool attach(QWindow *window, QScreen *screen, QString &error);
// The window still sits at the desktop level and covers its screen.
bool isAttached(QWindow *window);
// Some part of the window can be seen (not covered or on a hidden Space).
bool isVisible(QWindow *window);
bool lowPowerMode();
void observe(std::function<void(Event)> handler);
// Brings the app forward (settings and preview windows).
void activate();
// Called when the Dock icon is clicked while the app is running. Call after
// QApplication exists, since Qt installs the application delegate.
void onReopen(std::function<void()> handler);

bool loginItemEnabled();
bool setLoginItem(bool enabled, QString &error);
}

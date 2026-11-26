// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <windows.h>
#include <QString>
class QScreen;
namespace Desktop {
struct Layer { HWND host = nullptr; HWND icons = nullptr; QString method; };
Layer discover();
bool attach(HWND window, const Layer &layer, QScreen *screen, QString &error);
bool isFullscreen(HWND ownWindow = nullptr);
QString className(HWND window);
}

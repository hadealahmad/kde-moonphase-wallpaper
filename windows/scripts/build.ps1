# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
[CmdletBinding()]
param(
    [string]$QtDirectory = $env:QTDIR,
    [string]$BuildDirectory,
    [string]$Generator = 'Ninja'
)
$ErrorActionPreference = 'Stop'
if (-not $BuildDirectory) { $BuildDirectory = Join-Path $PSScriptRoot '../../build/windows' }
if (-not $QtDirectory -or -not (Test-Path -LiteralPath (Join-Path $QtDirectory 'lib/cmake/Qt6/Qt6Config.cmake'))) {
    throw 'Set QTDIR or pass -QtDirectory pointing to a Qt 6.8+ MSVC x64 SDK.'
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'Run this script from an x64 Visual Studio Developer PowerShell.'
}
Get-Command cmake.exe, python.exe -ErrorAction Stop | Out-Null
& cmake -S (Join-Path $PSScriptRoot '..') -B $BuildDirectory -G $Generator `
    "-DCMAKE_PREFIX_PATH=$QtDirectory" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& cmake --build $BuildDirectory --config Release --parallel
exit $LASTEXITCODE

/*
    SPDX-FileCopyrightText: 2026 Hadi Alahmad <hade.alahmad1@gmail.com>

    SPDX-License-Identifier: GPL-2.0-or-later

    Shared typographic scale for the corner instruments, so the orbit dial,
    prayer clock and Earth globe read as one family: identical caption and
    label sizes, ink, tracking and caption seating radius.
*/

.pragma library

// Ink shared by every dial label and caption (cool moonlit silver).
var INK_R = 0.86;
var INK_G = 0.88;
var INK_B = 0.92;

// Warm accent used for reference marks such as the orbit's Jan 1 pin.
var ACCENT_R = 0.95;
var ACCENT_G = 0.80;
var ACCENT_B = 0.45;

var CAPTION_ALPHA = 0.62;   // curved telemetry beneath each dial
var LABEL_ALPHA = 0.50;     // cardinal dial labels
var MINOR_ALPHA = 0.46;     // reference marks inside a dial

// Curved captions sit on this radius (fraction of widget width) on every
// widget, just outside each dial's outermost label ring.
var CAPTION_RADIUS = 0.530;

function ink(alpha) {
    return Qt.rgba(INK_R, INK_G, INK_B, alpha);
}

function accent(alpha) {
    return Qt.rgba(ACCENT_R, ACCENT_G, ACCENT_B, alpha);
}

function captionSize(width) {
    return Math.max(8, Math.round(width * 0.040));
}

function labelSize(width) {
    return Math.max(7, Math.round(width * 0.039));
}

function minorSize(width) {
    return Math.max(7, Math.round(width * 0.034));
}

// Tracking as a fraction of the em, so spacing scales with the widget.
function captionTracking(pixelSize) {
    return Math.max(0.6, pixelSize * 0.10);
}

function labelTracking(pixelSize) {
    return Math.max(0.5, pixelSize * 0.08);
}

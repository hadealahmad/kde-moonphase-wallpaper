/*
 * test_astronomy.mjs -- Node test harness for contents/code/astronomy.js
 *
 * Run with:  node tests/test_astronomy.mjs
 *
 * The delivered astronomy.js begins with `.pragma library`, which is valid
 * QML but not JavaScript. It is stripped only in memory before evaluation;
 * the file on disk is never modified.
 *
 * Reference data:
 *   Lunar phase instants for 2026: timeanddate.com moon phases (UTC).
 *     New Moon      2026-01-18 19:52
 *     First Quarter 2026-01-26 04:47
 *     Full Moon     2026-01-03 10:03
 *     Last Quarter  2026-01-10 15:48
 *   Meeus, Astronomical Algorithms, 2nd ed., Example 48.a (1992-04-12 0h TD):
 *     illuminated fraction k = 0.6786, phase angle i = 69.0756 deg.
 *   Note: the task brief quoted "phase angle ~87.15 deg" for this example.
 *   That value is inconsistent with k = 0.6786 under the project's convention
 *   (i would have to be 180 - 110.92 = 69.08 deg). The illumination and the
 *   elongation-derived angle are therefore tested; see the comment in that
 *   test for the arithmetic.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "..", "contents", "code", "astronomy.js");
const source = fs.readFileSync(sourcePath, "utf8");

/* ---- load the ES5 library without touching the pragma on disk ---- */
const pragmaMatch = /^\s*\.pragma\s+library\s*(?:\r?\n|$)/.exec(source);
if (!pragmaMatch) {
    console.error("FAIL  astronomy.js does not start with '.pragma library'");
    process.exit(1);
}
const jsBody = source.slice(pragmaMatch[0].length);
let getMoonState;
try {
    getMoonState = new Function(jsBody + "\nreturn getMoonState;")();
} catch (err) {
    console.error("FAIL  could not evaluate astronomy.js:", err.message);
    process.exit(1);
}

/* ---- tiny test harness ---- */
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`PASS  ${name}`);
    } catch (err) {
        failed++;
        console.log(`FAIL  ${name}`);
        console.log(`      ${err && err.message ? err.message : err}`);
    }
}

function assert(cond, message) {
    if (!cond) {
        throw new Error(message);
    }
}

function close(actual, expected, tolerance, label) {
    assert(
        Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected} +/- ${tolerance}, got ${actual}`
    );
}

function utc(year, month1, day, hour = 0, minute = 0, second = 0) {
    return new Date(Date.UTC(year, month1 - 1, day, hour, minute, second));
}

function phaseDistance(a, b) {
    let d = (a - b) % 1;
    if (d < 0) d += 1;
    return Math.min(d, 1 - d);
}

function signedPhaseDistance(a, b) {
    let d = (a - b) % 1;
    if (d > 0.5) d -= 1;
    if (d <= -0.5) d += 1;
    return d;
}

/* Locate the instant nearest `around` where phase == target. */
function findPhase(target, around, windowDays = 8) {
    const step = 3600 * 1000;
    const start = around.getTime() - windowDays * 86400000;
    const end = around.getTime() + windowDays * 86400000;

    let prevT = start;
    let prevD = signedPhaseDistance(getMoonState(new Date(start)).phase, target);
    let best = null;

    for (let t = start + step; t <= end; t += step) {
        const d = signedPhaseDistance(getMoonState(new Date(t)).phase, target);
        if (prevD === 0) {
            return new Date(prevT);
        }
        if (prevD < 0 && d >= 0 && d - prevD < 0.5) {
            let lo = prevT;
            let hi = t;
            for (let i = 0; i < 60; i++) {
                const mid = (lo + hi) / 2;
                const dm = signedPhaseDistance(
                    getMoonState(new Date(mid)).phase,
                    target
                );
                if (dm < 0) lo = mid;
                else hi = mid;
            }
            best = new Date((lo + hi) / 2);
            break;
        }
        prevT = t;
        prevD = d;
    }
    return best;
}

/* ---- 1. API shape, ranges, pragma, ES5 style ---- */
test("pragma library and conservative ES5 source", () => {
    assert(
        /^\s*\.pragma\s+library/.test(source),
        "astronomy.js must start with .pragma library"
    );
    const withoutComments = jsBody
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    assert(!/\b(?:let|const)\b/.test(withoutComments), "found let/const in library");
    assert(!/=>/.test(withoutComments), "found arrow function in library");
    assert(
        !/\b(?:require|import)\s*\(/.test(withoutComments),
        "library must be dependency-free"
    );
});

test("API returns every contract field with valid ranges", () => {
    const s = getMoonState(utc(2026, 2, 17, 12, 0));

    const numeric = [
        "phase",
        "phaseAngleRad",
        "illumination",
        "ageDays",
        "librationLonRad",
        "librationLatRad"
    ];
    for (const key of numeric) {
        assert(typeof s[key] === "number" && isFinite(s[key]), `${key} is not finite`);
    }
    assert(typeof s.phaseName === "string", "phaseName is not a string");
    assert(s.sunDirection && typeof s.sunDirection === "object", "sunDirection missing");
    for (const axis of ["x", "y", "z"]) {
        assert(
            typeof s.sunDirection[axis] === "number" &&
                isFinite(s.sunDirection[axis]),
            `sunDirection.${axis} is not finite`
        );
    }

    assert(s.phase >= 0 && s.phase < 1, `phase out of range: ${s.phase}`);
    assert(
        s.phaseAngleRad >= 0 && s.phaseAngleRad < 2 * Math.PI,
        `phaseAngleRad out of range: ${s.phaseAngleRad}`
    );
    assert(s.illumination >= 0 && s.illumination <= 1, "illumination out of range");
    assert(s.ageDays >= 0 && s.ageDays <= 29.53, "ageDays out of range");
    close(
        s.illumination,
        0.5 * (1 - Math.cos(s.phaseAngleRad)),
        1e-12,
        "illumination formula"
    );
    close(s.phaseAngleRad, 2 * Math.PI * s.phase, 1e-12, "phaseAngleRad formula");
    close(s.ageDays, s.phase * 29.530588853, 1e-9, "ageDays formula");
});

/* ---- 2. Known 2026 syzygies ---- */
const syzygies = [
    {
        label: "New Moon 2026-01-18 19:52Z",
        date: utc(2026, 1, 18, 19, 52),
        target: 0.0,
        expectIllum: 0.0,
        illumTolerance: 0.005
    },
    {
        label: "First Quarter 2026-01-26 04:47Z",
        date: utc(2026, 1, 26, 4, 47),
        target: 0.25,
        expectIllum: 0.5,
        illumTolerance: 0.01
    },
    {
        label: "Full Moon 2026-01-03 10:03Z",
        date: utc(2026, 1, 3, 10, 3),
        target: 0.5,
        expectIllum: 1.0,
        illumTolerance: 0.005
    },
    {
        label: "Last Quarter 2026-01-10 15:48Z",
        date: utc(2026, 1, 10, 15, 48),
        target: 0.75,
        expectIllum: 0.5,
        illumTolerance: 0.01
    }
];

let maxSyzygyPhaseError = 0;
let maxSyzygyIllumError = 0;
const syzygyDetails = [];

test("2026 syzygies: phase within 0.01, illumination within contract", () => {
    for (const ref of syzygies) {
        const s = getMoonState(ref.date);
        const phaseErr = phaseDistance(s.phase, ref.target);
        const illumErr = Math.abs(s.illumination - ref.expectIllum);

        maxSyzygyPhaseError = Math.max(maxSyzygyPhaseError, phaseErr);
        maxSyzygyIllumError = Math.max(maxSyzygyIllumError, illumErr);

        const crossing = findPhase(ref.target, ref.date, 5);
        const timeErrMinutes = crossing
            ? (crossing.getTime() - ref.date.getTime()) / 60000
            : NaN;
        syzygyDetails.push(
            `${ref.label}: phase=${s.phase.toFixed(6)} ` +
                `(err ${phaseErr.toExponential(2)}), ` +
                `illum=${s.illumination.toFixed(6)} ` +
                `(err ${illumErr.toExponential(2)}), ` +
                `model crossing ${timeErrMinutes >= 0 ? "+" : ""}` +
                `${timeErrMinutes.toFixed(1)} min`
        );

        assert(
            phaseErr <= 0.01,
            `${ref.label}: phase ${s.phase} is ${phaseErr} from ${ref.target}`
        );
        assert(
            s.illumination >= 0 && s.illumination <= 1,
            `${ref.label}: illumination ${s.illumination} outside [0,1]`
        );
        assert(
            illumErr <= ref.illumTolerance,
            `${ref.label}: illumination ${s.illumination}, expected ` +
                `${ref.expectIllum} +/- ${ref.illumTolerance}`
        );
    }
});

/* ---- 3. Meeus Example 48.a anchor ---- */
test("Meeus 1992-04-12 0h TD: illuminated fraction 0.6786", () => {
    /* 1992-04-12 0h TD; TD-UT was about 59 s, negligible at this precision. */
    const s = getMoonState(utc(1992, 4, 12, 0, 0));

    /* Contract illumination = (1 - cos(elongation)) / 2.
       For k = 0.6786 the elongation is acos(1 - 2k) = 110.924 deg.
       Meeus's astronomical phase angle i = 180 - elongation = 69.076 deg.
       (The brief's "87.15 deg" does not satisfy this k; see file header.) */
    const elongationDeg = (s.phaseAngleRad * 180) / Math.PI;
    const meeusPhaseAngleDeg = 180 - elongationDeg;

    close(s.illumination, 0.6786, 0.002, "illuminated fraction");
    close(elongationDeg, 110.924, 0.25, "elongation");
    close(meeusPhaseAngleDeg, 69.076, 0.25, "Meeus phase angle i");
});

/* ---- 4. Monotonic phase over 40 days, sampled hourly ---- */
test("phase increases monotonically (mod 1) over 40 days", () => {
    const start = utc(2026, 1, 1);
    const hours = 40 * 24;
    let prev = getMoonState(new Date(start.getTime())).phase;
    let wraps = 0;
    let minStep = Infinity;
    let maxStep = -Infinity;

    for (let h = 1; h <= hours; h++) {
        const cur = getMoonState(
            new Date(start.getTime() + h * 3600 * 1000)
        ).phase;
        let step = cur - prev;
        if (step < 0) step += 1;
        assert(step > 0, `phase did not advance at hour ${h}`);
        assert(step < 0.01, `phase jumped by ${step} at hour ${h}`);
        if (cur < prev) wraps++;
        minStep = Math.min(minStep, step);
        maxStep = Math.max(maxStep, step);
        prev = cur;
    }

    /* 40 days / 29.53 days = 1.354 lunations -> exactly one wraparound. */
    assert(wraps === 1, `expected 1 wraparound, got ${wraps}`);
    console.log(
        `      hourly phase step ${minStep.toFixed(6)}..${maxStep.toFixed(6)} ` +
            `(${wraps} wraparound)`
    );
});

/* ---- 5. Libration ranges and variability ---- */
test("optical libration stays within +/-0.15 rad and varies", () => {
    const start = utc(2026, 1, 1);
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (let h = 0; h < 32 * 24; h++) {
        const s = getMoonState(new Date(start.getTime() + h * 3600 * 1000));
        assert(
            Math.abs(s.librationLonRad) <= 0.15,
            `libration longitude ${s.librationLonRad} exceeds 0.15 rad`
        );
        assert(
            Math.abs(s.librationLatRad) <= 0.15,
            `libration latitude ${s.librationLatRad} exceeds 0.15 rad`
        );
        minLon = Math.min(minLon, s.librationLonRad);
        maxLon = Math.max(maxLon, s.librationLonRad);
        minLat = Math.min(minLat, s.librationLatRad);
        maxLat = Math.max(maxLat, s.librationLatRad);
    }

    assert(maxLon - minLon > 0.05, "libration longitude is nearly constant");
    assert(maxLat - minLat > 0.05, "libration latitude is nearly constant");
    console.log(
        `      libration lon ${minLon.toFixed(4)}..${maxLon.toFixed(4)} rad, ` +
            `lat ${minLat.toFixed(4)}..${maxLat.toFixed(4)} rad`
    );
});

/* ---- 6. sunDirection geometry ---- */
test("sunDirection is unit length and oriented per contract", () => {
    const start = utc(2026, 1, 1);
    for (let h = 0; h < 30 * 24; h += 7) {
        const d = getMoonState(
            new Date(start.getTime() + h * 3600 * 1000)
        ).sunDirection;
        close(Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z), 1, 1e-9, "length");
    }

    const cases = [
        { target: 0.0, label: "New Moon", check: (d) => d.z < -0.99 },
        { target: 0.25, label: "First Quarter", check: (d) => d.x > 0.99 },
        { target: 0.5, label: "Full Moon", check: (d) => d.z > 0.99 },
        { target: 0.75, label: "Last Quarter", check: (d) => d.x < -0.99 }
    ];

    for (const c of cases) {
        const when = findPhase(c.target, utc(2026, 1, 18), 20);
        assert(when, `could not locate phase ${c.target}`);
        const s = getMoonState(when);
        close(s.phase, c.target, 1e-5, `${c.label} located phase`);
        assert(
            c.check(s.sunDirection),
            `${c.label}: sunDirection (${s.sunDirection.x.toFixed(3)}, ` +
                `${s.sunDirection.y.toFixed(3)}, ${s.sunDirection.z.toFixed(3)}) ` +
                "has wrong orientation"
        );
    }
});

/* ---- 7. phaseName covers all eight names and key buckets ---- */
test("phaseName returns all eight names across a lunation", () => {
    const start = utc(2026, 1, 1);
    const seen = new Set();
    for (let h = 0; h < 30 * 24; h++) {
        seen.add(getMoonState(new Date(start.getTime() + h * 3600 * 1000)).phaseName);
    }
    const expected = [
        "New Moon",
        "Waxing Crescent",
        "First Quarter",
        "Waxing Gibbous",
        "Full Moon",
        "Waning Gibbous",
        "Last Quarter",
        "Waning Crescent"
    ];
    for (const name of expected) {
        assert(seen.has(name), `phaseName never returned "${name}"`);
    }
    assert(seen.size === 8, `expected 8 distinct names, got ${seen.size}`);

    const anchor = [
        [0.0, "New Moon"],
        [0.25, "First Quarter"],
        [0.5, "Full Moon"],
        [0.75, "Last Quarter"]
    ];
    for (const [target, name] of anchor) {
        const when = findPhase(target, utc(2026, 1, 18), 20);
        assert(when, `could not locate phase ${target}`);
        const actual = getMoonState(when).phaseName;
        assert(actual === name, `phase ${target}: expected "${name}", got "${actual}"`);
    }
});

/* ---- 8. robustness ---- */
test("invalid date and omitted coordinates do not throw", () => {
    let s;
    try {
        s = getMoonState(new Date(NaN));
    } catch (err) {
        throw new Error(`threw on invalid date: ${err.message}`);
    }
    assert(s && isFinite(s.phase), "invalid date produced non-finite phase");
    assert(s.phase >= 0 && s.phase < 1, "invalid date produced out-of-range phase");

    try {
        s = getMoonState(utc(2026, 6, 1));
    } catch (err) {
        throw new Error(`threw with omitted coordinates: ${err.message}`);
    }
    close(s.ageDays, s.phase * 29.530588853, 1e-9, "default-coordinate age");

    const withCoords = getMoonState(utc(2026, 6, 1), 51.5, -0.12);
    assert(
        Math.abs(withCoords.phase - s.phase) < 1e-12,
        "latitude/longitude changed the geocentric phase"
    );
});

/* ---- summary ---- */
console.log("");
console.log("2026 syzygy details:");
for (const line of syzygyDetails) {
    console.log(`  ${line}`);
}
console.log("");
console.log(`max 2026 syzygy phase error:       ${maxSyzygyPhaseError.toExponential(3)}`);
console.log(`max 2026 syzygy illumination error: ${maxSyzygyIllumError.toExponential(3)}`);
console.log(`tests: ${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);

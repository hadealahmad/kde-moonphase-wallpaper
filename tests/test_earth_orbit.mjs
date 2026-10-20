/*
 * test_earth_orbit.mjs -- Node test harness for getEarthAndOrbitState()
 * in contents/code/astronomy.js
 *
 * Run with:  node tests/test_earth_orbit.mjs
 *
 * The delivered astronomy.js begins with `.pragma library`, which is valid
 * QML but not JavaScript. It is stripped only in memory before evaluation;
 * the file on disk is never modified.
 *
 * Reference instants (UTC) for 2026:
 *   March equinox     2026-03-20 14:46
 *   June solstice     2026-06-21 08:25
 *   September equinox 2026-09-23 00:05
 *   December solstice 2026-12-21 20:50
 *
 * NOTE on the season frame: the brief describes earthHelioLonRad both as
 * "(lambda_sun + PI) mod 2PI" and as "0 = March equinox, PI/2 = June
 * solstice". Those two statements differ by 180 degrees. The library follows
 * the second (and the explicit test contract below): earthHelioLonRad is the
 * season angle lambda_sun, i.e. 0 at the March equinox. The true
 * Earth-centred heliocentric longitude is earthHelioLonRad + PI.
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
let getEarthAndOrbitState;
try {
    getEarthAndOrbitState = new Function(
        jsBody + "\nreturn getEarthAndOrbitState;"
    )();
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

function utc(year, month1, day, hour = 0, minute = 0) {
    return new Date(Date.UTC(year, month1 - 1, day, hour, minute, 0));
}

const RAD = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

function finite(value, label) {
    assert(
        typeof value === "number" && isFinite(value),
        `${label} is not a finite number (got ${value})`
    );
}

function state(date, lat, lon) {
    return getEarthAndOrbitState(date, lat, lon);
}

/* ---- 1. API shape and ranges ---- */
test("returns every contract field with finite values and valid ranges", () => {
    const s = state(utc(2026, 6, 21, 12, 0), 31.2, 31.2);

    const numbers = [
        "earthHelioLonRad",
        "jan1HelioLonRad",
        "yearProgress",
        "dayOfYear",
        "daysInYear",
        "earthDistanceAU",
        "observerLatRad",
        "observerLonRad",
        "subsolarLatRad",
        "subsolarLonRad",
        "localSolarTimeHours"
    ];
    for (const key of numbers) {
        finite(s[key], key);
    }

    assert(
        s.earthHelioLonRad >= 0 && s.earthHelioLonRad < TWO_PI,
        `earthHelioLonRad out of [0,2PI): ${s.earthHelioLonRad}`
    );
    assert(
        s.jan1HelioLonRad >= 0 && s.jan1HelioLonRad < TWO_PI,
        `jan1HelioLonRad out of [0,2PI): ${s.jan1HelioLonRad}`
    );
    assert(
        s.yearProgress >= 0 && s.yearProgress <= 1,
        `yearProgress out of [0,1]: ${s.yearProgress}`
    );
    assert(
        Number.isInteger(s.dayOfYear) && s.dayOfYear >= 1 && s.dayOfYear <= 366,
        `dayOfYear is not an integer in 1..366: ${s.dayOfYear}`
    );
    assert(
        s.daysInYear === 365 || s.daysInYear === 366,
        `daysInYear is neither 365 nor 366: ${s.daysInYear}`
    );
    assert(
        s.earthDistanceAU >= 0.98 && s.earthDistanceAU <= 1.02,
        `earthDistanceAU out of [0.98,1.02]: ${s.earthDistanceAU}`
    );
    assert(
        Math.abs(s.observerLatRad - 31.2 * RAD) <= 1e-12,
        `observerLatRad: got ${s.observerLatRad}`
    );
    assert(
        Math.abs(s.observerLonRad - 31.2 * RAD) <= 1e-12,
        `observerLonRad: got ${s.observerLonRad}`
    );
    assert(
        Math.abs(s.subsolarLatRad) <= 0.4093,
        `subsolarLatRad exceeds obliquity: ${s.subsolarLatRad}`
    );
    assert(
        s.subsolarLonRad >= -Math.PI && s.subsolarLonRad <= Math.PI,
        `subsolarLonRad out of [-PI,PI]: ${s.subsolarLonRad}`
    );
    assert(
        s.localSolarTimeHours >= 0 && s.localSolarTimeHours < 24,
        `localSolarTimeHours out of [0,24): ${s.localSolarTimeHours}`
    );

    const names = ["Spring", "Summer", "Autumn", "Winter"];
    assert(
        names.includes(s.seasonNameNorth),
        `bad seasonNameNorth: ${s.seasonNameNorth}`
    );
    assert(
        names.includes(s.seasonNameSouth),
        `bad seasonNameSouth: ${s.seasonNameSouth}`
    );
    assert(
        s.seasonNameSouth !== s.seasonNameNorth,
        "southern season must be the opposite of northern"
    );

    assert(
        names.includes(s.observerSeasonName),
        `bad observerSeasonName: ${s.observerSeasonName}`
    );
    assert(
        Number.isInteger(s.observerSeasonIndex) &&
            s.observerSeasonIndex >= 0 &&
            s.observerSeasonIndex <= 3,
        `observerSeasonIndex out of 0..3: ${s.observerSeasonIndex}`
    );

    assert(
        s.sunVectorWorld && typeof s.sunVectorWorld === "object",
        "sunVectorWorld missing"
    );
    for (const axis of ["x", "y", "z"]) {
        finite(s.sunVectorWorld[axis], `sunVectorWorld.${axis}`);
    }
});

/* ---- 2-4. solstice / equinox declination ---- */
test("March equinox 2026: subsolar latitude ~ 0", () => {
    const s = state(utc(2026, 3, 20, 14, 46));
    close(s.subsolarLatRad, 0, 0.01, "subsolarLatRad");
});

test("June solstice 2026: subsolar latitude ~ +0.4091 rad", () => {
    const s = state(utc(2026, 6, 21, 8, 25));
    close(s.subsolarLatRad, 0.4091, 0.01, "subsolarLatRad");
});

test("December solstice 2026: subsolar latitude ~ -0.4091 rad", () => {
    const s = state(utc(2026, 12, 21, 20, 50));
    close(s.subsolarLatRad, -0.4091, 0.01, "subsolarLatRad");
});

/* ---- 5-6. equation of time via subsolar longitude at 12:00 UTC ---- */
test("12:00 UTC subsolar longitude stays within the EoT bound", () => {
    const dates = [
        utc(2026, 1, 15, 12),
        utc(2026, 2, 11, 12),
        utc(2026, 4, 15, 12),
        utc(2026, 6, 21, 12),
        utc(2026, 8, 20, 12),
        utc(2026, 10, 25, 12),
        utc(2026, 11, 3, 12)
    ];
    let maxAbs = 0;
    for (const date of dates) {
        const lon = state(date).subsolarLonRad;
        assert(
            Math.abs(lon) <= 0.08,
            `${date.toISOString()}: |subsolarLonRad| = ${Math.abs(lon)} > 0.08`
        );
        maxAbs = Math.max(maxAbs, Math.abs(lon));
    }
    console.log(
        `      max |subsolar longitude| at 12:00 UTC: ${maxAbs.toFixed(4)} rad`
    );
});

test("Equation of time is applied (Feb 11 shift ~ +0.06 rad)", () => {
    const june = state(utc(2026, 6, 21, 12)).subsolarLonRad;
    const feb = state(utc(2026, 2, 11, 12)).subsolarLonRad;

    assert(Math.abs(june) < 0.02, `June 21 noon: ${june} not near 0`);
    /* EoT on 2026-02-11 is about -14 min -> +3.5 deg = +0.061 rad. */
    close(feb, 0.0615, 0.02, "Feb 11 noon subsolar longitude");
    assert(feb > 0.045, `Feb 11 shift ${feb} does not prove EoT is applied`);
    assert(
        feb - june > 0.04,
        `EoT shift between June and February is only ${feb - june} rad`
    );
});

/* ---- 7-9. calendar bookkeeping ---- */
test("Jan 1 00:00 UTC: yearProgress ~ 0 and dayOfYear == 1", () => {
    const s = state(utc(2026, 1, 1, 0, 0));
    close(s.yearProgress, 0, 1e-9, "yearProgress");
    assert(s.dayOfYear === 1, `dayOfYear: expected 1, got ${s.dayOfYear}`);
    close(
        s.earthHelioLonRad,
        s.jan1HelioLonRad,
        1e-12,
        "earthHelioLonRad at Jan 1 equals jan1HelioLonRad"
    );
});

test("Dec 31 23:59 UTC: yearProgress > 0.999", () => {
    const s = state(utc(2026, 12, 31, 23, 59));
    assert(
        s.yearProgress > 0.999,
        `yearProgress: expected > 0.999, got ${s.yearProgress}`
    );
    assert(s.dayOfYear === 365, `dayOfYear: expected 365, got ${s.dayOfYear}`);
});

test("leap-year rule: 2028 has 366 days, 2026 has 365", () => {
    const leap = state(utc(2028, 12, 31, 12));
    const common = state(utc(2026, 12, 31, 12));
    assert(leap.daysInYear === 366, `2028 daysInYear: ${leap.daysInYear}`);
    assert(leap.dayOfYear === 366, `2028 dayOfYear: ${leap.dayOfYear}`);
    assert(common.daysInYear === 365, `2026 daysInYear: ${common.daysInYear}`);
    assert(common.dayOfYear === 365, `2026 dayOfYear: ${common.dayOfYear}`);
});

/* ---- 10. seasons ---- */
test("season names on the four 2026 equinox/solstice dates", () => {
    /* One hour after each event avoids knife-edge quadrant boundaries in
       the low-precision solar series. */
    const cases = [
        { date: utc(2026, 3, 20, 15, 46), north: "Spring", south: "Autumn" },
        { date: utc(2026, 6, 21, 9, 25), north: "Summer", south: "Winter" },
        { date: utc(2026, 9, 23, 1, 5), north: "Autumn", south: "Spring" },
        { date: utc(2026, 12, 21, 21, 50), north: "Winter", south: "Summer" }
    ];
    for (const c of cases) {
        const s = state(c.date);
        assert(
            s.seasonNameNorth === c.north,
            `${c.date.toISOString()}: north season ${s.seasonNameNorth}, ` +
                `expected ${c.north}`
        );
        assert(
            s.seasonNameSouth === c.south,
            `${c.date.toISOString()}: south season ${s.seasonNameSouth}, ` +
                `expected ${c.south}`
        );
    }
});

/* ---- 10b. hemisphere-aware observer season ---- */
test("observer season follows latitude one day after each 2026 anchor", () => {
    /* +1 day keeps every sample clear of the quadrant boundaries. */
    const cases = [
        {
            date: utc(2026, 3, 21, 14, 46),
            north: "Spring",
            northIndex: 0,
            south: "Autumn",
            southIndex: 2
        },
        {
            date: utc(2026, 6, 22, 8, 25),
            north: "Summer",
            northIndex: 1,
            south: "Winter",
            southIndex: 3
        },
        {
            date: utc(2026, 9, 24, 0, 5),
            north: "Autumn",
            northIndex: 2,
            south: "Spring",
            southIndex: 0
        },
        {
            date: utc(2026, 12, 22, 20, 50),
            north: "Winter",
            northIndex: 3,
            south: "Summer",
            southIndex: 1
        }
    ];

    for (const c of cases) {
        const label = c.date.toISOString();

        const north = state(c.date, 30);
        assert(
            north.observerSeasonName === c.north,
            `${label} lat 30: observerSeasonName ${north.observerSeasonName}, ` +
                `expected ${c.north}`
        );
        assert(
            north.observerSeasonIndex === c.northIndex,
            `${label} lat 30: observerSeasonIndex ${north.observerSeasonIndex}, ` +
                `expected ${c.northIndex}`
        );

        const south = state(c.date, -30);
        assert(
            south.observerSeasonName === c.south,
            `${label} lat -30: observerSeasonName ${south.observerSeasonName}, ` +
                `expected ${c.south}`
        );
        assert(
            south.observerSeasonIndex === c.southIndex,
            `${label} lat -30: observerSeasonIndex ${south.observerSeasonIndex}, ` +
                `expected ${c.southIndex}`
        );

        assert(
            north.observerSeasonName === north.seasonNameNorth,
            `${label} lat 30: observer season must match the northern season`
        );
        assert(
            south.observerSeasonName === south.seasonNameSouth,
            `${label} lat -30: observer season must match the southern season`
        );
    }
});

test("observerSeasonIndex is consistent with observerSeasonName everywhere", () => {
    const expected = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 };
    const dates = [
        utc(2026, 1, 15, 12),
        utc(2026, 4, 15, 12),
        utc(2026, 7, 15, 12),
        utc(2026, 10, 15, 12)
    ];
    for (const date of dates) {
        for (const lat of [-90, -45, -0.1, 0, 0.1, 45, 90]) {
            const s = state(date, lat);
            assert(
                s.observerSeasonIndex === expected[s.observerSeasonName],
                `${date.toISOString()} lat ${lat}: ` +
                    `${s.observerSeasonName} -> ${s.observerSeasonIndex}`
            );
        }
    }
});

/* ---- 11. earthHelioLonRad at the seasonal anchors ---- */
test("earthHelioLonRad tracks the season angle (0, PI/2, PI, 3PI/2)", () => {
    const anchors = [
        { date: utc(2026, 3, 20, 14, 46), expected: 0, label: "March equinox" },
        { date: utc(2026, 6, 21, 8, 25), expected: Math.PI / 2, label: "June solstice" },
        { date: utc(2026, 9, 23, 0, 5), expected: Math.PI, label: "September equinox" },
        { date: utc(2026, 12, 21, 20, 50), expected: 3 * Math.PI / 2, label: "December solstice" }
    ];
    for (const a of anchors) {
        const actual = state(a.date).earthHelioLonRad;
        close(actual, a.expected, 0.03, `${a.label} earthHelioLonRad`);
    }
});

/* ---- 12. Earth-Sun distance ---- */
test("earthDistanceAU is in range and January < July", () => {
    const jan = state(utc(2026, 1, 3, 12)).earthDistanceAU;
    const jul = state(utc(2026, 7, 4, 12)).earthDistanceAU;

    for (const [label, value] of [["January", jan], ["July", jul]]) {
        assert(
            value >= 0.98 && value <= 1.02,
            `${label} distance out of range: ${value}`
        );
    }
    assert(
        jan < jul,
        `expected January distance < July distance, got ${jan} vs ${jul}`
    );
    assert(jan < 0.985, `January distance should be near perihelion: ${jan}`);
    assert(jul > 1.015, `July distance should be near aphelion: ${jul}`);
});

/* ---- 13. sun vector ---- */
test("sunVectorWorld is unit length and matches declination/longitude", () => {
    const dates = [
        utc(2026, 1, 1, 0),
        utc(2026, 3, 20, 14, 46),
        utc(2026, 6, 21, 8, 25),
        utc(2026, 9, 23, 0, 5),
        utc(2026, 12, 21, 20, 50)
    ];
    for (const date of dates) {
        const s = state(date);
        const v = s.sunVectorWorld;
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        close(length, 1, 1e-9, `${date.toISOString()} |sunVectorWorld|`);

        const expX = Math.cos(s.subsolarLatRad) * Math.sin(s.subsolarLonRad);
        const expY = Math.sin(s.subsolarLatRad);
        const expZ = Math.cos(s.subsolarLatRad) * Math.cos(s.subsolarLonRad);
        close(v.x, expX, 1e-12, "sunVectorWorld.x");
        close(v.y, expY, 1e-12, "sunVectorWorld.y");
        close(v.z, expZ, 1e-12, "sunVectorWorld.z");
    }
});

/* ---- 14. local apparent solar time ---- */
test("localSolarTimeHours at 31.2E, 19:00 UTC is ~21.08 h", () => {
    const s = state(utc(2026, 6, 21, 19, 0), 0, 31.2);
    close(s.localSolarTimeHours, 21.08, 0.25, "localSolarTimeHours");
});

test("localSolarTimeHours wraps into [0,24)", () => {
    const cases = [
        { date: utc(2026, 1, 1, 0, 30), lon: -170 },
        { date: utc(2026, 6, 21, 23, 45), lon: 179.9 },
        { date: utc(2026, 10, 25, 12, 0), lon: -0.1 }
    ];
    for (const c of cases) {
        const h = state(c.date, 0, c.lon).localSolarTimeHours;
        assert(h >= 0 && h < 24, `${c.date.toISOString()} lon ${c.lon}: ${h}`);
    }
});

/* ---- 15. robustness and input validation ---- */
test("invalid date and omitted coordinates do not throw", () => {
    let bad;
    try {
        bad = state(new Date(NaN));
    } catch (err) {
        throw new Error(`threw on invalid date: ${err.message}`);
    }
    for (const key of [
        "earthHelioLonRad",
        "jan1HelioLonRad",
        "yearProgress",
        "dayOfYear",
        "daysInYear",
        "earthDistanceAU",
        "subsolarLatRad",
        "subsolarLonRad",
        "localSolarTimeHours"
    ]) {
        finite(bad[key], `invalid-date ${key}`);
    }

    let omitted;
    try {
        omitted = state(utc(2026, 6, 1));
    } catch (err) {
        throw new Error(`threw with omitted coordinates: ${err.message}`);
    }
    close(omitted.observerLatRad, 0, 1e-12, "default latitude");
    close(omitted.observerLonRad, 0, 1e-12, "default longitude");
    finite(omitted.localSolarTimeHours, "default localSolarTimeHours");

    /* Latitude clamps, longitude wraps. */
    close(state(utc(2026, 6, 1), 100, 0).observerLatRad, Math.PI / 2, 1e-12, "lat clamp +90");
    close(state(utc(2026, 6, 1), -100, 0).observerLatRad, -Math.PI / 2, 1e-12, "lat clamp -90");
    close(state(utc(2026, 6, 1), 0, 190).observerLonRad, -170 * RAD, 1e-12, "lon wrap 190");
    close(state(utc(2026, 6, 1), 0, -190).observerLonRad, 170 * RAD, 1e-12, "lon wrap -190");
});

/* ---- summary ---- */
console.log("");
console.log(`tests: ${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);

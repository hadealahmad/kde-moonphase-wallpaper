/*
 * test_prayer.mjs -- Node test harness for contents/code/prayer.js
 *
 * Run with:  node tests/test_prayer.mjs
 *
 * The delivered prayer.js begins with `.pragma library`, which is valid QML
 * but not JavaScript. It is stripped only in memory before evaluation; the
 * file on disk is never modified.
 *
 * Reference prayer timings are the AlAdhan v1 timings for 2026-06-21 and
 * 2026-12-21 (method 5 Cairo, method 4 Makkah, method 3 Istanbul). The
 * offline model is expected to agree within five minutes. The AlAdhan parser
 * is exercised separately with canned JSON so no network access is needed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "..", "contents", "code", "prayer.js");
const source = fs.readFileSync(sourcePath, "utf8");

/* ---- load the ES5 library without touching the pragma on disk ---- */
const pragmaMatch = /^\s*\.pragma\s+library\s*(?:\r?\n|$)/.exec(source);
if (!pragmaMatch) {
    console.error("FAIL  prayer.js does not start with '.pragma library'");
    process.exit(1);
}
const jsBody = source.slice(pragmaMatch[0].length);

let lib;
try {
    lib = new Function(
        jsBody +
            "\nreturn {" +
            " getPrayerState: getPrayerState," +
            " fetchPrayerTimesAsync: fetchPrayerTimesAsync," +
            " parseAlAdhanResponse: parseAlAdhanResponse," +
            " injectCacheForTest: injectCacheForTest," +
            " clearCacheForTest: clearCacheForTest," +
            " parseHHMM: parseHHMM," +
            " formatHHMM: formatHHMM," +
            " METHODS: METHODS" +
            " };"
    )();
} catch (err) {
    console.error("FAIL  could not evaluate prayer.js:", err.message);
    process.exit(1);
}

const {
    getPrayerState,
    fetchPrayerTimesAsync,
    parseAlAdhanResponse,
    injectCacheForTest,
    clearCacheForTest,
    parseHHMM,
    formatHHMM,
    METHODS
} = lib;

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

function finite(value, label) {
    assert(
        typeof value === "number" && isFinite(value),
        `${label} is not a finite number (got ${value})`
    );
}

const PRAYER_NAMES = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
const OBLIGATORY = [0, 2, 3, 4, 5];

function timingValues(st) {
    return [
        st.fajrHours,
        st.sunriseHours,
        st.dhuhrHours,
        st.asrHours,
        st.maghribHours,
        st.ishaHours
    ];
}

function state(date, lat = 30.0, lon = 31.2, method = 5, school = 0,
        tzMinutes = 180, includeSunrise = false) {
    return getPrayerState(
        date,
        lat,
        lon,
        method,
        school,
        includeSunrise,
        tzMinutes
    );
}

function expectedHHMM(hours) {
    let h = hours % 24;
    if (h < 0) h += 24;
    let total = Math.round(h * 60) % 1440;
    if (total < 0) total += 1440;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function expectedNext(st, t, includeSunrise) {
    const hours = timingValues(st);
    const order = includeSunrise ? [0, 1, 2, 3, 4, 5] : OBLIGATORY;

    let index = -1;
    for (const i of order) {
        if (hours[i] > t) {
            index = i;
            break;
        }
    }

    let wrapped = false;
    if (index === -1) {
        index = 0;
        wrapped = true;
    }

    const nextHours = hours[index];
    const minutes = wrapped
        ? Math.round(((24.0 - t) + hours[0]) * 60.0)
        : Math.round((nextHours - t) * 60.0);

    return { index, nextHours, minutes, wrapped };
}

/* ---- 1. pragma library and conservative ES5 source ---- */
test("pragma library and conservative ES5 source", () => {
    assert(
        /^\s*\.pragma\s+library/.test(source),
        "prayer.js must start with .pragma library"
    );

    const withoutComments = jsBody
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

    assert(
        !/\b(?:let|const|class)\b/.test(withoutComments),
        "found let/const/class in library"
    );
    assert(!/=>/.test(withoutComments), "found arrow function in library");
    assert(!/`/.test(withoutComments), "found template literal in library");
    assert(
        !/\b(?:require|import)\s*\(/.test(withoutComments),
        "library must be dependency-free"
    );
    assert(
        !/\b(?:async|await)\b/.test(withoutComments),
        "found async/await in library"
    );
    assert(!/\?\./.test(withoutComments), "found optional chaining in library");
});

/* ---- 2. contract completeness and ranges ---- */
test("API returns every contract field with valid ranges", () => {
    const st = state(utc(2026, 6, 21, 12), 30.0, 31.2, 5, 0, 180);

    const numeric = [
        "fajrHours",
        "sunriseHours",
        "dhuhrHours",
        "asrHours",
        "maghribHours",
        "ishaHours",
        "localTimeHours",
        "nextPrayerHours",
        "minutesToNextPrayer"
    ];
    for (const key of numeric) {
        finite(st[key], key);
    }

    for (const key of [
        "fajrHours",
        "sunriseHours",
        "dhuhrHours",
        "asrHours",
        "maghribHours",
        "ishaHours",
        "localTimeHours",
        "nextPrayerHours"
    ]) {
        assert(
            st[key] >= 0 && st[key] < 24,
            `${key} out of [0,24): ${st[key]}`
        );
    }

    assert(
        Number.isInteger(st.currentPrayerIndex) &&
            st.currentPrayerIndex >= 0 &&
            st.currentPrayerIndex <= 5,
        `currentPrayerIndex out of 0..5: ${st.currentPrayerIndex}`
    );
    assert(
        Number.isInteger(st.nextPrayerIndex) &&
            st.nextPrayerIndex >= 0 &&
            st.nextPrayerIndex <= 5,
        `nextPrayerIndex out of 0..5: ${st.nextPrayerIndex}`
    );
    assert(
        Number.isInteger(st.minutesToNextPrayer) &&
            st.minutesToNextPrayer >= 0 &&
            st.minutesToNextPrayer <= 1440,
        `minutesToNextPrayer out of 0..1440: ${st.minutesToNextPrayer}`
    );

    assert(typeof st.isPm === "boolean", "isPm is not a boolean");
    assert(st.isPm === (st.localTimeHours >= 12.0), "isPm disagrees with localTimeHours");

    assert(PRAYER_NAMES.includes(st.currentPrayerName), `bad currentPrayerName: ${st.currentPrayerName}`);
    assert(PRAYER_NAMES.includes(st.nextPrayerName), `bad nextPrayerName: ${st.nextPrayerName}`);
    assert(st.currentPrayerName === PRAYER_NAMES[st.currentPrayerIndex], "currentPrayerName/index mismatch");
    assert(st.nextPrayerName === PRAYER_NAMES[st.nextPrayerIndex], "nextPrayerName/index mismatch");
    assert(st.methodName === "Egyptian", `methodName: ${st.methodName}`);
    assert(st.source === "offline", `expected offline source, got ${st.source}`);

    assert(st.formatted && typeof st.formatted === "object", "formatted missing");
    const formattedKeys = [
        "fajr",
        "sunrise",
        "dhuhr",
        "asr",
        "maghrib",
        "isha",
        "localTime"
    ];
    for (const key of formattedKeys) {
        assert(
            typeof st.formatted[key] === "string" &&
                /^\d{2}:\d{2}$/.test(st.formatted[key]),
            `formatted.${key} is not HH:MM: ${st.formatted[key]}`
        );
    }

    assert(
        st.formatted.fajr === expectedHHMM(st.fajrHours),
        `formatted fajr: ${st.formatted.fajr}`
    );
    assert(
        st.formatted.sunrise === expectedHHMM(st.sunriseHours),
        `formatted sunrise: ${st.formatted.sunrise}`
    );
    assert(
        st.formatted.dhuhr === expectedHHMM(st.dhuhrHours),
        `formatted dhuhr: ${st.formatted.dhuhr}`
    );
    assert(
        st.formatted.asr === expectedHHMM(st.asrHours),
        `formatted asr: ${st.formatted.asr}`
    );
    assert(
        st.formatted.maghrib === expectedHHMM(st.maghribHours),
        `formatted maghrib: ${st.formatted.maghrib}`
    );
    assert(
        st.formatted.isha === expectedHHMM(st.ishaHours),
        `formatted isha: ${st.formatted.isha}`
    );
    assert(
        st.formatted.localTime === expectedHHMM(st.localTimeHours),
        `formatted localTime: ${st.formatted.localTime}`
    );
});

test("safe defaults for missing/invalid arguments", () => {
    let st;
    try {
        st = getPrayerState();
    } catch (err) {
        throw new Error(`threw with no arguments: ${err.message}`);
    }

    for (const key of [
        "fajrHours",
        "sunriseHours",
        "dhuhrHours",
        "asrHours",
        "maghribHours",
        "ishaHours",
        "localTimeHours"
    ]) {
        finite(st[key], `default ${key}`);
    }
    assert(st.methodName === "MWL", `default method: ${st.methodName}`);
    assert(st.observerLatDeg === 30.0, `default latitude: ${st.observerLatDeg}`);
    assert(st.observerLonDeg === 31.2, `default longitude: ${st.observerLonDeg}`);

    const invalid = getPrayerState(
        new Date(NaN),
        NaN,
        NaN,
        NaN,
        NaN,
        NaN,
        NaN
    );
    finite(invalid.fajrHours, "invalid-date fajrHours");
    assert(invalid.methodName === "MWL", "invalid method must fall back to MWL");

    /* Unknown method ids fall back to MWL; longitude wraps, latitude clamps
       for the zenith math while the raw observer value is preserved. */
    const fallback = getPrayerState(utc(2026, 6, 21, 12), 80, 190, 99, 0, false, 0);
    assert(fallback.methodName === "MWL", `unknown method: ${fallback.methodName}`);
    assert(fallback.observerLatDeg === 80, "raw latitude must be preserved");
    close(fallback.observerLonDeg, -170, 1e-12, "wrapped longitude");
    assert(fallback.source === "offline", "offline source expected");
});

test("all supported methods expose the documented parameters", () => {
    const expected = {
        1: [18.0, 18.0, 0, "Karachi"],
        2: [15.0, 15.0, 0, "ISNA"],
        3: [18.0, 17.0, 0, "MWL"],
        4: [18.5, 0.0, 90, "Umm al-Qura"],
        5: [19.5, 17.5, 0, "Egyptian"],
        7: [17.7, 14.0, 0, "Tehran"],
        13: [18.0, 17.0, 0, "Diyanet"]
    };

    for (const id of Object.keys(expected)) {
        const m = METHODS[id];
        assert(m, `METHODS[${id}] missing`);
        close(m.fajrAngle, expected[id][0], 1e-12, `method ${id} fajrAngle`);
        close(m.ishaAngle, expected[id][1], 1e-12, `method ${id} ishaAngle`);
        close(m.ishaMinutes, expected[id][2], 1e-12, `method ${id} ishaMinutes`);
        assert(m.name === expected[id][3], `method ${id} name: ${m.name}`);
    }
});

/* ---- 3. strict chronological ordering across seasons and latitudes ---- */
test("timings are strictly ordered across seasons and latitudes", () => {
    const seasons = [
        { month: 3, day: 20, label: "March equinox" },
        { month: 6, day: 21, label: "June solstice" },
        { month: 9, day: 23, label: "September equinox" },
        { month: 12, day: 21, label: "December solstice" }
    ];
    const latitudes = [-55, -40, -30, -10, 0, 10, 30, 45, 60];
    const longitudes = [0, 31.2, -74.0, 120.0];

    let checked = 0;
    for (const season of seasons) {
        for (const lat of latitudes) {
            for (const lon of longitudes) {
                const tzMinutes = Math.round((lon / 15.0) * 60.0);
                const st = getPrayerState(
                    utc(2026, season.month, season.day, 12),
                    lat,
                    lon,
                    3,
                    0,
                    false,
                    tzMinutes
                );
                const h = timingValues(st);
                for (let i = 0; i < h.length; i++) {
                    finite(h[i], `${season.label} lat ${lat} ${PRAYER_NAMES[i]}`);
                    assert(
                        h[i] >= 0 && h[i] < 24,
                        `${season.label} lat ${lat} lon ${lon}: ` +
                            `${PRAYER_NAMES[i]} out of [0,24): ${h[i]}`
                    );
                }

                let previous = h[0];
                assert(previous >= 0, `${season.label} lat ${lat}: fajr < 0`);
                for (let i = 1; i < h.length; i++) {
                    assert(
                        h[i] > previous,
                        `${season.label} lat ${lat} lon ${lon}: ` +
                            `${PRAYER_NAMES[i]} (${h[i]}) is not after ` +
                            `${PRAYER_NAMES[i - 1]} (${previous})`
                    );
                    previous = h[i];
                }
                assert(
                    previous < 24,
                    `${season.label} lat ${lat} lon ${lon}: isha >= 24`
                );
                checked++;
            }
        }
    }
    assert(checked === 144, `expected 144 combinations, got ${checked}`);
});

/* ---- 4. reference timings (AlAdhan) ---- */
test("reference timings agree within five minutes", () => {
    const references = [
        {
            label: "Cairo 2026-06-21 (Egyptian)",
            date: utc(2026, 6, 21, 12),
            lat: 30.0,
            lon: 31.2,
            method: 5,
            tzMinutes: 180,
            expected: [
                4 + 9 / 60,
                5 + 55 / 60,
                12 + 57 / 60,
                16 + 32 / 60,
                19 + 59 / 60,
                21 + 33 / 60
            ]
        },
        {
            label: "Cairo 2026-12-21 (Egyptian)",
            date: utc(2026, 12, 21, 12),
            lat: 30.0,
            lon: 31.2,
            method: 5,
            tzMinutes: 120,
            expected: [
                5 + 14 / 60,
                6 + 47 / 60,
                11 + 53 / 60,
                14 + 41 / 60,
                17 + 0 / 60,
                18 + 23 / 60
            ]
        },
        {
            label: "Makkah 2026-06-21 (Umm al-Qura)",
            date: utc(2026, 6, 21, 12),
            lat: 21.42,
            lon: 39.83,
            method: 4,
            tzMinutes: 180,
            expected: [
                4 + 11 / 60,
                5 + 39 / 60,
                12 + 22 / 60,
                15 + 42 / 60,
                19 + 6 / 60,
                20 + 36 / 60
            ]
        },
        {
            label: "Istanbul 2026-06-21 (MWL)",
            date: utc(2026, 6, 21, 12),
            lat: 41.01,
            lon: 28.98,
            method: 3,
            tzMinutes: 180,
            expected: [
                3 + 24 / 60,
                5 + 32 / 60,
                13 + 6 / 60,
                17 + 7 / 60,
                20 + 40 / 60,
                22 + 38 / 60
            ]
        }
    ];

    const toleranceMinutes = 5.0;

    for (const ref of references) {
        const st = getPrayerState(
            ref.date,
            ref.lat,
            ref.lon,
            ref.method,
            0,
            false,
            ref.tzMinutes
        );
        const actual = timingValues(st);
        for (let i = 0; i < actual.length; i++) {
            const diffMinutes = Math.abs(actual[i] - ref.expected[i]) * 60.0;
            assert(
                diffMinutes <= toleranceMinutes,
                `${ref.label} ${PRAYER_NAMES[i]}: model ` +
                    `${formatHHMM(actual[i])}, reference ` +
                    `${formatHHMM(ref.expected[i])}, ` +
                    `difference ${diffMinutes.toFixed(1)} min`
            );
        }
        console.log(
            `      ${ref.label}: ` +
                actual
                    .map((h, i) => `${PRAYER_NAMES[i]} ${formatHHMM(h)}`)
                    .join(", ")
        );
    }
});

/* ---- 5. Hanafi Asr is later than Standard Asr ---- */
test("Hanafi Asr is 30-75 minutes after Standard Asr", () => {
    const cases = [
        {
            label: "Cairo 2026-03-20",
            date: utc(2026, 3, 20, 12),
            lat: 30.0,
            lon: 31.2,
            method: 5,
            tzMinutes: 120
        },
        {
            label: "Cairo 2026-12-21",
            date: utc(2026, 12, 21, 12),
            lat: 30.0,
            lon: 31.2,
            method: 5,
            tzMinutes: 120
        },
        {
            label: "Istanbul 2026-03-20",
            date: utc(2026, 3, 20, 12),
            lat: 41.01,
            lon: 28.98,
            method: 3,
            tzMinutes: 180
        },
        {
            label: "Makkah 2026-03-20",
            date: utc(2026, 3, 20, 12),
            lat: 21.42,
            lon: 39.83,
            method: 4,
            tzMinutes: 180
        },
        {
            label: "Makkah 2026-12-21",
            date: utc(2026, 12, 21, 12),
            lat: 21.42,
            lon: 39.83,
            method: 4,
            tzMinutes: 180
        }
    ];

    for (const c of cases) {
        const standard = getPrayerState(
            c.date, c.lat, c.lon, c.method, 0, false, c.tzMinutes
        );
        const hanafi = getPrayerState(
            c.date, c.lat, c.lon, c.method, 1, false, c.tzMinutes
        );
        const diffMinutes = (hanafi.asrHours - standard.asrHours) * 60.0;

        assert(
            hanafi.asrHours > standard.asrHours,
            `${c.label}: Hanafi Asr is not later`
        );
        assert(
            diffMinutes >= 30.0 && diffMinutes <= 75.0,
            `${c.label}: Hanafi-Asr difference ${diffMinutes.toFixed(1)} min ` +
                "is outside 30..75"
        );
        console.log(
            `      ${c.label}: standard ${formatHHMM(standard.asrHours)}, ` +
                `Hanafi ${formatHHMM(hanafi.asrHours)} ` +
                `(+${diffMinutes.toFixed(1)} min)`
        );
    }

    /* The later direction must hold across the whole sampled grid too. */
    for (const lat of [-55, -30, 0, 30, 60]) {
        for (const month of [3, 6, 9, 12]) {
            const date = utc(2026, month, 21, 12);
            const standard = getPrayerState(date, lat, 0, 3, 0, false, 0);
            const hanafi = getPrayerState(date, lat, 0, 3, 1, false, 0);
            assert(
                hanafi.asrHours > standard.asrHours,
                `lat ${lat} month ${month}: Hanafi Asr not later`
            );
        }
    }
});

/* ---- 6. Umm al-Qura Isha is exactly 90 minutes after Maghrib ---- */
test("Umm al-Qura places Isha exactly 1.5 hours after Maghrib", () => {
    const dates = [
        utc(2026, 3, 20, 12),
        utc(2026, 6, 21, 12),
        utc(2026, 9, 23, 12),
        utc(2026, 12, 21, 12)
    ];
    const latitudes = [-30, 0, 21.42, 41.01, 60];

    for (const date of dates) {
        for (const lat of latitudes) {
            const st = getPrayerState(date, lat, 39.83, 4, 0, false, 180);
            close(
                st.ishaHours - st.maghribHours,
                1.5,
                1e-9,
                `lat ${lat} ${date.toISOString().slice(0, 10)} ` +
                    "Umm al-Qura isha - maghrib"
            );
            assert(st.methodName === "Umm al-Qura", `method name: ${st.methodName}`);
        }
    }
});

/* ---- 7. next-prayer transitions across the whole day ---- */
test("next prayer transitions correctly across all 24 hours", () => {
    const base = Date.UTC(2026, 5, 21, 0, 0, 0); /* local 2026-06-21 in UTC+3 */
    const tzMinutes = 180;
    const hours = [];

    for (let h = 0; h < 24; h += 0.5) {
        const date = new Date(base + (h - 3) * 3600 * 1000);
        const st = getPrayerState(date, 30.0, 31.2, 5, 0, false, tzMinutes);
        close(st.localTimeHours, h, 1e-9, `local time at ${h}`);

        const times = timingValues(st);
        const expected = expectedNext(st, h, false);

        assert(
            st.nextPrayerIndex === expected.index,
            `local ${h}: next index ${st.nextPrayerIndex}, ` +
                `expected ${expected.index}`
        );
        assert(
            st.nextPrayerName === PRAYER_NAMES[expected.index],
            `local ${h}: next name ${st.nextPrayerName}`
        );
        close(
            st.nextPrayerHours,
            times[expected.index],
            1e-12,
            `local ${h}: nextPrayerHours`
        );
        close(
            st.minutesToNextPrayer,
            expected.minutes,
            1,
            `local ${h}: minutesToNextPrayer`
        );

        let currentIndex;
        if (h < times[0]) {
            currentIndex = 5;
        } else {
            currentIndex = 0;
            for (let i = 1; i < times.length; i++) {
                if (times[i] <= h) currentIndex = i;
            }
        }
        assert(
            st.currentPrayerIndex === currentIndex,
            `local ${h}: current index ${st.currentPrayerIndex}, ` +
                `expected ${currentIndex}`
        );

        hours.push(h);
    }

    assert(hours.length === 48, `expected 48 samples, got ${hours.length}`);
});

test("post-Isha wraps to Fajr with accurate minutes", () => {
    const base = Date.UTC(2026, 5, 21, 0, 0, 0);
    const date = new Date(base + (22.5 - 3) * 3600 * 1000);
    const st = getPrayerState(date, 30.0, 31.2, 5, 0, false, 180);

    close(st.localTimeHours, 22.5, 1e-9, "post-Isha local time");
    assert(st.localTimeHours > st.ishaHours, "sample must be after Isha");
    assert(st.nextPrayerIndex === 0, `next index: ${st.nextPrayerIndex}`);
    assert(st.nextPrayerName === "Fajr", `next name: ${st.nextPrayerName}`);
    close(st.nextPrayerHours, st.fajrHours, 1e-12, "wrapped nextPrayerHours");

    const expectedMinutes = Math.round(
        ((24.0 - st.localTimeHours) + st.fajrHours) * 60.0
    );
    close(st.minutesToNextPrayer, expectedMinutes, 1, "wrapped minutes");
    assert(
        st.minutesToNextPrayer > 0 && st.minutesToNextPrayer < 1440,
        `wrapped minutes out of range: ${st.minutesToNextPrayer}`
    );
    console.log(
        `      22:30 -> Fajr in ${st.minutesToNextPrayer} min ` +
            `(Fajr ${formatHHMM(st.fajrHours)})`
    );
});

test("pre-dawn and Sunrise inclusion behave as documented", () => {
    const base = Date.UTC(2026, 5, 21, 0, 0, 0);
    const tzMinutes = 180;

    /* 02:00 local: before Fajr, current is the previous Isha, next Fajr. */
    const predawn = new Date(base + (2.0 - 3) * 3600 * 1000);
    const a = getPrayerState(predawn, 30.0, 31.2, 5, 0, false, tzMinutes);
    assert(a.currentPrayerIndex === 5, `pre-dawn current: ${a.currentPrayerIndex}`);
    assert(a.currentPrayerName === "Isha", `pre-dawn current name: ${a.currentPrayerName}`);
    assert(a.nextPrayerIndex === 0, `pre-dawn next: ${a.nextPrayerIndex}`);
    close(
        a.minutesToNextPrayer,
        Math.round((a.fajrHours - a.localTimeHours) * 60.0),
        1,
        "pre-dawn minutes"
    );

    /* 04:30 local: after Fajr, before Sunrise. */
    const afterFajr = new Date(base + (4.5 - 3) * 3600 * 1000);
    const skip = getPrayerState(afterFajr, 30.0, 31.2, 5, 0, false, tzMinutes);
    const withSunrise = getPrayerState(afterFajr, 30.0, 31.2, 5, 0, true, tzMinutes);

    assert(skip.nextPrayerIndex === 2, `skip-Sunrise next: ${skip.nextPrayerIndex}`);
    assert(skip.nextPrayerName === "Dhuhr", `skip-Sunrise name: ${skip.nextPrayerName}`);
    assert(
        withSunrise.nextPrayerIndex === 1,
        `include-Sunrise next: ${withSunrise.nextPrayerIndex}`
    );
    assert(
        withSunrise.nextPrayerName === "Sunrise",
        `include-Sunrise name: ${withSunrise.nextPrayerName}`
    );
    assert(
        Math.abs(skip.sunriseHours - withSunrise.sunriseHours) < 1e-12,
        "sunriseHours must always be returned"
    );
});

/* ---- 8. AlAdhan parser, cache injection and offline fetch fallback ---- */
test("parseAlAdhanResponse parses HH:MM strings with timezone suffixes", () => {
    const json = {
        code: 200,
        status: "OK",
        data: {
            timings: {
                Fajr: "04:52 (EEST)",
                Sunrise: "06:12 (EEST)",
                Dhuhr: "12:47 (EEST)",
                Asr: "16:20 (EEST)",
                Maghrib: "19:22 (EEST)",
                Isha: "20:52 (EEST)"
            }
        }
    };

    const parsed = parseAlAdhanResponse(json);
    assert(parsed && typeof parsed === "object", "parser returned nothing");

    close(parsed.fajr, 4 + 52 / 60, 1e-12, "parsed Fajr");
    close(parsed.sunrise, 6 + 12 / 60, 1e-12, "parsed Sunrise");
    close(parsed.dhuhr, 12 + 47 / 60, 1e-12, "parsed Dhuhr");
    close(parsed.asr, 16 + 20 / 60, 1e-12, "parsed Asr");
    close(parsed.maghrib, 19 + 22 / 60, 1e-12, "parsed Maghrib");
    close(parsed.isha, 20 + 52 / 60, 1e-12, "parsed Isha");

    /* Suffix-free and numeric values are accepted too. */
    close(parseHHMM("05:07"), 5 + 7 / 60, 1e-12, "parseHHMM plain");
    close(parseHHMM(5.5), 5.5, 1e-12, "parseHHMM numeric");
    assert(Number.isNaN(parseHHMM("not-a-time")), "invalid time must be NaN");
    assert(parseAlAdhanResponse(null) === null, "null payload must return null");
    assert(parseAlAdhanResponse({ data: {} }) === null, "missing timings must return null");
});

test("cache injection overrides offline timings and reports source api", () => {
    clearCacheForTest();

    const date = utc(2026, 6, 21, 12);
    const key = injectCacheForTest(date, 30.0, 31.2, 5, 0, {
        fajr: "04:52 (EEST)",
        sunrise: "06:12 (EEST)",
        dhuhr: "12:47 (EEST)",
        asr: "16:20 (EEST)",
        maghrib: "19:22 (EEST)",
        isha: "20:52 (EEST)",
        tzHours: 3
    });

    assert(typeof key === "string" && key.includes("2026-06-21"), `cache key: ${key}`);

    const st = getPrayerState(date, 30.0, 31.2, 5, 0, false, 180);
    assert(st.source === "api", `expected api source, got ${st.source}`);

    close(st.fajrHours, 4 + 52 / 60, 1e-12, "cached Fajr");
    close(st.sunriseHours, 6 + 12 / 60, 1e-12, "cached Sunrise");
    close(st.dhuhrHours, 12 + 47 / 60, 1e-12, "cached Dhuhr");
    close(st.asrHours, 16 + 20 / 60, 1e-12, "cached Asr");
    close(st.maghribHours, 19 + 22 / 60, 1e-12, "cached Maghrib");
    close(st.ishaHours, 20 + 52 / 60, 1e-12, "cached Isha");

    assert(st.formatted.fajr === "04:52", `cached formatted Fajr: ${st.formatted.fajr}`);
    assert(st.formatted.isha === "20:52", `cached formatted Isha: ${st.formatted.isha}`);
    assert(st.methodName === "Egyptian", `cached method: ${st.methodName}`);

    /* The cache is daily and keyed by method/school. */
    const nextDay = getPrayerState(utc(2026, 6, 22, 12), 30.0, 31.2, 5, 0, false, 180);
    assert(nextDay.source === "offline", "cache must be per-day");

    const hanafi = getPrayerState(date, 30.0, 31.2, 5, 1, false, 180);
    assert(hanafi.source === "offline", "cache must be keyed by Asr school");

    /* The tzHours hint is used when no explicit override is supplied. */
    const hinted = getPrayerState(date, 30.0, 31.2, 5, 0);
    close(hinted.tzHours, 3, 1e-12, "cached tzHours hint");

    /* A cached fetch must call back synchronously, exactly once. */
    let calls = 0;
    let fetched = null;
    fetchPrayerTimesAsync(date, 30.0, 31.2, 5, 0, function (result) {
        calls++;
        fetched = result;
    });
    assert(calls === 1, `cached fetch callback count: ${calls}`);
    assert(fetched && fetched.source === "api", "cached fetch must report api");

    /* Without XMLHttpRequest (Node) and without a cache entry, the fetch
       falls back to the offline model exactly once. */
    clearCacheForTest();
    calls = 0;
    fetched = null;
    fetchPrayerTimesAsync(utc(2026, 6, 23, 12), 30.0, 31.2, 5, 0, function (result) {
        calls++;
        fetched = result;
    });
    assert(calls === 1, `offline fetch callback count: ${calls}`);
    assert(fetched && fetched.source === "offline", "offline fetch must report offline");
    finite(fetched.fajrHours, "offline fetch fajrHours");
});

/* ---- summary ---- */
console.log("");
console.log(`tests: ${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);

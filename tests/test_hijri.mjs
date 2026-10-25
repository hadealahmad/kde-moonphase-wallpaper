/*
 * test_hijri.mjs -- Node test harness for contents/code/hijri.js
 *
 * Run with:  node tests/test_hijri.mjs
 *
 * The delivered hijri.js begins with `.pragma library`, which is valid QML
 * but not JavaScript. It is stripped only in memory before evaluation; the
 * file on disk is never modified.
 *
 * Reference dates (Umm al-Qura, HJCoSA) cross-checked against
 * https://api.aladhan.com/v1/gToH/<DD-MM-YYYY>:
 *   1937-03-14 -> 1356-01-01  Sunday     (table start)
 *   1937-05-11 -> 1356-03-01  Tuesday
 *   2000-01-01 -> 1420-09-24  Saturday
 *   2025-03-01 -> 1446-09-01  Saturday
 *   2026-02-18 -> 1447-09-01  Wednesday
 *   2026-06-16 -> 1448-01-01  Tuesday
 *   2026-10-25 -> 1448-05-14  Sunday
 *   2030-01-05 -> 1451-09-01  Saturday
 *   2050-01-01 -> 1472-04-07  Saturday
 *   2077-01-01 -> 1500-02-06  Friday
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "..", "contents", "code", "hijri.js");
const source = fs.readFileSync(sourcePath, "utf8");

/* ---- load the ES5 library without touching the pragma on disk ---- */
const pragmaMatch = /^\s*\.pragma\s+library\s*(?:\r?\n|$)/.exec(source);
if (!pragmaMatch) {
    console.error("FAIL  hijri.js does not start with '.pragma library'");
    process.exit(1);
}
const jsBody = source.slice(pragmaMatch[0].length);
let getHijriDate;
try {
    getHijriDate = new Function(
        jsBody + "\nreturn getHijriDate;"
    )();
} catch (err) {
    console.error("FAIL  could not evaluate hijri.js:", err.message);
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

/* Noon local time keeps the local calendar day unambiguous. */
function local(year, month1, day) {
    return new Date(year, month1 - 1, day, 12, 0, 0);
}

function checkDate(year, month1, day, hYear, hMonth, hDay, weekday, monthName, weekdayName) {
    const h = getHijriDate(local(year, month1, day));
    const label = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    assert(h.year === hYear, `${label}: year ${h.year}, expected ${hYear}`);
    assert(h.month === hMonth, `${label}: month ${h.month}, expected ${hMonth}`);
    assert(h.day === hDay, `${label}: day ${h.day}, expected ${hDay}`);
    assert(h.source === "umm-al-qura", `${label}: source ${h.source}`);
    if (weekday !== undefined) {
        assert(h.weekday === weekday, `${label}: weekday ${h.weekday}, expected ${weekday}`);
    }
    if (monthName !== undefined) {
        assert(h.monthName === monthName, `${label}: monthName ${h.monthName}, expected ${monthName}`);
    }
    if (weekdayName !== undefined) {
        assert(h.weekdayName === weekdayName, `${label}: weekdayName ${h.weekdayName}, expected ${weekdayName}`);
    }
    return h;
}

/* ---- Umm al-Qura anchor dates ---- */
test("table start 1937-03-14 -> 1356-01-01 (Sunday)", () => {
    checkDate(1937, 3, 14, 1356, 1, 1, 0, "محرم", "الأحد");
});

test("1937-05-11 -> 1356-03-01 (Tuesday)", () => {
    checkDate(1937, 5, 11, 1356, 3, 1, 2, "ربيع الأول", "الثلاثاء");
});

test("2000-01-01 -> 1420-09-24 (Saturday)", () => {
    checkDate(2000, 1, 1, 1420, 9, 24, 6, "رمضان", "السبت");
});

test("2025-03-01 -> 1446-09-01 (Saturday)", () => {
    checkDate(2025, 3, 1, 1446, 9, 1, 6, "رمضان", "السبت");
});

test("2026-02-18 -> 1447-09-01 (Wednesday)", () => {
    checkDate(2026, 2, 18, 1447, 9, 1, 3, "رمضان", "الأربعاء");
});

test("2026-06-16 -> 1448-01-01 (Tuesday)", () => {
    checkDate(2026, 6, 16, 1448, 1, 1, 2, "محرم", "الثلاثاء");
});

test("2026-10-25 -> 1448-05-14 (Sunday)", () => {
    checkDate(2026, 10, 25, 1448, 5, 14, 0, "جمادى الأولى", "الأحد");
});

test("2030-01-05 -> 1451-09-01 (Saturday)", () => {
    checkDate(2030, 1, 5, 1451, 9, 1, 6, "رمضان", "السبت");
});

test("2050-01-01 -> 1472-04-07 (Saturday)", () => {
    checkDate(2050, 1, 1, 1472, 4, 7, 6, "ربيع الآخر", "السبت");
});

test("table end 2077-01-01 -> 1500-02-06 (Friday)", () => {
    checkDate(2077, 1, 1, 1500, 2, 6, 5, "صفر", "الجمعة");
});

/* ---- month rollover consistency ---- */
test("consecutive Umm al-Qura days are contiguous", () => {
    let previous = getHijriDate(local(2026, 1, 1));
    const end = local(2026, 12, 31);
    for (let d = local(2026, 1, 2); d <= end; d.setDate(d.getDate() + 1)) {
        const current = getHijriDate(d);
        const expectedDay = previous.day + 1;
        if (current.month === previous.month && current.year === previous.year) {
            assert(current.day === expectedDay,
                   `day jumped from ${previous.day} to ${current.day} on ${d.toDateString()}`);
        } else {
            assert(current.day === 1,
                   `month change did not start at day 1 on ${d.toDateString()}`);
            assert(current.month === (previous.month % 12) + 1,
                   `month skipped on ${d.toDateString()}`);
        }
        previous = current;
    }
});

/* ---- fallback outside the tabulated range ---- */
test("dates before the table fall back to the tabular calendar", () => {
    const h = getHijriDate(local(1900, 1, 1));
    assert(h.source === "tabular", `source ${h.source}`);
    assert(h.year === 1317 && h.month === 8 && h.day === 28,
           `1900-01-01 -> ${h.year}-${h.month}-${h.day}`);
    assert(h.monthName === "شعبان", `monthName ${h.monthName}`);
});

test("dates after the table fall back to the tabular calendar", () => {
    const h = getHijriDate(local(2200, 1, 1));
    assert(h.source === "tabular", `source ${h.source}`);
    assert(h.year === 1626 && h.month === 11 && h.day === 14,
           `2200-01-01 -> ${h.year}-${h.month}-${h.day}`);
    assert(h.monthName === "ذو القعدة", `monthName ${h.monthName}`);
});

test("month and weekday name tables are complete and unique", () => {
    const months = new Set();
    const weekdays = new Set();
    const cursor = local(2026, 1, 1);
    for (let i = 0; i < 400; ++i) {
        const h = getHijriDate(cursor);
        months.add(h.monthName);
        weekdays.add(h.weekdayName);
        cursor.setDate(cursor.getDate() + 1);
    }
    assert(months.size === 12, `found ${months.size} month names`);
    assert(weekdays.size === 7, `found ${weekdays.size} weekday names`);
});

/* ---- summary ---- */
console.log("");
console.log(`tests: ${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);

.pragma library

/*
 * prayer.js -- dependency-free daily prayer-time calculation.
 *
 * The solar geometry is a compact low-precision model (Meeus ch. 25 / 28):
 *   - Julian Date at local noon
 *   - solar mean anomaly, true longitude, obliquity and declination
 *   - equation of time from the mean-vs-apparent right ascension difference
 *
 * All timings are returned as local clock hours in [0, 24). When the AlAdhan
 * daily cache holds a valid entry for the same day/location/method, its
 * timings replace the offline ones and `source` becomes "api"; otherwise the
 * deterministic offline model is used.
 *
 * Deliberately written in conservative ES5 (var/function only) because
 * .pragma library files are evaluated by the QML JavaScript engine.
 *
 * Public API (also used by tests/test_prayer.mjs):
 *   getPrayerState(date, lat, lon, methodId, asrSchool,
 *                  includeSunriseInNext, utcOffsetMinutesOverride) -> object
 *   fetchPrayerTimesAsync(date, lat, lon, methodId, asrSchool, callback)
 *   parseAlAdhanResponse(jsonObj) -> timings object | null
 *   injectCacheForTest(date, lat, lon, methodId, asrSchool, timingsObj)
 */

var RAD = Math.PI / 180;
var DEG = 180 / Math.PI;

var DEFAULT_LATITUDE = 30.0;
var DEFAULT_LONGITUDE = 31.2;
var DEFAULT_METHOD_ID = 3;
var LATITUDE_LIMIT = 65.0;

/* Indices are stable across the whole public contract. */
var PRAYER_NAMES = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
var OBLIGATORY_INDICES = [0, 2, 3, 4, 5];
var ALL_INDICES = [0, 1, 2, 3, 4, 5];
var TIMING_KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
var ALADHAN_KEYS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

/*
 * Supported calculation methods.
 *   fajrAngle / ishaAngle : solar depression in degrees
 *   ishaMinutes > 0       : Isha is that many minutes after Maghrib
 */
var METHODS = {
    1: {
        fajrAngle: 18.0,
        ishaAngle: 18.0,
        ishaMinutes: 0,
        name: "Karachi"
    },
    2: {
        fajrAngle: 15.0,
        ishaAngle: 15.0,
        ishaMinutes: 0,
        name: "ISNA"
    },
    3: {
        fajrAngle: 18.0,
        ishaAngle: 17.0,
        ishaMinutes: 0,
        name: "MWL"
    },
    4: {
        fajrAngle: 18.5,
        ishaAngle: 0.0,
        ishaMinutes: 90,
        name: "Umm al-Qura"
    },
    5: {
        fajrAngle: 19.5,
        ishaAngle: 17.5,
        ishaMinutes: 0,
        name: "Egyptian"
    },
    7: {
        fajrAngle: 17.7,
        ishaAngle: 14.0,
        ishaMinutes: 0,
        name: "Tehran"
    },
    13: {
        fajrAngle: 18.0,
        ishaAngle: 17.0,
        ishaMinutes: 0,
        name: "Diyanet"
    }
};

/* Daily AlAdhan cache: key -> { timings: {...}, tzHours: number|undefined }. */
var _apiCache = {};
/* Timezone hint cache keyed by "lat.toFixed(2)|lon.toFixed(2)". */
var _tzCache = {};

/* =====================================================================
 * Small numeric / input helpers
 * ===================================================================== */

function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
}

function pad2(value) {
    return value < 10 ? "0" + value : "" + value;
}

function wrap24(x) {
    var r = x % 24;
    if (r < 0) {
        r += 24;
    }
    return r;
}

/* Wrap degrees into [-180, 180). */
function wrap180(x) {
    var r = x % 360;
    if (r >= 180) {
        r -= 360;
    } else if (r < -180) {
        r += 360;
    }
    return r;
}

function norm360(x) {
    var r = x % 360;
    if (r < 0) {
        r += 360;
    }
    return r;
}

function clamp(value, low, high) {
    if (value < low) {
        return low;
    }
    if (value > high) {
        return high;
    }
    return value;
}

function normalizeDate(date) {
    if (!date || typeof date.getTime !== "function" || !isFinite(date.getTime())) {
        return new Date();
    }
    return date;
}

function normalizeLatitude(latitudeDeg) {
    if (!isFiniteNumber(latitudeDeg)) {
        return DEFAULT_LATITUDE;
    }
    return latitudeDeg;
}

function normalizeLongitude(longitudeDeg) {
    if (!isFiniteNumber(longitudeDeg)) {
        return DEFAULT_LONGITUDE;
    }
    return wrap180(longitudeDeg);
}

function normalizeMethodId(methodId) {
    if (!isFiniteNumber(methodId)) {
        return DEFAULT_METHOD_ID;
    }
    var id = Math.round(methodId);
    if (!METHODS[id]) {
        return DEFAULT_METHOD_ID;
    }
    return id;
}

function normalizeAsrSchool(asrSchool) {
    return asrSchool === 1 ? 1 : 0;
}

function systemTzHours(date) {
    var offset = date.getTimezoneOffset();
    if (!isFiniteNumber(offset)) {
        return 0;
    }
    return -offset / 60.0;
}

function tzCacheKey(latitudeDeg, longitudeDeg) {
    return latitudeDeg.toFixed(2) + "|" + longitudeDeg.toFixed(2);
}

function dateKey(date) {
    return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1)
        + "-" + pad2(date.getUTCDate());
}

function cacheKey(date, latitudeDeg, longitudeDeg, methodId, asrSchool) {
    return dateKey(date) + "|" + latitudeDeg.toFixed(2) + "|"
        + longitudeDeg.toFixed(2) + "|" + methodId + "|" + asrSchool;
}

/*
 * utcOffsetMinutesOverride (minutes east of UTC) wins. Next comes a cached
 * AlAdhan timezone hint for this location. Finally the local system offset is
 * used unless it disagrees with solar longitude by more than 2.5 hours, in
 * which case a longitude-derived offset is safer.
 */
function resolveTzHours(date, latitudeDeg, longitudeDeg,
        utcOffsetMinutesOverride) {
    if (isFiniteNumber(utcOffsetMinutesOverride)) {
        return utcOffsetMinutesOverride / 60.0;
    }

    var cached = _tzCache[tzCacheKey(latitudeDeg, longitudeDeg)];
    if (isFiniteNumber(cached)) {
        return cached;
    }

    var system = systemTzHours(date);
    var longitudeTz = longitudeDeg / 15.0;
    if (Math.abs(system - longitudeTz) > 2.5) {
        return Math.round(longitudeTz);
    }
    return system;
}

/* =====================================================================
 * Solar geometry
 * ===================================================================== */

/*
 * Hour angle (in hours) for the Sun reaching `altDeg` at the given latitude
 * and declination. cos(H) is clamped so circumpolar cases stay finite.
 */
function hourAngleForAltitudeDeg(altDeg, latRad, decRad) {
    var cosH = (Math.sin(altDeg * RAD)
        - Math.sin(latRad) * Math.sin(decRad))
        / (Math.cos(latRad) * Math.cos(decRad));

    if (cosH > 0.999) {
        cosH = 0.999;
    } else if (cosH < -0.999) {
        cosH = -0.999;
    }

    return Math.acos(cosH) * 12.0 / Math.PI;
}

/*
 * Solar declination and equation of time for the local calendar date, plus
 * Dhuhr in local clock hours.
 */
function computeSolarGeometry(date, longitudeDeg, tzHours) {
    var ms = date.getTime();
    var local = new Date(ms + tzHours * 3600000.0);

    var year = local.getUTCFullYear();
    var month = local.getUTCMonth();
    var day = local.getUTCDate();

    /* Julian Date at local noon (UT). */
    var noonUtcMs = Date.UTC(year, month, day, 12, 0, 0)
        - tzHours * 3600000.0;
    var jd = noonUtcMs / 86400000.0 + 2440587.5;
    var T = (jd - 2451545.0) / 36525.0;

    var T2 = T * T;

    var L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T2);
    var M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T2);
    var e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T2;
    var epsilon = 23.4392911 - 0.0130042 * T;

    var Mrad = M * RAD;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T2) * Math.sin(Mrad)
        + (0.019993 - 0.000101 * T) * Math.sin(2.0 * Mrad)
        + 0.000289 * Math.sin(3.0 * Mrad);

    var lambda = L0 + C;
    var lambdaRad = lambda * RAD;
    var epsilonRad = epsilon * RAD;

    var decRad = Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad));

    /* Equation of time = mean longitude - apparent right ascension. */
    var raDeg = Math.atan2(Math.cos(epsilonRad) * Math.sin(lambdaRad),
        Math.cos(lambdaRad)) * DEG;
    var eotHours = wrap180(L0 - raDeg) / 15.0;

    var dhuhrHours = 12.0 + tzHours - (longitudeDeg / 15.0) - eotHours
        + (2.0 / 60.0);

    return {
        decRad: decRad,
        eotHours: eotHours,
        dhuhrHours: dhuhrHours
    };
}

/* Deterministic offline timings from the solar geometry. */
function computeOfflineTimings(solar, method, latRad, shadowFactor) {
    var decRad = solar.decRad;
    var base = solar.dhuhrHours - (2.0 / 60.0);

    var fajr = base - hourAngleForAltitudeDeg(-method.fajrAngle,
        latRad, decRad);
    var sunrise = base - hourAngleForAltitudeDeg(-0.8333, latRad, decRad);
    var dhuhr = solar.dhuhrHours;

    /* Asr altitude: shadow length = shadowFactor + tan(|lat - dec|). */
    var asrAltRad = Math.atan(1.0 / (shadowFactor
        + Math.tan(Math.abs(latRad - decRad))));
    var asr = base + hourAngleForAltitudeDeg(asrAltRad * DEG,
        latRad, decRad);

    var maghrib = base + hourAngleForAltitudeDeg(-0.8333, latRad, decRad)
        + (1.0 / 60.0);

    var isha;
    if (method.ishaMinutes > 0) {
        isha = maghrib + method.ishaMinutes / 60.0;
    } else {
        isha = base + hourAngleForAltitudeDeg(-method.ishaAngle,
            latRad, decRad);
    }

    return {
        fajr: fajr,
        sunrise: sunrise,
        dhuhr: dhuhr,
        asr: asr,
        maghrib: maghrib,
        isha: isha
    };
}

/* =====================================================================
 * Formatting and AlAdhan parsing
 * ===================================================================== */

function formatHHMM(hours) {
    if (!isFiniteNumber(hours)) {
        return "--:--";
    }
    var totalMinutes = Math.round(wrap24(hours) * 60.0) % 1440;
    if (totalMinutes < 0) {
        totalMinutes += 1440;
    }
    var hh = Math.floor(totalMinutes / 60);
    var mm = totalMinutes % 60;
    return pad2(hh) + ":" + pad2(mm);
}

/* "04:52 (EEST)" or "04:52" -> 4.866666...; numbers pass through as hours. */
function parseHHMM(value) {
    if (isFiniteNumber(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return NaN;
    }

    var cleaned = value.replace(/\([^)]*\)/g, "");
    cleaned = cleaned.replace(/^\s+|\s+$/g, "");
    if (cleaned.length === 0) {
        return NaN;
    }

    var parts = cleaned.split(":");
    if (parts.length < 2) {
        return NaN;
    }

    var hh = parseInt(parts[0], 10);
    var mm = parseInt(parts[1], 10);
    var ss = parts.length > 2 ? parseInt(parts[2], 10) : 0;

    if (!isFinite(hh) || !isFinite(mm) || !isFinite(ss)) {
        return NaN;
    }
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
        return NaN;
    }

    return hh + mm / 60.0 + ss / 3600.0;
}

/* Parse an AlAdhan v1 timings payload into local clock hours. */
function parseAlAdhanResponse(jsonObj) {
    if (!jsonObj || typeof jsonObj !== "object") {
        return null;
    }

    var timings = null;
    if (jsonObj.data && jsonObj.data.timings) {
        timings = jsonObj.data.timings;
    } else if (jsonObj.timings) {
        timings = jsonObj.timings;
    }
    if (!timings) {
        return null;
    }

    return {
        fajr: parseHHMM(timings.Fajr),
        sunrise: parseHHMM(timings.Sunrise),
        dhuhr: parseHHMM(timings.Dhuhr),
        asr: parseHHMM(timings.Asr),
        maghrib: parseHHMM(timings.Maghrib),
        isha: parseHHMM(timings.Isha)
    };
}

function isValidTimings(timings) {
    if (!timings || typeof timings !== "object") {
        return false;
    }
    var i;
    var value;
    for (i = 0; i < TIMING_KEYS.length; i++) {
        value = timings[TIMING_KEYS[i]];
        if (!isFiniteNumber(value) || value < 0 || value >= 24) {
            return false;
        }
    }
    return true;
}

function normalizeTimingValue(value) {
    if (isFiniteNumber(value)) {
        return value;
    }
    return parseHHMM(value);
}

/* =====================================================================
 * Test hooks
 * ===================================================================== */

/*
 * Store AlAdhan-style timings directly in the daily cache. Values may be
 * numbers (hours) or strings such as "04:52 (EEST)". An optional
 * timingsObj.tzHours is remembered as the location timezone hint.
 */
function injectCacheForTest(date, latitudeDeg, longitudeDeg, methodId,
        asrSchool, timingsObj) {
    var d = normalizeDate(date);
    var lat = normalizeLatitude(latitudeDeg);
    var lon = normalizeLongitude(longitudeDeg);
    var id = normalizeMethodId(methodId);
    var school = normalizeAsrSchool(asrSchool);

    var timings = {};
    var i;
    var key;
    for (i = 0; i < TIMING_KEYS.length; i++) {
        key = TIMING_KEYS[i];
        if (timingsObj && timingsObj[key] !== undefined) {
            timings[key] = normalizeTimingValue(timingsObj[key]);
        } else if (timingsObj && timingsObj[ALADHAN_KEYS[i]] !== undefined) {
            timings[key] = normalizeTimingValue(timingsObj[ALADHAN_KEYS[i]]);
        } else {
            timings[key] = NaN;
        }
    }

    var k = cacheKey(d, lat, lon, id, school);
    _apiCache[k] = { timings: timings };

    if (timingsObj && isFiniteNumber(timingsObj.tzHours)) {
        _tzCache[tzCacheKey(lat, lon)] = timingsObj.tzHours;
    }

    return k;
}

function clearCacheForTest() {
    _apiCache = {};
    _tzCache = {};
}

/* =====================================================================
 * Public entry points
 * ===================================================================== */

function getPrayerState(date, latitudeDeg, longitudeDeg, methodId, asrSchool,
        includeSunriseInNext, utcOffsetMinutesOverride) {
    var d = normalizeDate(date);
    var rawLat = normalizeLatitude(latitudeDeg);
    var lon = normalizeLongitude(longitudeDeg);
    var id = normalizeMethodId(methodId);
    var school = normalizeAsrSchool(asrSchool);
    var method = METHODS[id];
    var includeSunrise = includeSunriseInNext === true;

    var tzHours = resolveTzHours(d, rawLat, lon,
        utcOffsetMinutesOverride);

    var latRad = clamp(rawLat, -LATITUDE_LIMIT, LATITUDE_LIMIT) * RAD;
    var shadowFactor = school === 1 ? 2.0 : 1.0;

    var solar = computeSolarGeometry(d, lon, tzHours);
    var times = computeOfflineTimings(solar, method, latRad, shadowFactor);

    var source = "offline";
    var key = cacheKey(d, rawLat, lon, id, school);
    var cached = _apiCache[key];
    if (cached && isValidTimings(cached.timings)) {
        times = {
            fajr: cached.timings.fajr,
            sunrise: cached.timings.sunrise,
            dhuhr: cached.timings.dhuhr,
            asr: cached.timings.asr,
            maghrib: cached.timings.maghrib,
            isha: cached.timings.isha
        };
        source = "api";
    }

    var utcHours = d.getUTCHours() + d.getUTCMinutes() / 60.0
        + d.getUTCSeconds() / 3600.0;
    var localTimeHours = wrap24(utcHours + tzHours);

    var hours = [
        times.fajr,
        times.sunrise,
        times.dhuhr,
        times.asr,
        times.maghrib,
        times.isha
    ];

    /* Current prayer: the last one that has already started. Before dawn the
       previous night's Isha is still the current prayer. */
    var currentIndex;
    if (localTimeHours < hours[0]) {
        currentIndex = 5;
    } else {
        currentIndex = 0;
        var i;
        for (i = 1; i < hours.length; i++) {
            if (hours[i] <= localTimeHours) {
                currentIndex = i;
            }
        }
    }

    /* Next obligatory prayer, optionally counting Sunrise. */
    var order = includeSunrise ? ALL_INDICES : OBLIGATORY_INDICES;
    var nextIndex = -1;
    var j;
    for (j = 0; j < order.length; j++) {
        if (hours[order[j]] > localTimeHours) {
            nextIndex = order[j];
            break;
        }
    }

    var nextPrayerHours;
    var minutesToNextPrayer;
    if (nextIndex === -1) {
        /* After Isha: the next prayer is tomorrow's Fajr. */
        nextIndex = 0;
        nextPrayerHours = times.fajr;
        minutesToNextPrayer = Math.round(
            ((24.0 - localTimeHours) + times.fajr) * 60.0
        );
    } else {
        nextPrayerHours = hours[nextIndex];
        minutesToNextPrayer = Math.round(
            (nextPrayerHours - localTimeHours) * 60.0
        );
    }
    if (minutesToNextPrayer < 0) {
        minutesToNextPrayer = 0;
    }

    return {
        fajrHours: times.fajr,
        sunriseHours: times.sunrise,
        dhuhrHours: times.dhuhr,
        asrHours: times.asr,
        maghribHours: times.maghrib,
        ishaHours: times.isha,
        localTimeHours: localTimeHours,
        isPm: localTimeHours >= 12.0,
        currentPrayerName: PRAYER_NAMES[currentIndex],
        currentPrayerIndex: currentIndex,
        nextPrayerName: PRAYER_NAMES[nextIndex],
        nextPrayerIndex: nextIndex,
        nextPrayerHours: nextPrayerHours,
        minutesToNextPrayer: minutesToNextPrayer,
        methodName: method.name,
        source: source,
        formatted: {
            fajr: formatHHMM(times.fajr),
            sunrise: formatHHMM(times.sunrise),
            dhuhr: formatHHMM(times.dhuhr),
            asr: formatHHMM(times.asr),
            maghrib: formatHHMM(times.maghrib),
            isha: formatHHMM(times.isha),
            localTime: formatHHMM(localTimeHours)
        },
        /* Extra diagnostics; harmless for QML bindings. */
        observerLatDeg: rawLat,
        observerLonDeg: lon,
        methodId: id,
        asrSchool: school,
        includeSunriseInNext: includeSunrise,
        tzHours: tzHours,
        cacheKey: key
    };
}

/*
 * Fetch daily timings from AlAdhan. The callback always receives a complete
 * state object: immediately from cache when possible, otherwise after the
 * request, with the offline model as the fallback on any error or timeout.
 */
function fetchPrayerTimesAsync(date, latitudeDeg, longitudeDeg, methodId,
        asrSchool, callback) {
    var d = normalizeDate(date);
    var lat = normalizeLatitude(latitudeDeg);
    var lon = normalizeLongitude(longitudeDeg);
    var id = normalizeMethodId(methodId);
    var school = normalizeAsrSchool(asrSchool);
    var key = cacheKey(d, lat, lon, id, school);

    var cached = _apiCache[key];
    if (cached && isValidTimings(cached.timings)) {
        if (typeof callback === "function") {
            callback(getPrayerState(d, lat, lon, id, school));
        }
        return;
    }

    if (typeof XMLHttpRequest === "undefined") {
        if (typeof callback === "function") {
            callback(getPrayerState(d, lat, lon, id, school));
        }
        return;
    }

    var finished = false;

    function complete(parsed) {
        if (finished) {
            return;
        }
        finished = true;
        if (parsed && isValidTimings(parsed)) {
            _apiCache[key] = { timings: parsed };
        }
        if (typeof callback === "function") {
            callback(getPrayerState(d, lat, lon, id, school));
        }
    }

    var url = "https://api.aladhan.com/v1/timings/"
        + pad2(d.getUTCDate()) + "-" + pad2(d.getUTCMonth() + 1) + "-"
        + d.getUTCFullYear()
        + "?latitude=" + lat
        + "&longitude=" + lon
        + "&method=" + id
        + "&school=" + school;

    try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.timeout = 8000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                var parsed = null;
                try {
                    parsed = parseAlAdhanResponse(JSON.parse(xhr.responseText));
                } catch (err) {
                    parsed = null;
                }
                complete(parsed);
            } else {
                complete(null);
            }
        };

        xhr.onerror = function () {
            complete(null);
        };
        xhr.ontimeout = function () {
            complete(null);
        };

        xhr.send();
    } catch (err) {
        complete(null);
    }
}

.pragma library

/*
 * astronomy.js -- dependency-free Moon phase / libration ephemeris.
 *
 * Reference: Jean Meeus, "Astronomical Algorithms", 2nd ed.
 *   Chapter 47  (Moon position: truncated ELP-2000/82 series, tables 47.A/47.B)
 *   Chapter 48  (illuminated fraction)
 *   Chapter 53  (optical libration)
 *   Chapter 25  (low-precision solar coordinates)
 *
 * Deliberately written in conservative ES5 (var/function only) because
 * .pragma library files are evaluated by the QML JavaScript engine.
 *
 * Public API (also used by tests/test_astronomy.mjs):
 *   getMoonState(date, latitude, longitude) -> object
 *   getEarthAndOrbitState(date, latitude, longitude) -> object
 * See the shared project contract for the returned fields.
 */

var RAD = Math.PI / 180;
var DEG = 180 / Math.PI;
var SYNODIC_MONTH = 29.530588853;

/* Meeus table 47.A: D, M, M', F, sum_l (1e-6 deg), sum_r (1e-3 km). */
var MOON_LR_TERMS = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751],
    [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950],
    [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0],
    [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0],
    [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616],
    [4, -1, -2, 0, 759, -1897],
    [0, 2, -1, 0, -713, -2117],
    [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0],
    [2, -1, 0, -2, 596, 0],
    [4, 0, 1, 0, 549, -1423],
    [0, 0, 4, 0, 537, -1117],
    [4, -1, 0, 0, 520, -1571],
    [1, 0, -2, 0, -487, -1739],
    [2, 1, 0, -2, -399, 0],
    [0, 0, 2, -2, -381, -4421],
    [1, 1, 1, 0, 351, 0],
    [3, 0, -2, 0, -340, 0],
    [4, 0, -3, 0, 330, 0],
    [2, -1, 2, 0, 327, 0],
    [0, 2, 1, 0, -323, 1165],
    [1, 1, -1, 0, 299, 0],
    [2, 0, 3, 0, 294, 0],
    [2, 0, -1, -2, 0, 8752]
];

/* Meeus table 47.B: D, M, M', F, sum_b (1e-6 deg). */
var MOON_B_TERMS = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
    [4, 0, 0, -1, 1021],
    [4, 0, -1, 1, 833],
    [0, 0, 1, -3, 777],
    [4, 0, -2, 1, 671],
    [2, 0, 0, -3, 607],
    [2, 0, 2, -1, 596],
    [2, -1, 1, -1, 491],
    [2, 0, -2, 1, -451],
    [0, 0, 3, -1, 439],
    [2, 0, 2, 1, 422],
    [2, 0, -3, -1, 421],
    [2, 1, -1, 1, -366],
    [2, 1, 0, 1, -351],
    [4, 0, 0, 1, 331],
    [2, -1, 1, 1, 315],
    [2, -2, 0, -1, 302],
    [0, 0, 1, 3, -283],
    [2, 1, 1, -1, -229],
    [1, 1, 0, -1, 223],
    [1, 1, 0, 1, 223],
    [0, 1, -2, -1, -220],
    [2, 1, -1, -1, -220],
    [1, 0, 1, 1, -185],
    [2, -1, -2, -1, 181],
    [0, 1, 2, 1, -177],
    [4, 0, -2, -1, 176],
    [4, -1, -1, -1, 166],
    [1, 0, 1, -1, -164],
    [4, 0, 1, -1, 132],
    [1, 0, -1, -1, -119],
    [4, -1, 0, -1, 115],
    [2, -2, 0, 1, 107]
];

function norm360(x) {
    var r = x % 360;
    if (r < 0) {
        r += 360;
    }
    return r;
}

function norm2pi(x) {
    var r = x % (2 * Math.PI);
    if (r < 0) {
        r += 2 * Math.PI;
    }
    return r;
}

function sind(x) {
    return Math.sin(x * RAD);
}

function cosd(x) {
    return Math.cos(x * RAD);
}

/* Julian Day (UTC based; JS Date epoch is 1970-01-01T00:00:00Z). */
function julianDay(date) {
    var ms = date && date.getTime ? date.getTime() : NaN;
    if (!isFinite(ms)) {
        /* Invalid date: fall back to J2000.0 so callers never see a throw. */
        ms = 946728000000;
    }
    return ms / 86400000 + 2440587.5;
}

function moonPosition(T) {
    var T2 = T * T;
    var T3 = T2 * T;
    var T4 = T3 * T;

    /* Mean elements (Meeus 47.1 - 47.5). */
    var Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2
        + T3 / 538841 - T4 / 65194000;
    var D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2
        + T3 / 545868 - T4 / 113065000;
    var M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2
        + T3 / 24490000;
    var Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2
        + T3 / 69699 - T4 / 14712000;
    var F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2
        - T3 / 3526000 + T4 / 863310000;

    Lp = norm360(Lp);
    D = norm360(D);
    M = norm360(M);
    Mp = norm360(Mp);
    F = norm360(F);

    /* Eccentricity of Earth's orbit (Meeus 47, correction factor). */
    var E = 1 - 0.002516 * T - 0.0000074 * T2;

    var sumL = 0;
    var sumR = 0;
    var i;
    var term;
    var arg;
    var factor;

    for (i = 0; i < MOON_LR_TERMS.length; i++) {
        term = MOON_LR_TERMS[i];
        factor = 1;
        if (term[1] === 1 || term[1] === -1) {
            factor = E;
        } else if (term[1] === 2 || term[1] === -2) {
            factor = E * E;
        }
        arg = term[0] * D + term[1] * M + term[2] * Mp + term[3] * F;
        sumL += term[4] * factor * sind(arg);
        sumR += term[5] * factor * cosd(arg);
    }

    var sumB = 0;
    for (i = 0; i < MOON_B_TERMS.length; i++) {
        term = MOON_B_TERMS[i];
        factor = 1;
        if (term[1] === 1 || term[1] === -1) {
            factor = E;
        } else if (term[1] === 2 || term[1] === -2) {
            factor = E * E;
        }
        arg = term[0] * D + term[1] * M + term[2] * Mp + term[3] * F;
        sumB += term[4] * factor * sind(arg);
    }

    /* Additive terms (Meeus 47). A1/A2/A3 are Venus/Jupiter perturbations
       and the flattening term. */
    var A1 = 119.75 + 131.849 * T;
    var A2 = 53.09 + 479264.290 * T;
    var A3 = 313.45 + 481266.484 * T;

    sumL += 3958 * sind(A1)
        + 1962 * sind(Lp - F)
        + 318 * sind(A2);

    sumB += -2235 * sind(Lp)
        + 382 * sind(A3)
        + 175 * sind(A1 - F)
        + 175 * sind(A1 + F)
        + 127 * sind(Lp - Mp)
        - 115 * sind(Lp + Mp);

    return {
        lambda: norm360(Lp + sumL / 1000000),
        beta: sumB / 1000000,
        distance: 385000.56 + sumR / 1000, /* km */
        Lp: Lp,
        D: D,
        M: M,
        Mp: Mp,
        F: F
    };
}

/* Apparent geocentric solar longitude and distance (Meeus ch. 25). */
function sunPosition(T) {
    var T2 = T * T;

    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T2;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T2;
    var e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T2;

    var C = (1.914602 - 0.004817 * T - 0.000014 * T2) * sind(M)
        + (0.019993 - 0.000101 * T) * sind(2 * M)
        + 0.000289 * sind(3 * M);

    var trueLong = L0 + C;
    var omega = 125.04 - 1934.136 * T;
    var lambda = trueLong - 0.00569 - 0.00478 * sind(omega); /* apparent */
    var nu = M + C;
    var r = 1.000001018 * (1 - e * e) / (1 + e * cosd(nu)); /* AU */

    return {
        lambda: norm360(lambda),
        distance: r
    };
}

/* Longitude of the ascending node of the Moon's mean orbit (Meeus 47). */
function moonNode(T) {
    var T2 = T * T;
    var T3 = T2 * T;
    var T4 = T3 * T;
    return norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T2
        + T3 / 467441 - T4 / 60616000);
}

function phaseNameForPhase(phase) {
    var p = phase;
    if (p < 0 || p >= 1) {
        p = norm2pi(p * 2 * Math.PI) / (2 * Math.PI);
    }
    if (p < 1 / 16 || p >= 15 / 16) {
        return "New Moon";
    }
    if (p < 3 / 16) {
        return "Waxing Crescent";
    }
    if (p < 5 / 16) {
        return "First Quarter";
    }
    if (p < 7 / 16) {
        return "Waxing Gibbous";
    }
    if (p < 9 / 16) {
        return "Full Moon";
    }
    if (p < 11 / 16) {
        return "Waning Gibbous";
    }
    if (p < 13 / 16) {
        return "Last Quarter";
    }
    return "Waning Crescent";
}

/*
 * Main entry point.
 *
 * date      : JS Date (interpreted in UTC via getTime()).
 * latitude  : accepted for API compatibility (degrees, default 0).
 * longitude : accepted for API compatibility (degrees, default 0).
 *
 * The returned libration is *optical* (geocentric) libration, as specified.
 */
function getMoonState(date, latitude, longitude) {
    /* Keep the signature honest for callers that omit or pass junk. */
    if (typeof latitude !== "number" || !isFinite(latitude)) {
        latitude = 0;
    }
    if (typeof longitude !== "number" || !isFinite(longitude)) {
        longitude = 0;
    }

    var jd = julianDay(date);
    var T = (jd - 2451545.0) / 36525;

    var moon = moonPosition(T);
    var sun = sunPosition(T);

    /* Signed geocentric elongation in ecliptic longitude, [0, 360).
       This is the phase angle used by the project contract: 0 = new,
       90 deg = first quarter, 180 deg = full, 270 deg = last quarter. */
    var elongationDeg = norm360(moon.lambda - sun.lambda);
    var phaseAngleRad = elongationDeg * RAD;
    var phase = elongationDeg / 360;

    if (phase >= 1) {
        phase -= 1;
    }
    if (phase < 0) {
        phase += 1;
    }

    /* Contract: illumination is derived from the phase angle, not from
       the Sun-Moon-Earth angle. At full this is exactly 1. */
    var illumination = 0.5 * (1 - Math.cos(phaseAngleRad));
    var ageDays = phase * SYNODIC_MONTH;

    /* --- Optical libration (Meeus ch. 53) --- */
    var Omega = moonNode(T);
    var I = 1.54242 * RAD; /* inclination of lunar equator to ecliptic */
    var beta = moon.beta * RAD;
    var W = (moon.lambda - Omega) * RAD;

    var A = Math.atan2(
        Math.sin(W) * Math.cos(beta) * Math.cos(I) - Math.sin(beta) * Math.sin(I),
        Math.cos(W) * Math.cos(beta)
    );

    var F = (moon.Lp - Omega) * RAD;
    var librationLonRad = A - F;
    while (librationLonRad > Math.PI) {
        librationLonRad -= 2 * Math.PI;
    }
    while (librationLonRad < -Math.PI) {
        librationLonRad += 2 * Math.PI;
    }

    var sinLat = -Math.sin(W) * Math.cos(beta) * Math.sin(I)
        - Math.sin(beta) * Math.cos(I);
    if (sinLat > 1) {
        sinLat = 1;
    } else if (sinLat < -1) {
        sinLat = -1;
    }
    var librationLatRad = Math.asin(sinLat);

    /* --- Sun direction in Moon-view space --- */
    /* Z+ points at the observer, X+ to the right (northern-hemisphere
       view), so first quarter lights the right limb. The small Y term is
       the solar declination relative to the Moon's equator (~1.54 deg). */
    var sunTilt = 0.0269 * Math.sin((sun.lambda - Omega) * RAD);
    var sx = Math.sin(phaseAngleRad);
    var sy = sunTilt;
    var sz = -Math.cos(phaseAngleRad);
    var slen = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (slen === 0) {
        slen = 1;
    }

    return {
        phase: phase,
        phaseAngleRad: norm2pi(phaseAngleRad),
        illumination: illumination,
        ageDays: ageDays,
        phaseName: phaseNameForPhase(phase),
        sunDirection: {
            x: sx / slen,
            y: sy / slen,
            z: sz / slen
        },
        librationLonRad: librationLonRad,
        librationLatRad: librationLatRad
    };
}

/* =====================================================================
 * Earth orbit / Sun geometry
 *
 * Reference: Meeus ch. 25 (solar coordinates), ch. 12 (sidereal time) and
 * ch. 28 (equation of time). The same ch. 25 series used by getMoonState
 * is reused here so both entry points agree to the arcsecond.
 *
 * Coordinate convention for sunVectorWorld / subsolarLonRad:
 *   +X = 90 deg east, +Y = north pole, +Z = 0 deg longitude (Greenwich).
 * ===================================================================== */

var J2000_MS = 946728000000; /* 2000-01-01T12:00:00Z */
var OBLIQUITY_DEG = 23.4392911;

/* Wrap radians into [-PI, PI). */
function wrapPi(x) {
    var r = x % (2 * Math.PI);
    if (r >= Math.PI) {
        r -= 2 * Math.PI;
    } else if (r < -Math.PI) {
        r += 2 * Math.PI;
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

function julianCenturies(jd) {
    return (jd - 2451545.0) / 36525;
}

/* Greenwich mean sidereal time in degrees (Meeus 12.4, UT1 ~= UTC). */
function greenwichMeanSiderealDeg(jd) {
    var d = jd - 2451545.0;
    var T = d / 36525;
    var T2 = T * T;
    var T3 = T2 * T;
    return norm360(280.46061837 + 360.98564736629 * d
        + 0.000387933 * T2 - T3 / 38710000);
}

/*
 * Apparent geocentric equatorial coordinates of the Sun, derived from the
 * ch. 25 apparent ecliptic longitude already computed by sunPosition().
 */
function sunEquatorial(jd) {
    var T = julianCenturies(jd);
    var sun = sunPosition(T);
    var lambdaRad = sun.lambda * RAD;
    var epsRad = OBLIQUITY_DEG * RAD;
    var ra = Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad),
        Math.cos(lambdaRad));
    var dec = Math.asin(Math.sin(epsRad) * Math.sin(lambdaRad));

    return {
        lambdaRad: lambdaRad,
        raRad: norm2pi(ra),
        decRad: dec,
        distance: sun.distance
    };
}

/* UTC midnight at the start of `year`, without Date.UTC's 0..99 quirk. */
function utcYearStartMs(year) {
    var d = new Date(0);
    d.setUTCFullYear(year, 0, 1);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
}

function utcMillisOfDay(ms) {
    var dayMs = ms % 86400000;
    if (dayMs < 0) {
        dayMs += 86400000;
    }
    return dayMs;
}

function seasonNameNorth(lambdaRad) {
    if (lambdaRad < Math.PI / 2) {
        return "Spring";
    }
    if (lambdaRad < Math.PI) {
        return "Summer";
    }
    if (lambdaRad < 3 * Math.PI / 2) {
        return "Autumn";
    }
    return "Winter";
}

function oppositeSeason(name) {
    if (name === "Spring") {
        return "Autumn";
    }
    if (name === "Summer") {
        return "Winter";
    }
    if (name === "Autumn") {
        return "Spring";
    }
    return "Summer";
}

/*
 * Public entry point.
 *
 * date      : JS Date, interpreted in UTC via getTime().
 * latitude  : degrees, north positive (default 0, clamped to +/-90).
 * longitude : degrees, east positive (default 0, wrapped to +/-180).
 *
 * earthHelioLonRad follows the project's season convention: 0 at the March
 * equinox, PI/2 at the June solstice, PI at the September equinox and
 * 3*PI/2 at the December solstice. That is the apparent solar longitude
 * lambda_sun; the true Earth-centred heliocentric longitude would be
 * lambda_sun + PI (see the note in tests/test_earth_orbit.mjs).
 */
function getEarthAndOrbitState(date, latitude, longitude) {
    if (typeof latitude !== "number" || !isFinite(latitude)) {
        latitude = 0;
    }
    if (typeof longitude !== "number" || !isFinite(longitude)) {
        longitude = 0;
    }
    if (latitude > 90) {
        latitude = 90;
    } else if (latitude < -90) {
        latitude = -90;
    }
    longitude = wrap180(longitude);

    var ms = date && date.getTime ? date.getTime() : NaN;
    if (!isFinite(ms) || !isFinite(new Date(ms).getTime())) {
        /* Invalid date falls back to J2000.0 rather than throwing. */
        ms = J2000_MS;
    }

    var jd = ms / 86400000 + 2440587.5;
    var sun = sunEquatorial(jd);

    var earthHelioLonRad = norm2pi(sun.lambdaRad);

    /* --- UTC calendar bookkeeping --- */
    var year = new Date(ms).getUTCFullYear();
    var yearStartMs = utcYearStartMs(year);
    var nextYearStartMs = utcYearStartMs(year + 1);
    var yearLengthMs = nextYearStartMs - yearStartMs;
    var daysInYear = Math.round(yearLengthMs / 86400000);

    var yearProgress = (ms - yearStartMs) / yearLengthMs;
    if (!isFinite(yearProgress)) {
        yearProgress = 0;
    } else if (yearProgress < 0) {
        yearProgress = 0;
    } else if (yearProgress > 1) {
        yearProgress = 1;
    }

    var dayOfYear = Math.floor((ms - yearStartMs) / 86400000) + 1;
    if (dayOfYear < 1) {
        dayOfYear = 1;
    } else if (dayOfYear > daysInYear) {
        dayOfYear = daysInYear;
    }

    var jan1Jd = yearStartMs / 86400000 + 2440587.5;
    var jan1Sun = sunEquatorial(jan1Jd);
    var jan1HelioLonRad = norm2pi(jan1Sun.lambdaRad);

    /* --- Seasons (lambda_sun quadrants) --- */
    var seasonNameN = seasonNameNorth(sun.lambdaRad);
    var seasonNameS = oppositeSeason(seasonNameN);

    /* --- Subsolar point ---
       Hour angle H = GMST - alpha (at Greenwich). The subsolar meridian is
       where H = 0, so its east-positive longitude is -H. */
    var gmstDeg = greenwichMeanSiderealDeg(jd);
    var hourAngleDeg = wrap180(gmstDeg - sun.raRad * DEG);
    var subsolarLonRad = wrapPi(-hourAngleDeg * RAD);

    /* Apparent solar time at Greenwich, then the equation of time as
       apparent minus mean (hours); bounded to [-12, 12). */
    var utcHours = utcMillisOfDay(ms) / 3600000;
    var apparentGreenwichHours =
        (((hourAngleDeg / 15 + 12) % 24) + 24) % 24;
    var eotHours = apparentGreenwichHours - utcHours;
    if (eotHours >= 12) {
        eotHours -= 24;
    } else if (eotHours < -12) {
        eotHours += 24;
    }

    var localSolarTimeHours =
        (((utcHours + longitude / 15 + eotHours) % 24) + 24) % 24;

    /* --- Sun direction in world space --- */
    var cosDecl = Math.cos(sun.decRad);
    var sx = cosDecl * Math.sin(subsolarLonRad);
    var sy = Math.sin(sun.decRad);
    var sz = cosDecl * Math.cos(subsolarLonRad);
    var vectorLength = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!(vectorLength > 0)) {
        vectorLength = 1;
    }

    return {
        earthHelioLonRad: earthHelioLonRad,
        jan1HelioLonRad: jan1HelioLonRad,
        yearProgress: yearProgress,
        dayOfYear: dayOfYear,
        daysInYear: daysInYear,
        seasonNameNorth: seasonNameN,
        seasonNameSouth: seasonNameS,
        earthDistanceAU: sun.distance,
        observerLatRad: latitude * RAD,
        observerLonRad: longitude * RAD,
        subsolarLatRad: sun.decRad,
        subsolarLonRad: subsolarLonRad,
        sunVectorWorld: {
            x: sx / vectorLength,
            y: sy / vectorLength,
            z: sz / vectorLength
        },
        localSolarTimeHours: localSolarTimeHours
    };
}

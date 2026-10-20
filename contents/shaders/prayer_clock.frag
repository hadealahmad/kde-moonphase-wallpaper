#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float localTimeHours;   // [0, 24)
    float fajrHours;        // [0, 24)
    float sunriseHours;     // [0, 24)
    float dhuhrHours;       // [0, 24)
    float asrHours;         // [0, 24)
    float maghribHours;     // [0, 24)
    float ishaHours;        // [0, 24)
    float nextPrayerHours;  // [0, 24)
    float nextPrayerIndex;  // 0=Fajr, 1=Sunrise, 2=Dhuhr, 3=Asr, 4=Maghrib, 5=Isha
    float showSunrise;      // 1.0 or 0.0
} ubuf;

const float PI = 3.14159265358979323846;
const float TWO_PI = 6.28318530717958647692;

const float R_INNER = 0.245;
const float R_MID   = 0.305;
const float R_OUTER = 0.365;

// -----------------------------------------------------------------------------
// Clock angle helpers: 12:00 / 00:00 at the top (+Y), hours advance clockwise.
// -----------------------------------------------------------------------------
float wrapTwoPi(float a) {
    return a - TWO_PI * floor(a / TWO_PI);
}

float hourToTheta(float h) {
    return wrapTwoPi(0.5 * PI - (mod(h, 12.0) / 12.0) * TWO_PI);
}

float thetaToH12(float th) {
    return (wrapTwoPi(0.5 * PI - th) / TWO_PI) * 12.0;
}

// Gaussian hairline / bead falloff used throughout the astrolabe instruments.
float gauss(float d, float w) {
    return exp(-pow(d / w, 2.0));
}

float angDist(float a, float b) {
    float d = a - b;
    return abs(atan(sin(d), cos(d)));
}

// Crisp astrolabe prayer node: sharp ring + center pinpoint (+ optional target).
vec4 prayerNode(vec2 p, float pHour, vec3 tint, bool highlight) {
    float th = hourToTheta(pHour);
    float rr = (pHour < 12.0) ? R_INNER : R_OUTER;
    vec2 c = rr * vec2(cos(th), sin(th));
    float dl = length(p - c);

    float ring = gauss(dl - 0.019, 0.0028) * 0.86;
    float pin  = (1.0 - smoothstep(0.0022, 0.0044, dl)) * 0.95;
    float halo = gauss(dl, 0.024) * 0.10;

    vec3 col = tint * (ring + pin + halo);
    float a = max(ring, pin) + halo * 0.5;

    if (highlight) {
        float target = gauss(dl - 0.031, 0.0021) * 0.92;
        float glow   = gauss(dl - 0.033, 0.0075) * 0.16;
        vec3 hc = mix(tint, vec3(1.0), 0.55);
        col += hc * (target + glow);
        a = max(a, max(target, glow));
    }

    return vec4(col, clamp(a, 0.0, 1.0));
}

// Dark disc cutout that seats a prayer node into the ring.
float prayerDisc(vec2 p, float pHour) {
    float th = hourToTheta(pHour);
    float rr = (pHour < 12.0) ? R_INNER : R_OUTER;
    vec2 c = rr * vec2(cos(th), sin(th));
    return 1.0 - smoothstep(0.0145, 0.0185, length(p - c));
}

void main() {
    vec2 uv = qt_TexCoord0 - 0.5;
    vec2 p = vec2(uv.x, -uv.y);
    float r = length(p);
    float theta = wrapTwoPi(atan(p.y, p.x));

    // Palette
    vec3 colDayActive   = vec3(0.98, 0.85, 0.45);
    vec3 colNightActive = vec3(0.96, 0.98, 1.00);
    vec3 colInactiveGray = vec3(0.46, 0.50, 0.58);
    vec3 colPlate       = vec3(0.025, 0.032, 0.050);

    bool isPm = (ubuf.localTimeHours >= 12.0);
    bool isDaytime = (ubuf.localTimeHours >= ubuf.sunriseHours)
                  && (ubuf.localTimeHours < ubuf.maghribHours);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // 1. Subtle radial instrument plate, bezel and reference rings
    float plate = 1.0 - smoothstep(0.41, 0.43, r);
    col += vec3(0.04, 0.05, 0.08) * plate * 0.28;
    alpha = max(alpha, plate * 0.16);

    float refMid   = gauss(r - R_MID, 0.0022) * 0.10;
    float refBezel = gauss(r - 0.415, 0.0024) * 0.24;
    vec3 colSlate = vec3(0.54, 0.60, 0.70);
    col += colSlate * (refMid + refBezel);
    alpha = max(alpha, refMid + refBezel);

    // 2. Cardinal crosshairs (12/00, 03/15, 06/18, 09/21), broken at the emblem
    float crossMask = smoothstep(0.062, 0.092, r) * (1.0 - smoothstep(0.385, 0.405, r));
    float chX = gauss(p.y, 0.0022) * crossMask * 0.22;
    float chY = gauss(p.x, 0.0022) * crossMask * 0.22;
    col += colSlate * max(chX, chY);
    alpha = max(alpha, max(chX, chY));

    // 3. Two concentric 12-hour rings: day/night split and active hierarchy
    float hInner = thetaToH12(theta);          // [0, 12)
    float hOuter = 12.0 + thetaToH12(theta);   // [12, 24)

    float innerDay = smoothstep(ubuf.sunriseHours - 0.15, ubuf.sunriseHours + 0.15, hInner);
    vec3 cInner = mix(colNightActive, colDayActive, innerDay);

    float outerNight = smoothstep(ubuf.maghribHours - 0.15, ubuf.maghribHours + 0.15, hOuter);
    vec3 cOuter = mix(colDayActive, colNightActive, outerNight);

    float wI = isPm ? 0.0024 : 0.0038;
    float wO = isPm ? 0.0038 : 0.0024;
    float aI = isPm ? 0.26 : 0.52;
    float aO = isPm ? 0.52 : 0.26;

    vec3 cIDraw = isPm ? mix(cInner, colInactiveGray, 0.68) : cInner;
    vec3 cODraw = isPm ? cOuter : mix(cOuter, colInactiveGray, 0.68);

    float shI = gauss(r - R_INNER, wI) * aI;
    float shO = gauss(r - R_OUTER, wO) * aO;

    col += cIDraw * shI + cODraw * shO;
    alpha = max(alpha, max(shI, shO));

    // 4. Swept elapsed-hours arc on the active ring (top -> current hour, clockwise)
    float elapsed = isPm ? (ubuf.localTimeHours - 12.0) : ubuf.localTimeHours;
    float span = (clamp(elapsed, 0.0, 12.0) / 12.0) * TWO_PI;

    if (span > 0.002) {
        float dFromTop = wrapTwoPi(0.5 * PI - theta);
        float head = 1.0 - smoothstep(span - 0.015, span + 0.020, dFromTop);
        float tail = smoothstep(0.0, 0.012, dFromTop);
        float grad = clamp(dFromTop / span, 0.0, 1.0);
        float rActive = isPm ? R_OUTER : R_INNER;
        float arc = gauss(r - rActive, 0.0050) * head * tail
                  * (0.55 + 0.45 * grad) * 0.92;
        vec3 arcCol = mix(isPm ? cOuter : cInner, vec3(1.0), 0.28);
        col = mix(col, arcCol, arc);
        alpha = max(alpha, arc);
    }

    // 5. Watchmaker hour ticks (48 = every 15 min; major hourly; cardinal every 3 h)
    float tickStep = TWO_PI / 48.0;
    float tickIdx = floor((theta + 0.5 * tickStep) / tickStep);
    float tickAng = tickIdx * tickStep;
    float dAng = angDist(theta, tickAng) * r;

    bool isCardinal = mod(tickIdx, 12.0) < 0.5;
    bool isMajor = mod(tickIdx, 4.0) < 0.5;
    float tickLen = isCardinal ? 0.015 : (isMajor ? 0.011 : 0.0060);
    float tickWeight = isCardinal ? 0.55 : (isMajor ? 0.36 : 0.20);
    float tickAngMask = gauss(dAng, 0.0016);

    float tI = tickAngMask * (1.0 - smoothstep(tickLen * 0.62, tickLen, abs(r - R_INNER)));
    float tO = tickAngMask * (1.0 - smoothstep(tickLen * 0.62, tickLen, abs(r - R_OUTER)));

    vec3 tickColI = isPm ? colInactiveGray : mix(cInner, vec3(1.0), 0.20);
    vec3 tickColO = isPm ? mix(cOuter, vec3(1.0), 0.20) : colInactiveGray;
    float tickAI = tI * tickWeight * (isPm ? 0.34 : 1.0);
    float tickAO = tO * tickWeight * (isPm ? 1.0 : 0.34);

    col += tickColI * tickAI + tickColO * tickAO;
    alpha = max(alpha, max(tickAI, tickAO));

    // 6. Prayer markers seated on their own 12-hour ring
    int nextIdx = int(floor(ubuf.nextPrayerIndex + 0.5));

    float discMask = max(prayerDisc(p, ubuf.fajrHours), prayerDisc(p, ubuf.dhuhrHours));
    discMask = max(discMask, prayerDisc(p, ubuf.asrHours));
    discMask = max(discMask, prayerDisc(p, ubuf.maghribHours));
    discMask = max(discMask, prayerDisc(p, ubuf.ishaHours));
    if (ubuf.showSunrise > 0.5) {
        discMask = max(discMask, prayerDisc(p, ubuf.sunriseHours));
    }

    col = mix(col, colPlate, discMask * 0.90);
    alpha = max(alpha, discMask * 0.90);

    vec3 colDawn  = colNightActive;
    vec3 colSolar = colDayActive;
    vec3 colSunset = vec3(1.00, 0.80, 0.52);

    vec4 node = prayerNode(p, ubuf.fajrHours, colDawn, nextIdx == 0);
    col += node.rgb;
    alpha = max(alpha, node.a);

    if (ubuf.showSunrise > 0.5) {
        node = prayerNode(p, ubuf.sunriseHours, colSolar, nextIdx == 1);
        col += node.rgb;
        alpha = max(alpha, node.a);
    }

    node = prayerNode(p, ubuf.dhuhrHours, colSolar, nextIdx == 2);
    col += node.rgb;
    alpha = max(alpha, node.a);

    node = prayerNode(p, ubuf.asrHours, colSolar, nextIdx == 3);
    col += node.rgb;
    alpha = max(alpha, node.a);

    node = prayerNode(p, ubuf.maghribHours, colSunset, nextIdx == 4);
    col += node.rgb;
    alpha = max(alpha, node.a);

    node = prayerNode(p, ubuf.ishaHours, colNightActive, nextIdx == 5);
    col += node.rgb;
    alpha = max(alpha, node.a);

    // 7. Minute vernier track runner in the mid-channel
    float minFrac = fract(ubuf.localTimeHours);
    float thetaMin = wrapTwoPi(0.5 * PI - minFrac * TWO_PI);
    float spanMin = minFrac * TWO_PI;
    float dFm = wrapTwoPi(0.5 * PI - theta);

    float vern = gauss(r - R_MID, 0.0022) * 0.14;
    col += mix(colInactiveGray, vec3(1.0), 0.30) * vern;
    alpha = max(alpha, vern);

    if (spanMin > 0.002) {
        float headM = 1.0 - smoothstep(spanMin - 0.010, spanMin + 0.015, dFm);
        float tailM = smoothstep(0.0, 0.012, dFm);
        float gradM = clamp(dFm / spanMin, 0.0, 1.0);
        float trail = gauss(r - R_MID, 0.0032) * headM * tailM
                    * (0.07 + 0.15 * gradM);
        col += mix(colInactiveGray, vec3(1.0), 0.40) * trail;
        alpha = max(alpha, trail);
    }

    vec2 mDir = vec2(cos(thetaMin), sin(thetaMin));
    vec2 mPos = R_MID * mDir;
    vec2 dm = p - mPos;
    float diamondD = abs(dm.x) + abs(dm.y);

    float mCore = 1.0 - smoothstep(0.0100, 0.0130, diamondD);
    float mGlow = gauss(diamondD, 0.020) * 0.16;
    col = mix(col, vec3(1.0), mCore);
    col += vec3(1.0) * mGlow;
    alpha = max(alpha, max(mCore, mGlow));

    // Radial pointer spike bridging the vernier track toward the active ring
    float rActive = isPm ? R_OUTER : R_INNER;
    float r0 = min(R_MID, rActive);
    float r1 = max(R_MID, rActive);
    float projM = dot(p, mDir);
    float perpM = length(p - projM * mDir);
    float inSeg = smoothstep(r0 + 0.003, r0 + 0.011, projM)
                * (1.0 - smoothstep(r1 - 0.011, r1 - 0.003, projM));
    float spike = gauss(perpM, 0.0016) * inSeg * 0.55;
    col += vec3(1.0) * spike;
    alpha = max(alpha, spike);

    // 8. Hour indicator riding directly on the active ring
    float thetaHour = hourToTheta(ubuf.localTimeHours);
    vec2 hDir = vec2(cos(thetaHour), sin(thetaHour));
    vec2 hPos = rActive * hDir;
    float projH = dot(p, hDir);
    float perpH = length(p - projH * hDir);

    float spokeFade = smoothstep(0.062, 0.078, projH)
                    * (1.0 - smoothstep(rActive - 0.024, rActive - 0.004, projH));
    float spoke = gauss(perpH, 0.0018) * spokeFade * 0.40;
    col += vec3(1.0) * spoke;
    alpha = max(alpha, spoke);

    float dh = length(p - hPos);
    float beadDisc = 1.0 - smoothstep(0.0170, 0.0220, dh);
    float beadRim  = gauss(dh - 0.0220, 0.0020) * 0.85;
    float beadHalo = gauss(dh, 0.040) * 0.13;
    float reticle  = gauss(dh - 0.0360, 0.0026) * 0.62;

    col = mix(col, vec3(1.0), beadDisc);
    col += vec3(1.0) * (beadRim + beadHalo + reticle);
    alpha = max(alpha, max(beadDisc, max(beadRim, max(beadHalo, reticle))));

    // 9. Center astrolabe emblem: gold by day, lunar silver-white by night
    vec3 colCore = isDaytime ? vec3(1.00, 0.88, 0.58) : vec3(0.90, 0.94, 1.00);

    float core = 1.0 - smoothstep(0.0175, 0.0225, r);
    float coreHalo = gauss(r, 0.034) * 0.18;
    float emblemRing = gauss(r - 0.048, 0.0026) * 0.50;

    float rayAng = mod(theta + PI / 8.0, PI / 4.0) - PI / 8.0;
    float rayPerp = abs(sin(rayAng)) * r;
    float rays = gauss(rayPerp, 0.0018)
               * smoothstep(0.0505, 0.0545, r)
               * (1.0 - smoothstep(0.0585, 0.0625, r)) * 0.40;

    col += colCore * (coreHalo + emblemRing + rays);
    col = mix(col, colCore, core);
    alpha = max(alpha, max(core, coreHalo + emblemRing + rays));

    alpha = clamp(alpha, 0.0, 1.0) * ubuf.qt_Opacity;
    fragColor = vec4(col * alpha, alpha);
}

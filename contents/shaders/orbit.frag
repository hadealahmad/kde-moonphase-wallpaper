#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float earthHelioLonRad;
    float jan1HelioLonRad;
    float yearProgress;
    float orbitTiltRad;
    float axialTiltRad;
    float showGhostEarths;
} ubuf;

const float PI = 3.14159265358979323846;
const float TWO_PI = 6.28318530717958647692;

float wrapTwoPi(float a) {
    return a - TWO_PI * floor(a / TWO_PI);
}

void main() {
    vec2 uv = qt_TexCoord0 - 0.5;
    vec2 p = vec2(uv.x, -uv.y);
    float r = length(p);
    float theta = wrapTwoPi(atan(p.y, p.x));

    float R_orbit = 0.36;
    float dOrbit = abs(r - R_orbit);

    // Palette aligned with Moon & telemetry
    vec3 colSilver = vec3(0.84, 0.87, 0.92);
    vec3 colWarm   = vec3(0.95, 0.89, 0.74);
    vec3 colSlate  = vec3(0.54, 0.60, 0.70);

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // 1. Subtle radial instrument plate & concentric reference rings
    float plate = 1.0 - smoothstep(0.41, 0.43, r);
    col += vec3(0.04, 0.05, 0.08) * plate * 0.28;
    alpha = max(alpha, plate * 0.16);

    float refInner = exp(-pow((r - 0.18) / 0.0022, 2.0)) * 0.18;
    float refOuter = exp(-pow((r - 0.41) / 0.0022, 2.0)) * 0.22;
    col += colSlate * (refInner + refOuter);
    alpha = max(alpha, refInner + refOuter);

    // 2. Cardinal solstice/equinox crosshairs (broken near center Sun)
    float crossMask = smoothstep(0.07, 0.10, r) * (1.0 - smoothstep(0.39, 0.41, r));
    float chX = exp(-pow(p.y / 0.0022, 2.0)) * crossMask * 0.16;
    float chY = exp(-pow(p.x / 0.0022, 2.0)) * crossMask * 0.16;
    col += colSlate * max(chX, chY);
    alpha = max(alpha, max(chX, chY));

    // 3. Flat circular orbit ring (top-down, zero perspective tilt)
    float baseRing = exp(-pow(dOrbit / 0.0032, 2.0)) * 0.32;
    col += colSilver * baseRing;
    alpha = max(alpha, baseRing);

    // 4. Precision watchmaker degree ticks along the orbit ring (every 10 deg)
    float nTicks = 36.0;
    float tickStep = TWO_PI / nTicks;
    float tickIdx = floor((theta + 0.5 * tickStep) / tickStep);
    float tickAng = tickIdx * tickStep;
    float dAng = abs(atan(sin(theta - tickAng), cos(theta - tickAng))) * r;
    bool isMajor = mod(tickIdx, 3.0) < 0.5;
    float tickLen = isMajor ? 0.016 : 0.008;
    float tickMask = (1.0 - smoothstep(tickLen * 0.8, tickLen, dOrbit))
                   * exp(-pow(dAng / 0.0024, 2.0));
    float tickWeight = isMajor ? 0.42 : 0.20;
    col += colSilver * tickMask * tickWeight;
    alpha = max(alpha, tickMask * tickWeight);

    // 5. Swept year-progress arc from Jan 1 to current Earth longitude
    float progress = clamp(ubuf.yearProgress, 0.0, 1.0);
    float dFromJan1 = wrapTwoPi(theta - ubuf.jan1HelioLonRad);
    float spanAngle = progress * TWO_PI;
    float headFade = smoothstep(spanAngle + 0.02, spanAngle - 0.015, dFromJan1);
    float tailFade = smoothstep(0.0, 0.025, dFromJan1);
    float inArc = (progress > 0.002) ? (headFade * tailFade) : 0.0;
    float arcGrad = (spanAngle > 0.001) ? clamp(dFromJan1 / spanAngle, 0.0, 1.0) : 0.0;

    float progRing = exp(-pow(dOrbit / 0.0046, 2.0)) * inArc * (0.35 + 0.60 * arcGrad);
    col = mix(col, mix(colSilver, colWarm, 0.55 * arcGrad), clamp(progRing, 0.0, 1.0));
    alpha = max(alpha, progRing);

    // 6. Jan 1 radial tick mark
    vec2 jan1Pos = vec2(cos(ubuf.jan1HelioLonRad), sin(ubuf.jan1HelioLonRad));
    float projJan1 = dot(p, jan1Pos);
    float perpJan1 = length(p - projJan1 * jan1Pos);
    float jan1Tick = (1.0 - smoothstep(0.020, 0.024, abs(projJan1 - R_orbit)))
                   * exp(-pow(perpJan1 / 0.0032, 2.0)) * 0.78;
    col = mix(col, colWarm, jan1Tick);
    alpha = max(alpha, jan1Tick);

    // 7. Four cardinal solstice/equinox hollow astrolabe rings (when enabled)
    if (ubuf.showGhostEarths > 0.5) {
        for (int i = 0; i < 4; ++i) {
            float gAng = float(i) * 0.5 * PI;
            vec2 gCenter = R_orbit * vec2(cos(gAng), sin(gAng));
            float dg = length(p - gCenter);
            float gDisc = 1.0 - smoothstep(0.015, 0.019, dg);
            float gRing = exp(-pow((dg - 0.017) / 0.0028, 2.0)) * 0.55;
            float gDot  = (1.0 - smoothstep(0.004, 0.007, dg)) * 0.65;
            col = mix(col, vec3(0.03, 0.04, 0.07), gDisc * 0.85);
            col += colSilver * (gRing + gDot);
            alpha = max(alpha, max(gDisc * 0.85, gRing + gDot));
        }
    }

    // 8. Center Sun: geometric astrolabe emblem (crisp core + hairline ring + 8 rays)
    float sunCore = 1.0 - smoothstep(0.026, 0.031, r);
    float sunRing = exp(-pow((r - 0.046) / 0.0026, 2.0)) * 0.55;
    float rayAng = mod(theta + PI / 8.0, PI / 4.0) - PI / 8.0;
    float rayPerp = abs(sin(rayAng)) * r;
    float sunRays = exp(-pow(rayPerp / 0.0022, 2.0))
                  * smoothstep(0.052, 0.058, r)
                  * (1.0 - smoothstep(0.074, 0.082, r)) * 0.45;
    float sunHalo = exp(-pow(r / 0.068, 2.0)) * 0.22;

    col += colWarm * (sunHalo + sunRing + sunRays);
    col = mix(col, vec3(0.99, 0.96, 0.88), sunCore);
    alpha = max(alpha, max(sunCore, sunHalo + sunRing + sunRays));

    // 9. Active Earth: lunar-style half-lit sphere facing the center Sun + outer reticle
    vec2 eCenter = R_orbit * vec2(cos(ubuf.earthHelioLonRad), sin(ubuf.earthHelioLonRad));
    vec2 dpe = p - eCenter;
    float re = length(dpe);
    float rEarth = 0.030;

    float eReticle = exp(-pow((re - 0.046) / 0.0028, 2.0)) * 0.62;
    col += colWarm * eReticle;
    alpha = max(alpha, eReticle);

    if (re < rEarth * 1.15) {
        vec2 q = dpe / rEarth;
        float qr2 = dot(q, q);
        float qr = sqrt(qr2);
        float eEdge = 1.0 - smoothstep(0.94, 1.02, qr);
        if (eEdge > 0.0) {
            float qz = sqrt(max(0.0, 1.0 - min(qr2, 1.0)));
            vec3 N = normalize(vec3(q.x, q.y, qz));
            vec2 toSun = normalize(-eCenter);
            vec3 L = normalize(vec3(toSun.x, toSun.y, 0.22));
            float ndotl = dot(N, L);
            float term = smoothstep(-0.08, 0.10, ndotl);
            float diff = max(ndotl, 0.0);
            vec3 dayCol = colSilver * (0.28 + 0.72 * diff) * vec3(1.0, 0.98, 0.94);
            vec3 nightCol = vec3(0.06, 0.08, 0.12) * (0.5 + 0.5 * qz);
            vec3 eCol = mix(nightCol, dayCol, term);
            float eRim = smoothstep(0.84, 0.98, qr);
            eCol += colSilver * eRim * 0.22;
            col = mix(col, eCol, eEdge);
            alpha = max(alpha, eEdge);
        }
    }

    alpha = clamp(alpha, 0.0, 1.0) * ubuf.qt_Opacity;
    fragColor = vec4(col * alpha, alpha);
}

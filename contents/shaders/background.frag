#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 baseColor;
    float seasonIndex;
    float time;
    float aspectRatio;
    float intensity;
    float moonIllumination;
    float styleMode;
    float moonRadius;   // Moon disc radius in height-normalised units (0 = no halo)
    float milkyWayIntensity;  // 0..2, 1 = reference look
    float haloIntensity;      // 0..2, 1 = reference look
    float vignetteStrength;   // 0..2, 1 = reference look
    vec4 cornerPlate;   // x: |centre x|, y: top-row centre y, z: bottom-row centre y, w: radius
    vec4 cornerMask;    // x: top-right, y: bottom-left, z: bottom-right, w: top-left
} ubuf;

const float PI = 3.14159265358979323846;
const float TWO_PI = 6.28318530717958647692;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n + 17.3));
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        v += amp * valueNoise(p);
        p = p * 2.03 + vec2(17.1, 9.2);
        amp *= 0.5;
    }
    return v;
}

// Black-body-ish star tint: t in [0,1] runs from hot blue-white to cool amber.
vec3 starTint(float t) {
    vec3 hot  = vec3(0.70, 0.80, 1.00);
    vec3 sun  = vec3(1.00, 0.97, 0.90);
    vec3 cool = vec3(1.00, 0.78, 0.55);
    return t < 0.5 ? mix(hot, sun, t * 2.0) : mix(sun, cool, (t - 0.5) * 2.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

// Crisp screen-space anti-aliased stroke profile (1px sharp hairline).
float crispStroke(float dist, float halfWidth, float aa) {
    return 1.0 - smoothstep(halfWidth - aa * 0.5, halfWidth + aa * 0.5, dist);
}

// Remaps legacy constellation coordinates to compact, vertically centered
// left/right wings (around y = 0.0, x = +/-0.52) well clear of corner widgets.
vec2 mapConstellationPt(vec2 v) {
    const float scale = 0.54;
    if (v.x < 0.0) {
        return vec2(-0.52, 0.0) + (v - vec2(-0.55, 0.22)) * scale;
    }
    return vec2(0.52, 0.0) + (v - vec2(0.57, 0.21)) * scale;
}

// A constellation star: tight core plus a soft bloom, brightness varying by
// a per-star hash so each figure reads as real stars of mixed magnitude.
float constellationStar(vec2 p, vec2 c, float aa) {
    float mag = 0.55 + 0.45 * hash21(c * 31.7);
    float d = length(p - c);
    float core = 1.0 - smoothstep(0.0011 * mag + 0.0006 - aa * 0.5,
                                  0.0011 * mag + 0.0006 + aa * 0.5, d);
    float bloom = exp(-pow(d / (0.0055 * mag), 2.0)) * 0.30;
    float halo = exp(-d / 0.012) * 0.06;
    return (core * 0.95 + bloom + halo) * mag;
}

float drawEdge(vec2 p, vec2 aRaw, vec2 bRaw, float aa) {
    vec2 a = mapConstellationPt(aRaw);
    vec2 b = mapConstellationPt(bRaw);
    float d = sdSegment(p, a, b);
    float da = length(p - a);
    float db = length(p - b);
    // Hairline that stops short of each star, like a printed star atlas.
    float gap = smoothstep(0.0095, 0.0135, min(da, db));
    float line = crispStroke(d, 0.00042, aa) * 0.24 * gap;
    float stars = max(constellationStar(p, a, aa), constellationStar(p, b, aa));
    return max(line, stars);
}

vec3 starLayer(vec2 p, float scale, float density, float t) {
    vec2 gv = p * scale;
    vec2 id = floor(gv);
    vec2 f = fract(gv) - 0.5;
    vec2 rnd = hash22(id);
    if (rnd.x > density) {
        return vec3(0.0);
    }
    vec2 offset = (rnd - 0.5) * 0.72;
    float d = length(f - offset);
    float size = mix(0.016, 0.046, rnd.y * rnd.y);
    float twinkle = 0.85 + 0.15 * sin(t * 0.8 + rnd.x * 40.0);
    float core = exp(-pow(d / size, 2.0)) * twinkle;
    float spike = 0.0;
    if (rnd.y > 0.94) {
        vec2 q = abs(f - offset);
        spike = (exp(-q.x * 110.0) * exp(-q.y * 14.0) + exp(-q.y * 110.0) * exp(-q.x * 14.0)) * 0.22;
    }
    float temp = hash21(id + 91.7);
    // Most stars sit near white; only a few are visibly blue or amber.
    temp = 0.5 + (temp - 0.5) * (0.35 + 0.65 * rnd.y);
    return starTint(temp) * (core + spike) * (0.22 + 0.78 * rnd.y);
}

// Faint diagonal Milky Way: a dusty band of unresolved starlight with dark lanes.
vec3 milkyWay(vec2 p, float t) {
    vec2 dir = normalize(vec2(1.0, 0.42));
    vec2 nrm = vec2(-dir.y, dir.x);
    float along = dot(p, dir);
    float across = dot(p, nrm) + 0.05 * sin(along * 2.3);
    float band = exp(-pow(across / 0.24, 2.0));
    vec2 q = vec2(along * 3.0, across * 6.0) + vec2(t * 0.002, 0.0);
    float glow = fbm(q * 1.6);
    float dust = smoothstep(0.50, 0.78, fbm(q * 3.1 + 7.3));
    float density = band * glow * (1.0 - 0.75 * dust * exp(-pow(across / 0.07, 2.0)));
    vec3 tint = mix(vec3(0.42, 0.50, 0.70), vec3(0.70, 0.62, 0.56), glow);
    return tint * density * 0.11;
}

// Concept 1: Celestial Planisphere & Star Chart
vec3 evalPlanisphere(vec2 p, float r, float theta, int season, float t, float aa, float milky) {
    vec3 colSilver = vec3(0.84, 0.88, 0.96);
    vec3 colWarm   = vec3(0.95, 0.89, 0.74);
    vec3 colSlate  = vec3(0.52, 0.60, 0.74);

    float moonKeepout = smoothstep(0.22, 0.27, r);
    vec3 add = vec3(0.0);

    // Concentric celestial coordinate circles (crisp 1px anti-aliased strokes)
    float r1 = crispStroke(abs(r - 0.265), 0.00055, aa) * 0.54;
    float r2 = crispStroke(abs(r - 0.420), 0.00048, aa) * 0.26;
    float r3 = crispStroke(abs(r - 0.620), 0.00048, aa) * 0.20;
    float r4 = crispStroke(abs(r - 0.840), 0.00048, aa) * 0.14;
    add += colSlate * (r1 + r2 + r3 + r4);

    // Sharp degree ticks around the inner Moon framing ring (r = 0.265)
    float nTicks = 72.0;
    float stepA = TWO_PI / nTicks;
    float idx = floor((theta + 0.5 * stepA) / stepA);
    float ang = idx * stepA;
    float dAng = abs(atan(sin(theta - ang), cos(theta - ang))) * r;
    bool major = mod(idx, 6.0) < 0.5;
    float tLen = major ? 0.011 : 0.0050;
    float tickRadial = 1.0 - smoothstep(tLen - aa * 0.5, tLen + aa * 0.5, abs(r - 0.265));
    float tickHalfW = major ? 0.00055 : 0.00042;
    float tick = tickRadial * crispStroke(dAng, tickHalfW, aa) * (major ? 0.62 : 0.34);
    add += colSilver * tick;

    // Keepout around the bottom curved Moon telemetry arc (r in [0.28, 0.32], bottom sector)
    float bottomAngDist = abs(atan(sin(theta + 0.5 * PI), cos(theta + 0.5 * PI)));
    float textSectorKeepout = 1.0 - (1.0 - smoothstep(0.32, 0.42, bottomAngDist))
                                  * (1.0 - smoothstep(0.018, 0.026, abs(r - 0.298)));

    // 12 radial hour-angle lines broken inside r = 0.265
    float hStep = TWO_PI / 12.0;
    float hIdx = floor((theta + 0.5 * hStep) / hStep);
    float hAng = hIdx * hStep;
    float hPerp = abs(atan(sin(theta - hAng), cos(theta - hAng))) * r;
    float hLine = crispStroke(hPerp, 0.00048, aa)
                * smoothstep(0.278, 0.295, r)
                * (1.0 - smoothstep(0.82, 0.92, r))
                * textSectorKeepout * 0.14;
    add += colSlate * hLine;

    // Slow celestial sphere rotation when animated
    float rot = t * 0.004;
    mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    vec2 pStar = R * p;

    // Pinpoint starfield layers
    vec3 s1 = starLayer(pStar, 14.0, 0.30, t);
    vec3 s2 = starLayer(pStar + vec2(3.7, 1.9), 28.0, 0.25, t);
    vec3 s3 = starLayer(pStar + vec2(8.1, 5.4), 52.0, 0.22, t);
    vec3 s4 = starLayer(pStar + vec2(1.3, 7.7), 96.0, 0.20, t);
    add += (s1 * 0.62 + s2 * 0.42 + s3 * 0.26 + s4 * 0.16) * moonKeepout;
    if (milky > 0.001) {
        add += milkyWay(pStar, t) * moonKeepout * milky;
    }

    // Seasonal Constellations (compact & vertically centered on left/right wings)
    float cMask = 0.0;
    if (season == 0) {
        // SPRING: Leo (left) & Virgo (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.68, 0.12), vec2(-0.54, 0.16), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.54, 0.16), vec2(-0.46, 0.26), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.46, 0.26), vec2(-0.52, 0.35), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.52, 0.35), vec2(-0.60, 0.32), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.54, 0.16), vec2(-0.38, 0.10), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.38, 0.10), vec2(-0.46, 0.26), aa));

        cMask = max(cMask, drawEdge(p, vec2(0.42, 0.08), vec2(0.55, 0.18), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.18), vec2(0.66, 0.14), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.18), vec2(0.58, 0.31), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.66, 0.14), vec2(0.75, 0.24), aa));
    } else if (season == 1) {
        // SUMMER: Cygnus (left) & Lyra (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.66, 0.34), vec2(-0.55, 0.22), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.55, 0.22), vec2(-0.43, 0.09), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.67, 0.13), vec2(-0.55, 0.22), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.55, 0.22), vec2(-0.44, 0.31), aa));

        cMask = max(cMask, drawEdge(p, vec2(0.46, 0.32), vec2(0.54, 0.25), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.54, 0.25), vec2(0.64, 0.27), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.64, 0.27), vec2(0.60, 0.15), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.60, 0.15), vec2(0.50, 0.13), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.50, 0.13), vec2(0.54, 0.25), aa));
    } else if (season == 2) {
        // AUTUMN: Pegasus Great Square (left) & Cassiopeia W (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.68, 0.30), vec2(-0.48, 0.33), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.33), vec2(-0.45, 0.14), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.45, 0.14), vec2(-0.65, 0.11), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.65, 0.11), vec2(-0.68, 0.30), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.33), vec2(-0.37, 0.40), aa));

        cMask = max(cMask, drawEdge(p, vec2(0.42, 0.32), vec2(0.50, 0.21), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.50, 0.21), vec2(0.58, 0.27), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.58, 0.27), vec2(0.66, 0.16), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.66, 0.16), vec2(0.75, 0.25), aa));
    } else {
        // WINTER: Orion (left) & Taurus/Hyades (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.64, 0.35), vec2(-0.48, 0.32), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.64, 0.35), vec2(-0.58, 0.21), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.32), vec2(-0.52, 0.20), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.58, 0.21), vec2(-0.52, 0.20), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.58, 0.21), vec2(-0.62, 0.07), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.52, 0.20), vec2(-0.46, 0.06), aa));
        cMask = max(cMask, drawEdge(p, vec2(-0.62, 0.07), vec2(-0.46, 0.06), aa));

        cMask = max(cMask, drawEdge(p, vec2(0.44, 0.14), vec2(0.55, 0.22), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.22), vec2(0.68, 0.31), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.44, 0.14), vec2(0.57, 0.16), aa));
        cMask = max(cMask, drawEdge(p, vec2(0.57, 0.16), vec2(0.72, 0.21), aa));
    }
    add += mix(colSilver, colWarm, 0.30) * cMask * moonKeepout;
    return add;
}

// Concept 3: Engraved Astrolabe & Seasonal Wireframe Etchings
vec3 evalAstrolabeEtching(vec2 p, float r, float theta, int season, float t, float aa) {
    vec3 colSilver = vec3(0.84, 0.88, 0.96);
    vec3 colWarm   = vec3(0.95, 0.89, 0.74);
    vec3 colSlate  = vec3(0.48, 0.55, 0.68);

    vec3 add = vec3(0.0);

    // Central Astrolabe Moon Frame (crisp 1px rings & ticks)
    float rInner = crispStroke(abs(r - 0.258), 0.00055, aa) * 0.58;
    float rOuter = crispStroke(abs(r - 0.278), 0.00050, aa) * 0.42;
    add += colSilver * (rInner + rOuter);

    float nTicks = 120.0;
    float stepA = TWO_PI / nTicks;
    float idx = floor((theta + 0.5 * stepA) / stepA);
    float ang = idx * stepA;
    float dAng = abs(atan(sin(theta - ang), cos(theta - ang))) * r;
    bool major = mod(idx, 10.0) < 0.5;
    float rEnd = major ? 0.276 : 0.271;
    float inBand = smoothstep(0.258 - aa * 0.5, 0.258 + aa * 0.5, r)
                 * (1.0 - smoothstep(rEnd - aa * 0.5, rEnd + aa * 0.5, r));
    float tickHalfW = major ? 0.00052 : 0.00038;
    float tick = inBand * crispStroke(dAng, tickHalfW, aa) * (major ? 0.64 : 0.34);
    add += mix(colSilver, colWarm, major ? 0.5 : 0.0) * tick;

    float bottomAngDist = abs(atan(sin(theta + 0.5 * PI), cos(theta + 0.5 * PI)));
    float textSectorKeepout = 1.0 - (1.0 - smoothstep(0.32, 0.42, bottomAngDist))
                                  * (1.0 - smoothstep(0.018, 0.026, abs(r - 0.298)));

    float cardAng = mod(theta + PI * 0.25, PI * 0.5) - PI * 0.25;
    float cardPerp = abs(sin(cardAng)) * r;
    float cardLine = crispStroke(cardPerp, 0.00050, aa)
                   * smoothstep(0.282, 0.295, r)
                   * (1.0 - smoothstep(0.36, 0.42, r))
                   * textSectorKeepout * 0.34;
    add += colWarm * cardLine;

    // Seasonal Engraved Corner Etchings (keep center & all 3 corner widgets clear)
    float centerClear = smoothstep(0.38, 0.54, r);
    float widgetCornerClear = smoothstep(0.18, 0.34, length(p - vec2(-0.72, -0.34)))
                            * smoothstep(0.18, 0.34, length(p - vec2( 0.72, -0.34)))
                            * smoothstep(0.18, 0.34, length(p - vec2( 0.72,  0.34)));
    float cornerFade = smoothstep(0.32, 0.85, length(p * vec2(0.85, 1.15)))
                     * centerClear * widgetCornerClear;

    vec2 q = vec2(abs(p.x), p.y);
    vec2 focal = vec2(0.76, 0.36);
    vec2 d = q - focal;
    float dr = length(d);
    float da = atan(d.y, d.x) + t * 0.015;

    float etching = 0.0;
    if (season == 0) {
        // SPRING: Engraved botanical rosette contour lines
        float petal = dr + 0.055 * cos(5.0 * da) + 0.018 * cos(10.0 * da);
        float rings = abs(fract(petal * 18.0) - 0.5);
        etching = exp(-pow(rings / 0.045, 2.0)) * (1.0 - smoothstep(0.15, 0.62, dr));
    } else if (season == 1) {
        // SUMMER: Two-source harmonic interference ripples
        float d1 = length(q - vec2(0.78, 0.38));
        float d2 = length(q - vec2(0.52, 0.44));
        float wave = abs(fract((d1 - d2) * 16.0 - t * 0.03) - 0.5);
        float env = abs(fract((d1 + d2) * 11.0) - 0.5);
        etching = (exp(-pow(wave / 0.042, 2.0)) * 0.7 + exp(-pow(env / 0.040, 2.0)) * 0.4)
                * (1.0 - smoothstep(0.18, 0.68, dr));
    } else if (season == 2) {
        // AUTUMN: Topographic wind-flow elevation isolines
        float field = q.y * 1.4 - 0.35 * q.x
                    + 0.08 * sin(q.x * 9.0 + q.y * 5.0 + t * 0.05)
                    + 0.04 * cos(q.x * 17.0 - q.y * 11.0);
        float iso = abs(fract(field * 16.0) - 0.5);
        bool indexLine = mod(floor(field * 16.0), 4.0) < 0.5;
        etching = exp(-pow(iso / (indexLine ? 0.055 : 0.032), 2.0)) * (indexLine ? 1.0 : 0.55);
    } else {
        // WINTER: 6-fold crystalline ice geometry & hexagonal contour lattice
        float hexR = dr * (1.0 + 0.14 * cos(6.0 * da) + 0.05 * cos(12.0 * da));
        float hexRings = abs(fract(hexR * 20.0) - 0.5);
        float spokes = abs(sin(6.0 * da)) * dr;
        float spokeLine = exp(-pow(spokes / 0.0022, 2.0));
        etching = max(exp(-pow(hexRings / 0.045, 2.0)), spokeLine * 0.75)
                * (1.0 - smoothstep(0.12, 0.58, dr));
    }

    add += mix(colSlate, colWarm, 0.25) * etching * cornerFade * 0.28;
    return add;
}

void accumulatePlate(vec2 p, vec2 centre, float enabled, float pr, float aa,
                     inout float plate, inout float rim) {
    if (enabled < 0.5) {
        return;
    }
    float dc = length(p - centre);
    plate = max(plate, 1.0 - smoothstep(pr * 0.80, pr * 1.06, dc));
    rim = max(rim, crispStroke(abs(dc - pr * 1.02), 0.00045, aa));
}

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = vec2((uv.x - 0.5) * ubuf.aspectRatio, 0.5 - uv.y);
    float r = length(p);
    float theta = atan(p.y, p.x);
    float aa = max(fwidth(r), 0.00050);

    // Base deep-space radial gradient anchored to baseColor
    vec3 bgEdge = ubuf.baseColor.rgb;
    vec3 bgCenter = bgEdge + vec3(0.016, 0.024, 0.040) * (0.65 + 0.35 * ubuf.moonIllumination);
    vec3 col = mix(bgCenter, bgEdge, smoothstep(0.0, 0.95, r));

    int season = int(clamp(floor(ubuf.seasonIndex + 0.5), 0.0, 3.0));
    int style = int(clamp(floor(ubuf.styleMode + 0.5), 0.0, 2.0));

    vec3 motif = vec3(0.0);
    if (style == 0) {
        motif = evalPlanisphere(p, r, theta, season, ubuf.time, aa, ubuf.milkyWayIntensity);
    } else if (style == 1) {
        motif = evalAstrolabeEtching(p, r, theta, season, ubuf.time, aa);
    } else {
        motif = evalPlanisphere(p, r, theta, season, ubuf.time, aa, ubuf.milkyWayIntensity) * 0.85
              + evalAstrolabeEtching(p, r, theta, season, ubuf.time, aa) * 0.75;
    }

    // Corner instrument plates: quiet the sky behind each enabled corner
    // widget so its dial and caption read cleanly, with a faint engraved rim.
    float plate = 0.0;
    float plateRim = 0.0;
    if (ubuf.cornerPlate.w > 0.0) {
        float cx = ubuf.cornerPlate.x;
        float pr = ubuf.cornerPlate.w;
        accumulatePlate(p, vec2( cx, ubuf.cornerPlate.y), ubuf.cornerMask.x, pr, aa, plate, plateRim);
        accumulatePlate(p, vec2(-cx, ubuf.cornerPlate.z), ubuf.cornerMask.y, pr, aa, plate, plateRim);
        accumulatePlate(p, vec2( cx, ubuf.cornerPlate.z), ubuf.cornerMask.z, pr, aa, plate, plateRim);
        accumulatePlate(p, vec2(-cx, ubuf.cornerPlate.y), ubuf.cornerMask.w, pr, aa, plate, plateRim);
    }

    // Scale by user intensity setting (0.65 default maps to 1.0x reference)
    float weight = clamp(ubuf.intensity / 0.65, 0.0, 1.6);
    col += motif * weight * (1.0 - 0.88 * plate);
    col += vec3(0.52, 0.60, 0.74) * plateRim * 0.10 * weight;
    col = mix(col, ubuf.baseColor.rgb * 0.92, plate * 0.55);

    // Soft lunar halo: forward-scattered moonlight that scales with phase.
    if (ubuf.moonRadius > 0.0 && ubuf.haloIntensity > 0.001) {
        float mr = ubuf.moonRadius;
        float outside = smoothstep(mr * 0.98, mr * 1.02, r);
        float halo = exp(-(r - mr) / (mr * 0.30)) * 0.55 + exp(-(r - mr) / (mr * 1.20)) * 0.45;
        col += vec3(0.60, 0.66, 0.78) * halo * outside * 0.085 * ubuf.haloIntensity * (0.25 + 0.75 * ubuf.moonIllumination);
    }

    // Gentle optical vignette keeps the eye on the Moon.
    float vig = smoothstep(0.45, 1.15, length(p * vec2(0.82, 1.0)));
    col *= 1.0 - clamp(0.32 * ubuf.vignetteStrength, 0.0, 0.75) * vig;

    fragColor = vec4(col, 1.0) * ubuf.qt_Opacity;
}

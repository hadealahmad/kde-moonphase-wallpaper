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

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

float drawEdge(vec2 p, vec2 a, vec2 b) {
    float d = sdSegment(p, a, b);
    float line = exp(-pow(d / 0.0014, 2.0)) * 0.26;
    float nodeA = exp(-pow(length(p - a) / 0.0055, 2.0)) * 0.90;
    float nodeB = exp(-pow(length(p - b) / 0.0055, 2.0)) * 0.90;
    float ringA = exp(-pow((length(p - a) - 0.011) / 0.0014, 2.0)) * 0.35;
    float ringB = exp(-pow((length(p - b) - 0.011) / 0.0014, 2.0)) * 0.35;
    return max(line, max(max(nodeA, nodeB), max(ringA, ringB)));
}

float starLayer(vec2 p, float scale, float density, float t) {
    vec2 gv = p * scale;
    vec2 id = floor(gv);
    vec2 f = fract(gv) - 0.5;
    vec2 rnd = hash22(id);
    if (rnd.x > density) {
        return 0.0;
    }
    vec2 offset = (rnd - 0.5) * 0.72;
    float d = length(f - offset);
    float size = mix(0.018, 0.052, rnd.y * rnd.y);
    float twinkle = 0.82 + 0.18 * sin(t * 0.8 + rnd.x * 40.0);
    float core = exp(-pow(d / size, 2.0)) * twinkle;
    float spike = 0.0;
    if (rnd.y > 0.88) {
        vec2 q = abs(f - offset);
        spike = (exp(-q.x * 90.0) * exp(-q.y * 12.0) + exp(-q.y * 90.0) * exp(-q.x * 12.0)) * 0.35;
    }
    return (core + spike) * (0.28 + 0.72 * rnd.y);
}

// Concept 1: Celestial Planisphere & Star Chart
vec3 evalPlanisphere(vec2 p, float r, float theta, int season, float t) {
    vec3 colSilver = vec3(0.82, 0.86, 0.94);
    vec3 colWarm   = vec3(0.95, 0.89, 0.74);
    vec3 colSlate  = vec3(0.45, 0.52, 0.66);

    float moonKeepout = smoothstep(0.22, 0.27, r);
    vec3 add = vec3(0.0);

    // Concentric celestial coordinate circles
    float r1 = exp(-pow((r - 0.265) / 0.0014, 2.0)) * 0.32;
    float r2 = exp(-pow((r - 0.420) / 0.0012, 2.0)) * 0.18;
    float r3 = exp(-pow((r - 0.620) / 0.0012, 2.0)) * 0.14;
    float r4 = exp(-pow((r - 0.840) / 0.0012, 2.0)) * 0.10;
    add += colSlate * (r1 + r2 + r3 + r4);

    // Fine degree ticks around the inner Moon framing ring (r = 0.265)
    float nTicks = 72.0;
    float stepA = TWO_PI / nTicks;
    float idx = floor((theta + 0.5 * stepA) / stepA);
    float ang = idx * stepA;
    float dAng = abs(atan(sin(theta - ang), cos(theta - ang))) * r;
    bool major = mod(idx, 6.0) < 0.5;
    float tLen = major ? 0.012 : 0.005;
    float tick = (1.0 - smoothstep(tLen * 0.8, tLen, abs(r - 0.265)))
               * exp(-pow(dAng / 0.0012, 2.0)) * (major ? 0.38 : 0.18);
    add += colSilver * tick;

    // 12 radial hour-angle lines broken inside r = 0.265
    float hStep = TWO_PI / 12.0;
    float hIdx = floor((theta + 0.5 * hStep) / hStep);
    float hAng = hIdx * hStep;
    float hPerp = abs(atan(sin(theta - hAng), cos(theta - hAng))) * r;
    float hLine = exp(-pow(hPerp / 0.0011, 2.0))
                * smoothstep(0.275, 0.30, r)
                * (1.0 - smoothstep(0.82, 0.92, r)) * 0.09;
    add += colSlate * hLine;

    // Slow celestial sphere rotation when animated
    float rot = t * 0.004;
    mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    vec2 pStar = R * p;

    // Pinpoint starfield layers
    float s1 = starLayer(pStar, 14.0, 0.38, t);
    float s2 = starLayer(pStar + vec2(3.7, 1.9), 28.0, 0.25, t);
    float s3 = starLayer(pStar + vec2(8.1, 5.4), 52.0, 0.18, t);
    vec3 starCol = mix(colSilver, colWarm, 0.35) * (s1 * 0.65 + s2 * 0.42 + s3 * 0.25);
    add += starCol * moonKeepout;

    // Seasonal Constellations (left & right celestial wings)
    float cMask = 0.0;
    if (season == 0) {
        // SPRING: Leo (left) & Virgo (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.68, 0.12), vec2(-0.54, 0.16)));
        cMask = max(cMask, drawEdge(p, vec2(-0.54, 0.16), vec2(-0.46, 0.26)));
        cMask = max(cMask, drawEdge(p, vec2(-0.46, 0.26), vec2(-0.52, 0.35)));
        cMask = max(cMask, drawEdge(p, vec2(-0.52, 0.35), vec2(-0.60, 0.32)));
        cMask = max(cMask, drawEdge(p, vec2(-0.54, 0.16), vec2(-0.38, 0.10)));
        cMask = max(cMask, drawEdge(p, vec2(-0.38, 0.10), vec2(-0.46, 0.26)));

        cMask = max(cMask, drawEdge(p, vec2(0.42, 0.08), vec2(0.55, 0.18)));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.18), vec2(0.66, 0.14)));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.18), vec2(0.58, 0.31)));
        cMask = max(cMask, drawEdge(p, vec2(0.66, 0.14), vec2(0.75, 0.24)));
    } else if (season == 1) {
        // SUMMER: Cygnus (left) & Lyra (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.66, 0.34), vec2(-0.55, 0.22)));
        cMask = max(cMask, drawEdge(p, vec2(-0.55, 0.22), vec2(-0.43, 0.09)));
        cMask = max(cMask, drawEdge(p, vec2(-0.67, 0.13), vec2(-0.55, 0.22)));
        cMask = max(cMask, drawEdge(p, vec2(-0.55, 0.22), vec2(-0.44, 0.31)));

        cMask = max(cMask, drawEdge(p, vec2(0.46, 0.32), vec2(0.54, 0.25)));
        cMask = max(cMask, drawEdge(p, vec2(0.54, 0.25), vec2(0.64, 0.27)));
        cMask = max(cMask, drawEdge(p, vec2(0.64, 0.27), vec2(0.60, 0.15)));
        cMask = max(cMask, drawEdge(p, vec2(0.60, 0.15), vec2(0.50, 0.13)));
        cMask = max(cMask, drawEdge(p, vec2(0.50, 0.13), vec2(0.54, 0.25)));
    } else if (season == 2) {
        // AUTUMN: Pegasus Great Square (left) & Cassiopeia W (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.68, 0.30), vec2(-0.48, 0.33)));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.33), vec2(-0.45, 0.14)));
        cMask = max(cMask, drawEdge(p, vec2(-0.45, 0.14), vec2(-0.65, 0.11)));
        cMask = max(cMask, drawEdge(p, vec2(-0.65, 0.11), vec2(-0.68, 0.30)));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.33), vec2(-0.37, 0.40)));

        cMask = max(cMask, drawEdge(p, vec2(0.42, 0.32), vec2(0.50, 0.21)));
        cMask = max(cMask, drawEdge(p, vec2(0.50, 0.21), vec2(0.58, 0.27)));
        cMask = max(cMask, drawEdge(p, vec2(0.58, 0.27), vec2(0.66, 0.16)));
        cMask = max(cMask, drawEdge(p, vec2(0.66, 0.16), vec2(0.75, 0.25)));
    } else {
        // WINTER: Orion (left) & Taurus/Hyades (right)
        cMask = max(cMask, drawEdge(p, vec2(-0.64, 0.35), vec2(-0.48, 0.32)));
        cMask = max(cMask, drawEdge(p, vec2(-0.64, 0.35), vec2(-0.58, 0.21)));
        cMask = max(cMask, drawEdge(p, vec2(-0.48, 0.32), vec2(-0.52, 0.20)));
        cMask = max(cMask, drawEdge(p, vec2(-0.58, 0.21), vec2(-0.52, 0.20)));
        cMask = max(cMask, drawEdge(p, vec2(-0.58, 0.21), vec2(-0.62, 0.07)));
        cMask = max(cMask, drawEdge(p, vec2(-0.52, 0.20), vec2(-0.46, 0.06)));
        cMask = max(cMask, drawEdge(p, vec2(-0.62, 0.07), vec2(-0.46, 0.06)));

        cMask = max(cMask, drawEdge(p, vec2(0.44, 0.14), vec2(0.55, 0.22)));
        cMask = max(cMask, drawEdge(p, vec2(0.55, 0.22), vec2(0.68, 0.31)));
        cMask = max(cMask, drawEdge(p, vec2(0.44, 0.14), vec2(0.57, 0.16)));
        cMask = max(cMask, drawEdge(p, vec2(0.57, 0.16), vec2(0.72, 0.21)));
    }
    add += mix(colSilver, colWarm, 0.45) * cMask * moonKeepout;
    return add;
}

// Concept 3: Engraved Astrolabe & Seasonal Wireframe Etchings
vec3 evalAstrolabeEtching(vec2 p, float r, float theta, int season, float t) {
    vec3 colSilver = vec3(0.82, 0.86, 0.94);
    vec3 colWarm   = vec3(0.95, 0.89, 0.74);
    vec3 colSlate  = vec3(0.48, 0.55, 0.68);

    vec3 add = vec3(0.0);

    // Central Astrolabe Moon Frame
    float rInner = exp(-pow((r - 0.258) / 0.0014, 2.0)) * 0.42;
    float rOuter = exp(-pow((r - 0.278) / 0.0012, 2.0)) * 0.28;
    add += colSilver * (rInner + rOuter);

    float nTicks = 120.0;
    float stepA = TWO_PI / nTicks;
    float idx = floor((theta + 0.5 * stepA) / stepA);
    float ang = idx * stepA;
    float dAng = abs(atan(sin(theta - ang), cos(theta - ang))) * r;
    bool major = mod(idx, 10.0) < 0.5;
    float inBand = smoothstep(0.258, 0.261, r) * (1.0 - smoothstep(major ? 0.276 : 0.270, major ? 0.278 : 0.272, r));
    float tick = inBand * exp(-pow(dAng / 0.0010, 2.0)) * (major ? 0.45 : 0.20);
    add += mix(colSilver, colWarm, major ? 0.5 : 0.0) * tick;

    float cardAng = mod(theta + PI * 0.25, PI * 0.5) - PI * 0.25;
    float cardPerp = abs(sin(cardAng)) * r;
    float cardLine = exp(-pow(cardPerp / 0.0011, 2.0))
                   * smoothstep(0.282, 0.295, r)
                   * (1.0 - smoothstep(0.36, 0.42, r)) * 0.25;
    add += colWarm * cardLine;

    // Seasonal Engraved Corner Etchings (keep center & bottom widgets clear)
    float centerClear = smoothstep(0.38, 0.54, r);
    float bottomCornerClear = smoothstep(0.18, 0.34, length(p - vec2(-0.72, -0.34)))
                            * smoothstep(0.18, 0.34, length(p - vec2( 0.72, -0.34)));
    float cornerFade = smoothstep(0.32, 0.85, length(p * vec2(0.85, 1.15)))
                     * centerClear * bottomCornerClear;

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

void main() {
    vec2 uv = qt_TexCoord0;
    vec2 p = vec2((uv.x - 0.5) * ubuf.aspectRatio, 0.5 - uv.y);
    float r = length(p);
    float theta = atan(p.y, p.x);

    // Base deep-space radial gradient anchored to baseColor
    vec3 bgEdge = ubuf.baseColor.rgb;
    vec3 bgCenter = bgEdge + vec3(0.016, 0.024, 0.040) * (0.65 + 0.35 * ubuf.moonIllumination);
    vec3 col = mix(bgCenter, bgEdge, smoothstep(0.0, 0.95, r));

    int season = int(clamp(floor(ubuf.seasonIndex + 0.5), 0.0, 3.0));
    int style = int(clamp(floor(ubuf.styleMode + 0.5), 0.0, 2.0));

    vec3 motif = vec3(0.0);
    if (style == 0) {
        motif = evalPlanisphere(p, r, theta, season, ubuf.time);
    } else if (style == 1) {
        motif = evalAstrolabeEtching(p, r, theta, season, ubuf.time);
    } else {
        motif = evalPlanisphere(p, r, theta, season, ubuf.time) * 0.85
              + evalAstrolabeEtching(p, r, theta, season, ubuf.time) * 0.75;
    }

    // Scale by user intensity setting (0.65 default maps to 1.0x reference)
    float weight = clamp(ubuf.intensity / 0.65, 0.0, 1.6);
    col += motif * weight;

    fragColor = vec4(col, 1.0) * ubuf.qt_Opacity;
}

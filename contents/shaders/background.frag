#version 440

// ============================================================================
//  KDE Plasma 6 wallpaper - seasonal background shader
// ============================================================================
//
//  Single pass, procedural, no textures. Renders one of four motifs chosen by
//  seasonIndex:
//
//      0.0  Spring   floating cherry blossoms, warm rose/violet corner glow
//      1.0  Summer   sparse high-altitude cirrus, cool moonlight, fireflies
//      2.0  Autumn   falling golden / amber / russet leaves, ochre edge glow
//      3.0  Winter   falling snow, soft bokeh + crisp six-fold crystals
//
//  Design constraints:
//    * low GPU cost: no texture fetches, no derivatives, fixed loop counts,
//      a single full-screen pass at the wallpaper's native size.
//    * GLSL 100 es / 120 / 150, HLSL 5.0 and Metal 1.2 safe: no fwidth(),
//      no dFdx()/dFdy(), no bitwise operators, no uint, no non-constant
//      array indexing, every loop bound is a compile-time constant.
//    * Particles are laid out on screen-space grids so their density is
//      independent of resolution; per-cell hashes drive culling, phase and
//      colour so no two flakes / petals / leaves look alike.
//
//  Coordinate / sign conventions:
//    * qt_TexCoord0: (0,0) top-left, y grows DOWN.
//    * p: aspect-corrected, centred on the Moon. x in [-aspect/2, aspect/2],
//      y in [-0.5, 0.5]. Positive y is DOWN.
//    * "drift up" means the pattern moves toward the top of the screen, which
//      is a *decreasing* screen y, so the sampling coordinate is advanced by
//      +time * speed (f(x - vt) sampled as f(x + vt) with y pointing down).
//
//  Output is opaque, premultiplied alpha as Qt Quick expects.
//
//  Build:
//    make shader
//  or directly:
//    qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//        -o contents/shaders/background.frag.qsb contents/shaders/background.frag
// ============================================================================

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4  qt_Matrix;
    float qt_Opacity;
    vec4  baseColor;          // User's BackgroundColor (rgb)
    float seasonIndex;        // 0.0=Spring, 1.0=Summer, 2.0=Autumn, 3.0=Winter
    float time;               // Monotonic animation seconds
    float aspectRatio;        // width / height
    float intensity;          // 0.0..1.0 user density/opacity multiplier
    float moonIllumination;   // 0.0..1.0 (0=New Moon, 1=Full Moon)
};

const float TAU = 6.28318530717958647692;

// ---------------------------------------------------------------------------
//  Hashes. Cheap sin-based white noise; the inputs are small cell indices, so
//  the usual sin() precision caveat does not bite here.
// ---------------------------------------------------------------------------
float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p)
{
    return vec2(hash21(p),
                hash21(p + vec2(19.19, 7.77)));
}

// Right-handed 2D rotation, column-vector convention.
vec2 rot2(vec2 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// ---------------------------------------------------------------------------
//  Value noise + four-octave fBm, used only by the summer cirrus.
//  Loop bounds are literal constants so this unrolls identically everywhere.
// ---------------------------------------------------------------------------
float vnoise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm4(vec2 p)
{
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; ++i) {
        v += amp * vnoise(p);
        p = p * 2.03 + vec2(37.1, 17.7);
        amp *= 0.5;
    }
    return v * 1.0666667;   // 1 / (0.5 + 0.25 + 0.125 + 0.0625)
}

// ===========================================================================
//  Spring: one parallax layer of floating cherry blossoms.
// ===========================================================================
vec4 blossomLayer(vec2 p, float scale, float rise, float drift,
                  float size, float seed, float keep, float weight, float t)
{
    // Grid space: one unit == one cell. The whole grid drifts up and right.
    vec2 sp = p * scale;
    sp.y += t * rise * scale;
    sp.x -= t * drift * scale;
    // Gentle sinusoidal sway, per row, so the drift never looks mechanical.
    sp.x += sin(sp.y * 1.7 + seed * 5.0 + t * 0.35) * 0.16;

    vec2 cell = floor(sp);
    vec2 f = fract(sp) - 0.5;

    float h = hash21(cell + seed * 13.37);
    if (h < 0.45)
        return vec4(0.0);                     // cull ~45 % of the cells

    // Coarse 2x2 block mask: blossoms gather in drifts instead of blanketing
    // the whole sky, which keeps the field readable and the centre calm.
    if (hash21(floor(cell * 0.5) + seed * 47.1) > keep)
        return vec4(0.0);

    vec2 rnd = hash22(cell + seed * 3.17);
    vec2 q = f - (rnd - 0.5) * 0.55;

    q = rot2(q, t * 0.35 + h * TAU);

    float ang = atan(q.y, q.x) + t * 0.35 + h * TAU;
    float rad = length(q);

    float sizeVar = 0.70 + 0.55 * rnd.y;
    float petalRadius = size * sizeVar * (0.68 + 0.32 * cos(5.0 * ang));

    float aa = max(0.004, 0.14 * size);
    float mask = 1.0 - smoothstep(-aa, aa, rad - petalRadius);
    if (mask <= 0.0)
        return vec4(0.0);

    // Pastel sakura pink at the rim fading to cream near the heart.
    vec3 pink  = vec3(0.96, 0.72, 0.82);
    vec3 cream = vec3(1.00, 0.91, 0.94);
    float shade = clamp(rad / max(petalRadius, 1e-3), 0.0, 1.0);
    vec3 petal = mix(cream, pink, smoothstep(0.10, 0.92, shade));

    // Warm golden stamen dot.
    float stamen = 1.0 - smoothstep(size * 0.05, size * 0.17, rad);
    petal = mix(petal, vec3(0.99, 0.84, 0.42), stamen);

    float a = mask * weight * (0.65 + 0.35 * rnd.x);
    return vec4(petal * a, a);
}

// ===========================================================================
//  Autumn: one parallax layer of tumbling leaves.
// ===========================================================================
vec4 leafLayer(vec2 p, float scale, float fall, float wind,
               float size, float seed, float keep, float weight, float t)
{
    vec2 sp = p * scale;
    sp.y -= t * fall * scale;                 // pattern falls downward
    sp.x -= t * wind * scale;                 // and drifts right
    sp.x += sin(sp.y * 1.35 + seed * 4.0 + t * 0.5) * 0.20;

    vec2 cell = floor(sp);
    vec2 f = fract(sp) - 0.5;

    float h = hash21(cell + seed * 5.11);
    if (h < 0.38)
        return vec4(0.0);

    if (hash21(floor(cell * 0.5) + seed * 31.7) > keep)
        return vec4(0.0);

    vec2 rnd = hash22(cell + seed * 9.73);
    vec2 q = f - (rnd - 0.5) * 0.50;

    // Spin about the leaf normal, then squash x to fake a 3D tumble.
    float phase = h * TAU;
    q = rot2(q, t * (0.35 + 0.60 * h) + phase);

    float flutter = max(0.32, abs(cos(t * (1.10 + h) + phase)));
    q.x /= flutter;

    float rad = size * (0.78 + 0.40 * rnd.y);
    float off = rad * 0.64;

    // Vesica / pointed-leaf SDF: intersection of two offset circles.
    float d = max(length(q - vec2(off, 0.0)) - rad,
                  length(q + vec2(off, 0.0)) - rad);

    float aa = max(0.004, 0.08 * size);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.0)
        return vec4(0.0);

    // Faint central vein along the long axis.
    float vein = (1.0 - smoothstep(0.0, aa * 1.8, abs(q.y))) * mask;

    vec3 gold   = vec3(0.95, 0.74, 0.20);
    vec3 amber  = vec3(0.88, 0.48, 0.15);
    vec3 russet = vec3(0.76, 0.32, 0.14);

    vec3 leaf = mix(gold, amber, smoothstep(0.20, 0.72, h));
    leaf = mix(leaf, russet, smoothstep(0.62, 0.95, h) * 0.85);
    leaf = mix(leaf, gold * 1.05, vein * 0.35);
    leaf = mix(leaf, russet, vein * 0.18);

    float a = mask * weight * (0.86 + 0.14 * rnd.x);
    return vec4(leaf * a, a);
}

// ===========================================================================
//  Winter: one parallax layer of snow. starFlag <= 0.5 -> soft bokeh disk,
//  starFlag > 0.5 -> crisp six-fold crystal.
// ===========================================================================
vec4 snowLayer(vec2 p, float scale, float fall, float sizeBase,
               float starFlag, float seed, float keep, float weight, float t)
{
    vec2 sp = p * scale;
    sp.y -= t * fall * scale;                 // pattern falls downward
    sp.x += sin(sp.y * 0.9 + seed * 3.0 + t * 0.6) * 0.18;

    vec2 cell = floor(sp);
    vec2 f = fract(sp) - 0.5;

    float h = hash21(cell + seed * 11.1);
    if (h < 0.38)
        return vec4(0.0);

    if (hash21(floor(cell * 0.5) + seed * 53.9) > keep)
        return vec4(0.0);

    vec2 rnd = hash22(cell + seed * 2.37);
    vec2 q = f - (rnd - 0.5) * 0.55;

    float rad = length(q);
    float spin = t * 0.45 + h * TAU;

    vec3 ice = vec3(0.86, 0.93, 1.00);
    float a;

    if (starFlag > 0.5) {
        // Six-fold crystal star, crisp edge with a tiny soft core.
        float ang = atan(q.y, q.x) + spin;
        float size = sizeBase * (0.80 + 0.35 * rnd.y);
        float star = size * (0.55 + 0.45 * cos(6.0 * ang));
        float aa = max(0.002, 0.05 * size);
        float arms = 1.0 - smoothstep(-aa, aa, rad - star);
        float core = 1.0 - smoothstep(size * 0.10, size * 0.34, rad);
        a = max(arms * 0.92, core) * weight;
        ice = vec3(0.86, 0.93, 1.0);
    } else {
        // Bokeh: soft disk, brightness rising toward the centre.
        float size = sizeBase * (0.70 + 0.55 * rnd.y);
        float disk = 1.0 - smoothstep(size * 0.20, size, rad);
        a = disk * weight * (0.55 + 0.45 * rnd.x);
        ice = vec3(0.84, 0.92, 1.0) * (0.92 + 0.08 * h);
    }

    if (a <= 0.0)
        return vec4(0.0);
    return vec4(ice * a, a);
}

// ===========================================================================
void main()
{
    vec2 uv = qt_TexCoord0;
    vec2 p = (uv - vec2(0.5)) * vec2(aspectRatio, 1.0);

    // Soft clearance in front of the Moon and the telemetry column.
    float centerClear = smoothstep(0.14, 0.42, length(p));
    float effectWeight = clamp(intensity, 0.0, 1.0) * (0.25 + 0.75 * centerClear);

    vec3 col = baseColor.rgb;

    float t      = max(time, 0.0);
    float season = clamp(seasonIndex, 0.0, 3.0);
    float moon   = clamp(moonIllumination, 0.0, 1.0);

    float corner = smoothstep(0.22, 1.15, length(p));

    if (season < 0.5) {
        // -------------------------------------------------------------------
        //  SPRING - cherry blossoms in a warm rose / violet haze.
        // -------------------------------------------------------------------
        vec3 rose   = vec3(0.98, 0.66, 0.76);
        vec3 violet = vec3(0.60, 0.50, 0.88);
        float warm = clamp(0.35 + 0.65 * (1.0 - uv.y) * (0.45 + 0.55 * uv.x),
                           0.0, 1.0);
        vec3 glow = mix(violet, rose, warm);
        col = mix(col, glow, 0.13 * corner * effectWeight);

        // Far -> near parallax layers.
        vec4 b = blossomLayer(p, 13.0, 0.006, 0.008, 0.26, 8.7, 0.26, 0.52 * effectWeight, t);
        col = col * (1.0 - b.a) + b.rgb;

        b = blossomLayer(p, 8.5, 0.010, 0.012, 0.26, 4.3, 0.30, 0.66 * effectWeight, t);
        col = col * (1.0 - b.a) + b.rgb;

        b = blossomLayer(p, 5.5, 0.015, 0.018, 0.22, 1.9, 0.36, 0.88 * effectWeight, t);
        col = col * (1.0 - b.a) + b.rgb;
    } else if (season < 1.5) {
        // -------------------------------------------------------------------
        //  SUMMER - sparse nocturnal cirrus lit by the Moon.
        // -------------------------------------------------------------------
        float moonGain = 0.35 + 0.65 * moon;
        vec3 moonlight = vec3(0.62, 0.76, 0.96);

        vec2 cp1 = vec2(p.x * 1.6 + t * 0.012, p.y * 2.8);
        float c1 = smoothstep(0.56, 0.86, fbm4(cp1));

        // Second, slower deck: thinner streaks for the wisps the first layer
        // misses, so the sky is never empty or top-heavy.
        vec2 cp2 = vec2(p.x * 0.90 - t * 0.006, p.y * 5.0) + vec2(11.3, 5.7);
        float c2 = smoothstep(0.56, 0.88, fbm4(cp2));

        float clouds = max(c1, c2 * 0.85);
        // Thin the cloud deck right behind the Moon.
        clouds *= 0.30 + 0.70 * centerClear;

        vec3 cloudCol = moonlight * (0.45 + 0.55 * moonGain);
        col = mix(col, cloudCol, clouds * 0.30 * moonGain * effectWeight);

        // Faint warm fireflies / low starlight in the lower third.
        vec2 fp = p * 13.0;
        fp.y += t * 0.22;
        vec2 fc = floor(fp);
        vec2 ff = fract(fp) - 0.5;
        float fh = hash21(fc + 7.31);
        if (fh > 0.83) {
            vec2 fo = (hash22(fc + 1.77) - 0.5) * 0.62;
            float fd = length(ff - fo);
            float tw = 0.55 + 0.45 * sin(t * 2.1 + fh * 43.0);
            float glint = 1.0 - smoothstep(0.0, 0.10, fd);
            float lower = smoothstep(-0.02, 0.26, p.y)
                        * (1.0 - smoothstep(0.33, 0.50, p.y));
            float a = glint * tw * lower * 0.55 * effectWeight;
            col += vec3(1.0, 0.84, 0.52) * a;
        }

        // A handful of cold sparkles for the rest of the sky.
        vec2 sp2 = p * 27.0;
        vec2 sc2 = floor(sp2);
        vec2 sf2 = fract(sp2) - 0.5;
        float sh = hash21(sc2 + 3.91);
        if (sh > 0.94) {
            vec2 so = (hash22(sc2 + 8.13) - 0.5) * 0.6;
            float sd = length(sf2 - so);
            float tw = 0.45 + 0.55 * sin(t * 1.3 + sh * 61.0);
            float glint = 1.0 - smoothstep(0.0, 0.14, sd);
            float a = glint * tw * 0.30 * (0.35 + 0.65 * centerClear) * effectWeight;
            col += vec3(0.80, 0.88, 1.0) * a;
        }
    } else if (season < 2.5) {
        // -------------------------------------------------------------------
        //  AUTUMN - amber haze and falling leaves.
        // -------------------------------------------------------------------
        vec3 ochre = mix(vec3(0.90, 0.52, 0.18), vec3(0.70, 0.40, 0.16),
                         clamp(uv.y, 0.0, 1.0));
        col = mix(col, ochre, 0.11 * corner * effectWeight);

        vec4 l = leafLayer(p, 12.0, 0.045, 0.014, 0.30, 6.1, 0.30, 0.70 * effectWeight, t);
        col = col * (1.0 - l.a) + l.rgb;

        l = leafLayer(p, 8.0, 0.070, 0.019, 0.28, 3.3, 0.34, 0.85 * effectWeight, t);
        col = col * (1.0 - l.a) + l.rgb;

        l = leafLayer(p, 5.0, 0.100, 0.025, 0.24, 1.2, 0.40, 1.00 * effectWeight, t);
        col = col * (1.0 - l.a) + l.rgb;
    } else {
        // -------------------------------------------------------------------
        //  WINTER - icy vignette, bokeh snow, crystal foreground.
        // -------------------------------------------------------------------
        vec3 ice = mix(vec3(0.42, 0.52, 0.85), vec3(0.55, 0.45, 0.80),
                       clamp(uv.y, 0.0, 1.0));
        col = mix(col, ice, 0.12 * corner * effectWeight);

        vec4 s = snowLayer(p, 16.0, 0.040, 0.38, 0.0, 5.7, 0.14, 0.40 * effectWeight, t);
        col = col * (1.0 - s.a) + s.rgb;

        s = snowLayer(p, 10.0, 0.065, 0.34, 0.0, 2.9, 0.18, 0.55 * effectWeight, t);
        col = col * (1.0 - s.a) + s.rgb;

        s = snowLayer(p, 6.0, 0.095, 0.17, 1.0, 9.1, 0.24, 0.70 * effectWeight, t);
        col = col * (1.0 - s.a) + s.rgb;
    }

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0) * qt_Opacity;
}

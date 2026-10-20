#version 440

// ============================================================================
//  KDE Plasma 6 wallpaper - Earth day/night shader
// ============================================================================
//
//  A small (~230 px) observer-centred globe intended to sit in the corner of
//  the wallpaper.  The observer is always at the centre of the disk; the
//  globe is rotated so that the observer's latitude/longitude faces us.
//
//  Coordinate / sign conventions (read before touching the math):
//
//    * View space:  x = right (east on screen),
//                   y = up    (north on screen),
//                   z = toward the viewer.
//      qt_TexCoord0.y points down, hence the negation when building Nv.
//
//    * Earth-fixed world space:
//          +X = 90 deg east longitude
//          +Y = north pole
//          +Z = 0 deg longitude (prime meridian)
//      A point at (lat, lon) is therefore
//          (cos(lat) sin(lon), sin(lat), cos(lat) cos(lon)).
//      sunVectorWorld points from the Earth toward the Sun in this frame.
//
//    * Observer rotation:
//          Nw = Ry(lon) * Rx(-lat) * Nv
//      which maps the view centre (0,0,1) to (lat, lon) and keeps east to the
//      right / north up.  The inverse (world -> view) is
//          Nv = Rx(lat) * Ry(-lon) * Nw
//      and is used to bring the Sun into view space for the ocean glint.
//
//    * UV: standard 2:1 equirectangular,
//          u = 0.5 + atan(Nw.x, Nw.z) / TAU   (east increases u)
//          v = 0.5 - asin(Nw.y) / PI          (north is v = 0)
//
//    * Textures are sRGB.  daySource is RGB albedo with A = ocean mask
//      (high = ocean), nightSource is RGB city lights on black.
//
//    * The pixel is expanded slightly (2.08) so the atmospheric halo reaches
//      the widget bounds while a 2 % margin keeps the limb off the corners.
//
//  Build:
//    qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//        -o contents/shaders/earth.frag.qsb contents/shaders/earth.frag
// ============================================================================

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec3 sunVectorWorld;       // normalized, Earth-fixed
    float observerLatRad;
    float observerLonRad;
    float nightLightsBoost;    // default 1.1
    float atmosphereIntensity; // default 0.75
    float showObserverPin;     // 1.0 = draw the observer reticle
};

layout(binding = 1) uniform sampler2D daySource;    // RGB albedo, A = ocean
layout(binding = 2) uniform sampler2D nightSource;  // RGB city lights

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

// ---------------------------------------------------------------------------
//  Right-handed rotations, column-vector convention (same as moon.frag).
// ---------------------------------------------------------------------------
vec3 rotateX(vec3 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

vec3 rotateY(vec3 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

vec3 srgbToLinear(vec3 c)
{
    return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 linearToSrgb(vec3 c)
{
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

void main()
{
    // -----------------------------------------------------------------------
    //  1. Disk mapping.  r = 1 is the surface, the halo ends near r = 1.04.
    // -----------------------------------------------------------------------
    vec2  p  = (qt_TexCoord0 - vec2(0.5)) * 2.08;
    float r2 = dot(p, p);
    float r  = sqrt(r2);
    float aa = max(fwidth(r), 0.0015);          // ~1 px at the target size

    float lat = observerLatRad;
    float lon = observerLonRad;

    // Defensive normalisation: a zero vector would make every dot product NaN.
    vec3 Lw = sunVectorWorld;
    float ll = length(Lw);
    Lw = (ll > 1e-5) ? Lw / ll : vec3(0.0, 0.0, 1.0);

    // -----------------------------------------------------------------------
    //  2. Observer-centred sphere normal and world direction.
    //     For r > 1 the normal lies on the limb (z = 0); it is only used for
    //     the daytime weighting of the halo.
    // -----------------------------------------------------------------------
    vec3 Nv = normalize(vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - min(r2, 1.0)))));
    vec3 Nw = rotateY(rotateX(Nv, -lat), lon);

    float mu        = dot(Nw, Lw);
    float dayFactor = smoothstep(-0.06, 0.08, mu);

    // -----------------------------------------------------------------------
    //  3. Equirectangular sampling.  The tiny bias in atan() keeps the exact
    //     pole (x = z = 0) well defined instead of atan(0,0).
    // -----------------------------------------------------------------------
    float u = 0.5 + atan(Nw.x, Nw.z + 1e-9) / TAU;
    u = fract(u);
    float v = clamp(0.5 - asin(clamp(Nw.y, -1.0, 1.0)) / PI, 0.0, 1.0);
    vec2 uv = vec2(u, v);

    vec4 dayTex   = texture(daySource, uv);
    vec3 nightTex = texture(nightSource, uv).rgb;

    // Qt Quick uploads RGBA images premultiplied by alpha.  daySource carries
    // the ocean mask in A (not a coverage value), so undo the premultiply to
    // recover the authored albedo (ocean keeps A = 1 and is unchanged).
    vec3 dayRgb = dayTex.rgb / max(dayTex.a, 0.02);

    vec3 dayLin   = srgbToLinear(dayRgb);
    // The night map is an emissive intensity map, not a lit surface: keeping it
    // display-referred avoids crushing the dim lights into the night side at
    // 230 px.  Only the day albedo needs the sRGB -> linear decode.
    vec3 nightLights = max(nightTex, vec3(0.0));

    // -----------------------------------------------------------------------
    //  4. Daylight.  Slightly sub-linear falloff keeps the terminator soft
    //     and the day side from looking like a flat sticker.
    // -----------------------------------------------------------------------
    float ndl = max(mu, 0.0);
    vec3 lit = dayLin * (0.10 + 0.95 * pow(ndl, 0.9)) * dayFactor;

    // Warm twilight band straddling the terminator.  Keep it narrow: at
    // 230 px a wide band reads as a brown ring around the globe.
    float twilight = smoothstep(-0.032, -0.003, mu)
                   * (1.0 - smoothstep(-0.003, 0.032, mu));
    lit += vec3(1.0, 0.46, 0.14) * twilight * 0.10;

    // -----------------------------------------------------------------------
    //  5. Ocean glint.  The Sun is rotated back into view space, so the
    //     highlight stays put on the globe rather than following the screen.
    // -----------------------------------------------------------------------
    vec3 Lv = rotateX(rotateY(Lw, -lon), lat);
    vec3 hv = Lv + vec3(0.0, 0.0, 1.0);
    vec3 H  = hv / max(length(hv), 1e-5);
    float ocean = smoothstep(0.5, 0.8, dayTex.a);
    float spec  = pow(max(dot(Nv, H), 0.0), 80.0) * ocean * dayFactor * 0.35;
    lit += vec3(1.0, 0.96, 0.88) * spec;

    // -----------------------------------------------------------------------
    //  6. Night side: city lights, then a whisper of albedo so the continents
    //     do not disappear completely.  nightGate is 1 on the night side
    //     (smoothstep written with increasing edges on purpose).
    // -----------------------------------------------------------------------
    float nightGate = 1.0 - smoothstep(-0.15, 0.05, mu);

    vec3 lights = nightLights * nightLightsBoost * nightGate;
    lights *= vec3(1.0, 0.78, 0.50);            // warm amber
    vec3 nightSurface = dayLin * vec3(0.045, 0.060, 0.095) * nightGate;

    // -----------------------------------------------------------------------
    //  7. Rayleigh rim, stronger on the day limb, plus a faint night limb.
    // -----------------------------------------------------------------------
    float fres   = pow(1.0 - clamp(Nv.z, 0.0, 1.0), 3.0);
    float rimDay = smoothstep(-0.25, 0.30, mu);
    lit += vec3(0.28, 0.52, 1.0) * fres * rimDay * 0.65 * atmosphereIntensity;
    lit += vec3(0.10, 0.20, 0.42) * fres * 0.20 * atmosphereIntensity;

    // -----------------------------------------------------------------------
    //  8. Observer reticle: a small glowing dot inside a thin ring.
    //     It is added in linear light so it stays visible over both the bright
    //     day side and the dark night side.
    // -----------------------------------------------------------------------
    if (showObserverPin > 0.5) {
        // Fixed sub-pixel widths: fwidth(r) is ~0.009 at 230 px, which would
        // otherwise blur the 1 px dot and ring into each other.
        float pinAA = max(fwidth(r) * 0.55, 0.0025);
        float dotMask = 1.0 - smoothstep(0.0055 - pinAA, 0.0055 + pinAA, r);
        float ring = smoothstep(0.0210 - pinAA, 0.0210 + pinAA, r)
                   * (1.0 - smoothstep(0.0245 - pinAA, 0.0245 + pinAA, r));
        float glow = exp(-r2 / 0.00012) * 0.20;

        lit += vec3(0.62, 0.93, 1.0) * (dotMask * 1.8 + ring * 2.8 + glow);
    }

    vec3 surface = lit + nightSurface + lights;

    // -----------------------------------------------------------------------
    //  9. Gentle filmic shoulder, then sRGB encode.  This keeps the day side
    //     bright without flattening the oceans or clipping city lights.
    // -----------------------------------------------------------------------
    surface *= 1.16;
    surface = vec3(1.0) - exp(-surface * 1.15);
    surface = linearToSrgb(clamp(surface, 0.0, 1.0));

    // -----------------------------------------------------------------------
    // 10. Atmospheric halo outside the limb.  Analytic exponential falloff
    //     weighted by the local day/night side; exactly zero by r = 1.04.
    // -----------------------------------------------------------------------
    float t = clamp((r - 1.0) / 0.04, 0.0, 1.0);
    float haloFall = exp(-4.2 * t) * (1.0 - t) * (1.0 - t);
    float dayEdge  = smoothstep(-0.12, 0.35, mu);
    float haloA    = haloFall * (0.16 + 0.55 * dayEdge) * atmosphereIntensity;

    vec3  haloRgb = vec3(0.30, 0.56, 1.0) * (0.55 + 0.65 * dayEdge);
    haloRgb = min(haloRgb, vec3(1.0));

    // -----------------------------------------------------------------------
    // 11. Composite the analytic limb and the halo, then premultiply.  The
    //     surface fades over ~1.5 px while the halo takes over, so there is no
    //     hard cut at r = 1.
    // -----------------------------------------------------------------------
    float sphereCov = 1.0 - smoothstep(1.0 - 1.5 * aa, 1.0 + 1.5 * aa, r);
    float haloPart  = haloA * (1.0 - sphereCov);
    float alpha     = sphereCov + haloPart;

    if (alpha < 0.002)
        discard;

    vec3 rgb = surface * sphereCov + haloRgb * haloPart;
    fragColor = vec4(rgb, alpha) * qt_Opacity;
}

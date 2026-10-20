#version 440

// ============================================================================
//  KDE Plasma 6 wallpaper - Moon phase shader
// ============================================================================
//
//  Coordinate / sign conventions (read before touching the math):
//
//    * View space:  x = right (celestial east as seen on screen),
//                   y = up    (celestial north),
//                   z = toward the viewer.
//      qt_TexCoord0.y points down, hence the negation when building N.
//
//    * sunDirection: normalized, points from the Moon toward the Sun.
//        (0, 0, +1)  full moon
//        (0, 0, -1)  new moon
//        (+1, 0, 0)  first quarter (right limb lit)
//
//    * libration.x = selenographic longitude of the sub-Earth point [rad].
//      libration.y = selenographic latitude  of the sub-Earth point [rad].
//      Positive longitude brings EASTERN features (u slightly above 0.5)
//      toward the centre of the disk. Positive latitude brings NORTHERN
//      features (v slightly below 0.5) toward the centre.
//      Internally the body-fixed sampling direction is
//          B = Rx(-lat) * Ry(+lon) * Rz(roll) * N
//      i.e. the inverse rotation of the Moon relative to the observer.
//
//    * rollAngleRad: positive values rotate the *rendered image* CLOCKWISE
//      (the parallactic-angle direction as seen in the sky). If the
//      integrator's astronomy code uses the opposite sign, negate it there.
//
//    * Albedo texture: 2:1 equirectangular, u = 0.5 at the prime meridian,
//      v = 0 at the north pole (north at the top of the image).
//      Treated as sRGB and decoded to linear before lighting, then encoded
//      back to sRGB for output (see the end of main()).
//
//    * Normal texture: tangent space, +R = east (+u), +G = north (up in the
//      image), +B = out of the surface. This is the usual OpenGL style.
//      For a DirectX style map (green pointing south), negate nTex.y.
//
//    * Texture providers should have mipmapping enabled (for example
//      Image { mipmap: true } or an equivalent texture provider setting).
//      Without mipmaps the equirectangular maps alias badly at the limb,
//      where many texels collapse into one pixel.
//
//  Textures are bound at bindings 1 and 2 by the integrator through the
//  ShaderEffect properties albedoSource / normalSource.
//
//  Build:
//    make shader
//  or directly:
//    qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//        -o contents/shaders/moon.frag.qsb contents/shaders/moon.frag
// ============================================================================

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec3 sunDirection;      // toward the Sun, normalized
    vec2 libration;         // x = lon, y = lat, radians
    float earthshine;       // ambient dark-side light
    float normalStrength;   // crater relief multiplier
    float rollAngleRad;     // hemisphere / parallactic rotation
};

layout(binding = 1) uniform sampler2D albedoSource;
layout(binding = 2) uniform sampler2D normalSource;

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

// ---------------------------------------------------------------------------
//  Small rotation helpers (right-handed, column-vector convention).
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

vec3 rotateZ(vec3 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}

void main()
{
    // -----------------------------------------------------------------------
    //  1. Disk mapping.  2.04 leaves a 2 % margin around the unit disk.
    // -----------------------------------------------------------------------
    vec2 p = (qt_TexCoord0 - vec2(0.5)) * 2.04;
    float r2 = dot(p, p);
    float r  = sqrt(r2);

    // Anti-aliased limb. Fully transparent outside the disk so the desktop
    // shows through.
    float alpha = 1.0 - smoothstep(0.993, 1.0, r);
    if (alpha <= 0.0)
        discard;

    // Sphere normal in view space.  p.y is down, so negate it to get north up.
    vec3 N = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - min(r2, 1.0))));
    N = normalize(N);

    // -----------------------------------------------------------------------
    //  2. Roll the whole sphere about the view axis.
    // -----------------------------------------------------------------------
    float roll = rollAngleRad;
    N = rotateZ(N, roll);

    // -----------------------------------------------------------------------
    //  3. Libration: rotate the view normal into the body-fixed frame.
    //     B = Rx(-lat) * Ry(+lon) * Rz(roll) * N
    // -----------------------------------------------------------------------
    float lon = libration.x;
    float lat = libration.y;

    vec3 B = rotateY(N, lon);
    B = rotateX(B, -lat);

    // Spherical (equirectangular) UV on the body-fixed sphere.
    float u = 0.5 + atan(B.x, B.z) / TAU;
    u = fract(u);                                   // u is in (0, 1]
    float v = 0.5 - asin(clamp(B.y, -1.0, 1.0)) / PI;
    v = clamp(v, 0.0, 1.0);
    vec2 uv = vec2(u, v);

    // -----------------------------------------------------------------------
    //  4. Tangent frame.
    //     The east tangent of the body-fixed sphere is dP/dlon:
    //         T_body = (B.z, 0, -B.x)
    //     Rotating it back into view space with the inverse libration+roll
    //     keeps the normal map glued to the surface. The bitangent is chosen
    //     as cross(N, T), which points north (green = up in the image).
    // -----------------------------------------------------------------------
    vec3 Tb = vec3(B.z, 0.0, -B.x);
    float tl = length(Tb);
    Tb = (tl > 1e-4) ? Tb / tl : vec3(1.0, 0.0, 0.0);   // pole fallback

    // Inverse of the body rotation applied above.
    vec3 T = rotateX(Tb, lat);
    T = rotateY(T, -lon);
    T = rotateZ(T, -roll);

    // Re-orthogonalize against N (libration is small, but be exact).
    T = T - N * dot(N, T);
    float tlen = length(T);
    T = (tlen > 1e-4) ? T / tlen : vec3(1.0, 0.0, 0.0);
    vec3 Bt = cross(N, T);                              // north / +G

    // -----------------------------------------------------------------------
    //  5. Albedo and tangent-space normal map (2 texture fetches total).
    // -----------------------------------------------------------------------
    vec3 albedo = texture(albedoSource, uv).rgb;
    albedo = pow(max(albedo, vec3(0.0)), vec3(2.2));    // sRGB -> linear

    vec3 nTex = texture(normalSource, uv).rgb * 2.0 - 1.0;
    float ns = clamp(normalStrength, 0.0, 4.0);
    nTex.xy *= ns;
    // Fade the relief out at the limb where the tangent frame degenerates.
    nTex.xy *= mix(0.35, 1.0, smoothstep(0.0, 0.25, N.z));
    nTex.z = sqrt(max(0.0, 1.0 - dot(nTex.xy, nTex.xy)));
    vec3 Nlit = normalize(T * nTex.x + Bt * nTex.y + N * nTex.z);

    // -----------------------------------------------------------------------
    //  6. Lommel-Seeliger / Lambert blend.
    // -----------------------------------------------------------------------
    vec3 L = sunDirection;
    float ll = length(L);
    L = (ll > 1e-6) ? L / ll : vec3(0.0, 0.0, 1.0);
    vec3 V = vec3(0.0, 0.0, 1.0);

    float mu0 = max(dot(Nlit, L), 0.0);                 // sun / surface
    float mu  = max(dot(N, V), 0.0);                    // viewer / surface (geometric)

    float ls      = mu0 / max(mu0 + mu, 1e-4);
    float lambert = mu0;
    float diffuse = mix(ls * 1.6, lambert, 0.35);

    // Soft terminator: no hard polygon edge, a touch of multiple scattering.
    diffuse *= smoothstep(-0.02, 0.06, mu0);

    // -----------------------------------------------------------------------
    //  7. Earthshine + faint ambient on the unlit side.
    // -----------------------------------------------------------------------
    float night = 1.0 - smoothstep(-0.03, 0.10, mu0);
    float earth = clamp(earthshine, 0.0, 1.0) * night * (0.55 + 0.45 * mu);

    vec3 color = albedo * (diffuse + 0.004 + earth);

    // -----------------------------------------------------------------------
    //  8. Tone map (linear) and sRGB encode. Keeps the full moon bright
    //     without clipping to flat white.
    // -----------------------------------------------------------------------
    color *= 1.15;                                       // exposure
    color = color / (vec3(1.0) + color * 0.35);          // soft shoulder
    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(1.0 / 2.2));                 // linear -> sRGB

    // Very slight warm bias; keeps the regolith neutral grey.
    color *= vec3(1.0, 0.994, 0.985);

    // -----------------------------------------------------------------------
    //  9. Premultiplied alpha output (Qt Quick blending expects this).
    // -----------------------------------------------------------------------
    fragColor = vec4(color * alpha, alpha) * qt_Opacity;
}

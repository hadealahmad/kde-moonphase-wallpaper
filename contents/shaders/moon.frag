#version 440

// ============================================================================
//  KDE Plasma 6 wallpaper - Moon phase shader
// ============================================================================
//
//  Supports single-texture channel-packed mode (usePackedAlbedo > 0.5):
//    normalSource.rg = tangent-space normal (nx, ny)
//    normalSource.b  = lunar surface albedo luminance (sRGB)
//  as well as legacy dual-sampler mode (usePackedAlbedo == 0.0) for procedural
//  smoke tests.
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
    float usePackedAlbedo;  // > 0.5: read albedo luma from normalSource.b
};

layout(binding = 1) uniform sampler2D albedoSource;
layout(binding = 2) uniform sampler2D normalSource;

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

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
    // 1. Disk mapping. 2.04 leaves a 2 % margin around the unit disk.
    vec2 p = (qt_TexCoord0 - vec2(0.5)) * 2.04;
    float r2 = dot(p, p);
    float r  = sqrt(r2);

    float alpha = 1.0 - smoothstep(0.993, 1.0, r);
    if (alpha <= 0.0)
        discard;

    vec3 N = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - min(r2, 1.0))));
    N = normalize(N);

    // 2. Roll the whole sphere about the view axis.
    float roll = rollAngleRad;
    N = rotateZ(N, roll);

    // 3. Libration: rotate the view normal into the body-fixed frame.
    float lon = libration.x;
    float lat = libration.y;

    vec3 B = rotateY(N, lon);
    B = rotateX(B, -lat);

    float u = 0.5 + atan(B.x, B.z) / TAU;
    u = fract(u);
    float v = 0.5 - asin(clamp(B.y, -1.0, 1.0)) / PI;
    v = clamp(v, 0.0, 1.0);
    vec2 uv = vec2(u, v);

    // 4. Tangent frame.
    vec3 Tb = vec3(B.z, 0.0, -B.x);
    float tl = length(Tb);
    Tb = (tl > 1e-4) ? Tb / tl : vec3(1.0, 0.0, 0.0);

    vec3 T = rotateX(Tb, lat);
    T = rotateY(T, -lon);
    T = rotateZ(T, -roll);

    T = T - N * dot(N, T);
    float tlen = length(T);
    T = (tlen > 1e-4) ? T / tlen : vec3(1.0, 0.0, 0.0);
    vec3 Bt = cross(N, T);

    // 5. Albedo and tangent-space normal map (single texture fetch in packed mode).
    vec3 nSample = texture(normalSource, uv).rgb;
    vec3 albedo;
    if (usePackedAlbedo > 0.5) {
        albedo = vec3(nSample.b) * vec3(1.0207, 0.9998, 0.9411);
    } else {
        albedo = texture(albedoSource, uv).rgb;
    }
    albedo = pow(max(albedo, vec3(0.0)), vec3(2.2));

    vec3 nTex = vec3(nSample.xy * 2.0 - 1.0, 0.0);
    float ns = clamp(normalStrength, 0.0, 4.0);
    nTex.xy *= ns;
    nTex.xy *= mix(0.35, 1.0, smoothstep(0.0, 0.25, N.z));
    nTex.z = sqrt(max(0.0, 1.0 - dot(nTex.xy, nTex.xy)));
    vec3 Nlit = normalize(T * nTex.x + Bt * nTex.y + N * nTex.z);

    // 6. Lommel-Seeliger / Lambert blend.
    vec3 L = sunDirection;
    float ll = length(L);
    L = (ll > 1e-6) ? L / ll : vec3(0.0, 0.0, 1.0);
    vec3 V = vec3(0.0, 0.0, 1.0);

    float mu0 = max(dot(Nlit, L), 0.0);
    float mu  = max(dot(N, V), 0.0);

    float ls      = mu0 / max(mu0 + mu, 1e-4);
    float lambert = mu0;
    float diffuse = mix(ls * 1.6, lambert, 0.35);

    diffuse *= smoothstep(-0.02, 0.06, mu0);

    // 7. Earthshine + faint ambient on the unlit side.
    float night = 1.0 - smoothstep(-0.03, 0.10, mu0);
    float earth = clamp(earthshine, 0.0, 1.0) * night * (0.55 + 0.45 * mu);

    vec3 color = albedo * (diffuse + 0.004 + earth);

    // 8. Tone map (linear) and sRGB encode.
    color *= 1.15;
    color = color / (vec3(1.0) + color * 0.35);
    color = clamp(color, 0.0, 1.0);
    color = pow(color, vec3(1.0 / 2.2));

    color *= vec3(1.0, 0.994, 0.985);

    // 9. Premultiplied alpha output.
    fragColor = vec4(color * alpha, alpha) * qt_Opacity;
}

#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec3 sunVectorWorld;
    float observerLatRad;
    float observerLonRad;
    float nightLightsBoost;
    float atmosphereIntensity;
    float showObserverPin;
} ubuf;

layout(binding = 1) uniform sampler2D daySource;
layout(binding = 2) uniform sampler2D normalSource;

const float PI = 3.14159265358979323846;

void main() {
    vec2 p = qt_TexCoord0 * 2.0 - 1.0;
    p.y = -p.y;

    float r2 = dot(p, p);
    float r = sqrt(r2);

    // Exact same limb anti-aliasing and halo-free silhouette as moon.frag
    float edgeAlpha = 1.0 - smoothstep(0.993, 1.0, r);
    if (edgeAlpha <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    float z = sqrt(max(0.0, 1.0 - r2));
    vec3 Nv = normalize(vec3(p.x, p.y, z));

    // Observer-centred orthographic camera basis (Z = North, X = 0°E, Y = 90°E)
    float cosLat = cos(ubuf.observerLatRad);
    float sinLat = sin(ubuf.observerLatRad);
    float cosLon = cos(ubuf.observerLonRad);
    float sinLon = sin(ubuf.observerLonRad);

    vec3 F = vec3(cosLat * cosLon, cosLat * sinLon, sinLat);
    vec3 R = vec3(-sinLon, cosLon, 0.0);
    vec3 U = vec3(-sinLat * cosLon, -sinLat * sinLon, cosLat);

    vec3 Nw = normalize(Nv.x * R + Nv.y * U + Nv.z * F);

    float lat = asin(clamp(Nw.z, -1.0, 1.0));
    float lon = atan(Nw.y, Nw.x);
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);

    vec4 daySample = texture(daySource, uv);
    // normalSource packs tangent-space normal (R=nx, G=ny) + Black Marble city luminance (B)
    vec3 normalSample = texture(normalSource, uv).rgb;

    vec2 tNormal = normalSample.xy * 2.0 - 1.0;
    vec3 T = vec3(-sin(lon), cos(lon), 0.0);
    vec3 B = cross(Nw, T);
    vec3 N = normalize(Nw + 1.35 * (tNormal.x * T + tNormal.y * B));

    // Continuous bathymetry / hypsometry encoded in daySample.a:
    //   Ocean pixels: alpha in [0.58 .. 1.00] -> depthNorm in [0 .. 1]
    //   Land pixels:  alpha in [0.20 .. 0.48] -> elevNorm  in [1 .. 0]
    float rawAlpha = daySample.a;
    float landMask = smoothstep(0.54, 0.50, rawAlpha);
    float oceanDepth = clamp((rawAlpha - 0.58) / 0.42, 0.0, 1.0);
    float landElev = clamp((0.48 - rawAlpha) / 0.28, 0.0, 1.0);

    vec3 rawLinear = pow(max(daySample.rgb, vec3(0.0)), vec3(2.2));
    float rawLuma = dot(rawLinear, vec3(0.2126, 0.7152, 0.0722));
    float luma = rawLuma / (1.0 + 0.85 * rawLuma);

    // Muted, lunar-matched palette with physical depth & elevation modulation
    vec3 mutedTint = mix(rawLinear, vec3(luma), 0.72);
    vec3 landLow = vec3(0.085, 0.095, 0.115) + mutedTint * 0.42 + vec3(0.025, 0.020, 0.014) * luma;
    vec3 landHigh = vec3(0.22, 0.23, 0.26) + mutedTint * 0.45;
    vec3 landAlbedo = mix(landLow, landHigh, smoothstep(0.0, 0.85, landElev));

    vec3 oceanShelf = vec3(0.072, 0.098, 0.142);
    vec3 oceanAbyss = vec3(0.024, 0.036, 0.062);
    vec3 oceanAlbedo = mix(oceanShelf, oceanAbyss, smoothstep(0.0, 0.85, oceanDepth)) + mutedTint * 0.08;

    vec3 baseAlbedo = mix(oceanAlbedo, landAlbedo, landMask);

    // Polar snow/ice caps blended into matte lunar silver
    float iceFactor = smoothstep(0.26, 0.52, rawLuma) * smoothstep(0.55, 0.80, abs(Nw.z));
    baseAlbedo = mix(baseAlbedo, vec3(0.32, 0.34, 0.38), iceFactor * 0.55);

    // astronomy.js outputs sunVectorWorld in Y-up (X=90°E, Y=North, Z=0°E).
    // Convert to our Z-up world frame (X=0°E, Y=90°E, Z=North):
    vec3 Lw = (length(ubuf.sunVectorWorld) > 0.0001)
              ? normalize(vec3(ubuf.sunVectorWorld.z, ubuf.sunVectorWorld.x, ubuf.sunVectorWorld.y))
              : vec3(1.0, 0.0, 0.0);

    // Macro sphere N·L for the global terminator, plus normal-mapped N·L for relief
    float ndotlMacro = dot(Nw, Lw);
    float ndotlRelief = dot(N, Lw);
    float mu0 = max(ndotlRelief, 0.0);
    float mu = max(Nv.z, 0.001);

    float terminator = smoothstep(-0.08, 0.06, ndotlMacro) * smoothstep(-0.04, 0.10, ndotlRelief);
    float ls = (mu0 / (mu0 + mu + 0.001)) * 2.0;
    float limbDamp = smoothstep(0.0, 0.30, mu);
    float diffuse = mix(mu0, ls, 0.52 * limbDamp) * terminator;

    vec3 sunTint = vec3(1.0, 0.985, 0.955);
    vec3 lit = baseAlbedo * diffuse * sunTint * 1.38;

    // Subtle twilight band along the macro terminator (scaled by atmosphereIntensity)
    float twilight = exp(-pow(ndotlMacro / 0.09, 2.0)) * smoothstep(-0.14, 0.04, ndotlMacro);
    lit += vec3(0.16, 0.13, 0.10) * twilight * 0.16 * clamp(ubuf.atmosphereIntensity, 0.0, 1.5);

    // Night side: faint earthshine + warm amber-ivory city lights decoded from normalSample.b
    float nightMask = 1.0 - smoothstep(-0.06, 0.08, ndotlMacro);
    vec3 nightFloor = baseAlbedo * 0.055 * vec3(0.76, 0.84, 1.0) * (0.45 + 0.55 * Nv.z);

    float cityLuma = pow(max(normalSample.b, 0.0), 1.85);
    vec3 cityColor = vec3(0.95, 0.85, 0.64) * cityLuma * max(ubuf.nightLightsBoost, 0.0) * 0.25;
    vec3 unlit = (nightFloor + cityColor * landMask) * nightMask;

    vec3 color = lit + unlit;

    // Fine matte hairline rim (no white Fresnel glow)
    float rim = smoothstep(0.965, 0.993, r) * (1.0 - smoothstep(0.993, 1.0, r));
    color += vec3(0.75, 0.80, 0.88) * rim * (0.06 + 0.12 * smoothstep(-0.1, 0.4, ndotlMacro));

    // Precision observer reticle at center (r = 0) when enabled
    if (ubuf.showObserverPin > 0.5) {
        float retRing = exp(-pow((r - 0.042) / 0.007, 2.0));
        float retDot = 1.0 - smoothstep(0.008, 0.015, r);
        vec3 retCol = vec3(0.95, 0.88, 0.72);
        color = mix(color, retCol, clamp(retRing * 0.55 + retDot * 0.85, 0.0, 1.0));
    }

    color = color / (1.0 + 0.35 * color);
    vec3 srgb = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    float alpha = edgeAlpha * ubuf.qt_Opacity;
    fragColor = vec4(srgb * alpha, alpha);
}

#version 440

// ============================================================================
//  KDE Plasma 6 wallpaper - Earth orbit / elapsed-year shader
// ============================================================================
//
//  A compact schematic of Earth's orbit around the Sun, designed to stay
//  readable inside a ~230 x 230 px overlay on a dark wallpaper.
//
//  Coordinate conventions:
//
//    * qt_TexCoord0 has (0,0) at the top-left and y pointing down.
//      p = (qt_TexCoord0 - 0.5) * 2 is the centred unit square.
//      q = (p.x, -p.y) is the same point with y pointing up (math space).
//
//    * The orbit is drawn as a perspective ellipse:
//          c(theta) = ( Rx * cos(theta), Ry * sin(theta) )   [in q]
//          Rx = 0.72,  Ry = Rx * cos(orbitTiltRad)
//      so in texture space the y component is negated (hence "-Ry * sin").
//      theta = 0     -> right
//      theta = PI/2  -> top / back
//      theta = PI    -> left
//      theta = 3PI/2 -> bottom / front
//
//    * Angles are measured counter-clockwise from +x. All angles coming in
//      through the UBO are expected in [0, 2PI); mod() normalises them.
//
//    * Depth: the top half of the ring is the far half and is drawn slightly
//      dimmer. The active Earth is scaled by 1 - 0.12*sin(theta) so the
//      front (bottom) half is a little larger.
//
//    * Shading: everything is composited in premultiplied-alpha space. The
//      scene is fully transparent outside the ring / bodies, so the
//      wallpaper shows through.
//
//  No textures are sampled. All edges are anti-aliased analytically; there
//  is no fwidth() (the shader targets the GLSL 100 ES fallback as well).
//
//  Build:
//    qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 \
//        -o contents/shaders/orbit.frag.qsb contents/shaders/orbit.frag
// ============================================================================

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float earthHelioLonRad;   // current Earth heliocentric longitude [0..2PI)
    float jan1HelioLonRad;    // Jan 1 marker angle [0..2PI)
    float yearProgress;       // [0..1]
    float orbitTiltRad;       // view pitch, default 0.95 rad (~55 deg)
    float axialTiltRad;       // Earth obliquity, default 0.4091 rad
    float showGhostEarths;    // 1.0 = show 4 seasonal ghost Earths
};

const float PI      = 3.14159265358979323846;
const float TAU     = 6.28318530717958647692;
const float RX      = 0.72;
const float AA      = 0.0018;   // fine lines / ticks
const float EDGE_AA = 0.0034;   // silhouettes (~0.8 px at 230 px)
const float RING_W  = 0.0062;

const vec3 RING_COLOR = vec3(0.627, 0.765, 1.0);   // rgb(160,195,255)
const vec3 GOLD       = vec3(1.0, 0.82, 0.40);
const vec3 CYAN       = vec3(0.30, 0.86, 1.0);

// ---------------------------------------------------------------------------
//  Premultiplied source-over and additive compositing.
// ---------------------------------------------------------------------------
void over(inout vec3 col, inout float alpha, vec3 src, float sa)
{
    sa = clamp(sa, 0.0, 1.0);
    col   = src * sa + col * (1.0 - sa);
    alpha = sa + alpha * (1.0 - sa);
}

void glow(inout vec3 col, inout float alpha, vec3 src, float sa)
{
    sa = clamp(sa, 0.0, 1.0);
    col   += src * sa;
    alpha  = clamp(alpha + sa * (1.0 - alpha), 0.0, 1.0);
}

// ---------------------------------------------------------------------------
//  Radial tick on the ellipse, returned as an anti-aliased coverage value.
//  inLen / outLen are measured inward/outward from the ring radius.
// ---------------------------------------------------------------------------
float tickMask(vec2 q, float ang, float rx, float ry,
               float inLen, float outLen, float hw)
{
    vec2  cp = vec2(rx * cos(ang), ry * sin(ang));
    float R  = length(cp);
    vec2  d  = cp / max(R, 1e-5);
    float t  = dot(q, d);                       // along the radial
    float s  = dot(q, vec2(-d.y, d.x));         // across it

    float along = smoothstep(R - inLen - AA, R - inLen + AA, t)
                * (1.0 - smoothstep(R + outLen - AA, R + outLen + AA, t));
    float across = 1.0 - smoothstep(hw - AA, hw + AA, abs(s));
    return along * across;
}

// ---------------------------------------------------------------------------
//  A small procedural Earth: ocean, muted land, deserts and polar caps.
//  B is the body-fixed direction (unit length), north = +y.
// ---------------------------------------------------------------------------
vec3 earthSurface(vec3 B)
{
    float lat = asin(clamp(B.y, -1.0, 1.0));
    float lon = atan(B.x, B.z);

    float n = sin(lon * 2.0 + lat * 3.2)
            + 0.55 * sin(lon * 4.7 - lat * 2.1 + 1.3)
            + 0.30 * sin(lon * 8.3 + lat * 5.5 + 0.7);
    float land = smoothstep(0.16, 0.42, n);

    vec3 surf = mix(vec3(0.035, 0.130, 0.320),       // ocean
                    vec3(0.240, 0.310, 0.160),       // land
                    land);

    float desert = smoothstep(0.20, 0.60, sin(lat * 2.3 + 0.5)) * land;
    surf = mix(surf, vec3(0.420, 0.360, 0.220), desert * 0.55);

    float ice = smoothstep(1.05, 1.28, abs(lat));
    surf = mix(surf, vec3(0.820, 0.880, 0.940), ice * 0.90);
    return surf;
}

void main()
{
    vec2  p = (qt_TexCoord0 - vec2(0.5)) * 2.0;
    vec2  q = vec2(p.x, -p.y);
    float r = length(q);

    float rx = RX;
    float ry = RX * cos(orbitTiltRad);

    vec3  col   = vec3(0.0);
    float alpha = 0.0;

    // -----------------------------------------------------------------------
    //  1. Elliptical orbit coordinate system.
    // -----------------------------------------------------------------------
    vec2  e     = vec2(q.x / rx, q.y / ry);
    float rho   = length(e);
    float theta = (rho > 1e-5) ? atan(e.y, e.x) : 0.0;
    theta = (theta < 0.0) ? theta + TAU : theta;

    // First-order Euclidean distance to the ellipse. This keeps the line
    // thickness independent of the (foreshortened) vertical axis.
    vec2  grad = vec2(q.x / (rx * rx), q.y / (ry * ry));
    float dist = abs(rho - 1.0) / max(length(grad), 1e-4);

    // -----------------------------------------------------------------------
    //  2. Corona, drawn first so the orbit line stays crisp over it.
    // -----------------------------------------------------------------------
    float edgeFade = 1.0 - smoothstep(0.86, 1.0, r);
    float corona = exp(-r * 7.0) * edgeFade;
    glow(col, alpha, vec3(1.0, 0.72, 0.35), 0.30 * corona);
    glow(col, alpha, vec3(1.0, 0.86, 0.58),
         0.18 * exp(-max(r - 0.13, 0.0) * 16.0) * edgeFade);

    // -----------------------------------------------------------------------
    //  3. Base orbital track. The far half is dimmer, the near half slightly
    //     brighter (depth cue). The line is ~1.3 px wide at 230 px.
    // -----------------------------------------------------------------------
    float back  = 0.5 + 0.5 * sin(theta);              // 1 = far/top
    float depth = mix(1.0, 0.62, back);
    float ring  = 1.0 - smoothstep(RING_W - AA, RING_W + AA, dist);
    over(col, alpha, RING_COLOR, ring * 0.20 * depth);

    // -----------------------------------------------------------------------
    //  4. Elapsed-year arc from Jan 1 to the current Earth longitude.
    //     Cyan away from Earth, warming to gold near the active Earth.
    // -----------------------------------------------------------------------
    float prog    = clamp(yearProgress, 0.0, 1.0);
    float delta   = mod(theta - jan1HelioLonRad, TAU);
    float arcEnd  = prog * TAU;
    float inArc   = 1.0 - smoothstep(arcEnd - 0.012, arcEnd + 0.012, delta);
    float dEarth  = abs(mod(theta - earthHelioLonRad + PI, TAU) - PI);
    float heat    = exp(-dEarth * dEarth * 3.2);       // 1 at Earth, 0 far away

    vec3  arcCol  = mix(CYAN, GOLD, clamp(0.15 + 0.85 * heat, 0.0, 1.0));
    float arcCore = (1.0 - smoothstep(0.0050, 0.0105, dist)) * inArc;
    float arcHalo = (1.0 - smoothstep(0.0110, 0.0330, dist)) * inArc;

    over(col, alpha, arcCol, arcCore * (0.55 + 0.35 * heat));
    glow(col, alpha, arcCol, arcHalo * (0.05 + 0.10 * heat));

    // -----------------------------------------------------------------------
    //  5. Cardinal ticks at 0, PI/2, PI, 3PI/2 (subtle).
    // -----------------------------------------------------------------------
    float card = tickMask(q, 0.0,        rx, ry, 0.030, 0.030, 0.0038)
               + tickMask(q, PI,         rx, ry, 0.030, 0.030, 0.0038)
               + tickMask(q, 0.5 * PI,   rx, ry, 0.030, 0.030, 0.0038)
               + tickMask(q, 1.5 * PI,   rx, ry, 0.030, 0.030, 0.0038);
    over(col, alpha, RING_COLOR, min(card, 1.0) * 0.22);

    // -----------------------------------------------------------------------
    //  6. Jan 1 marker: radial tick plus a glowing node.
    // -----------------------------------------------------------------------
    float janTick = tickMask(q, jan1HelioLonRad, rx, ry, 0.060, 0.050, 0.0045);
    over(col, alpha, vec3(1.0, 0.93, 0.72), janTick * 0.90);

    vec2  janPos = vec2(rx * cos(jan1HelioLonRad),
                        ry * sin(jan1HelioLonRad));
    vec2  jd     = q - janPos;
    float jdist  = length(jd);
    float jnode  = 1.0 - smoothstep(0.016, 0.022, jdist);
    float jglow  = exp(-dot(jd, jd) * 900.0);

    glow(col, alpha, GOLD, jglow * 0.28);
    over(col, alpha, vec3(1.0, 0.95, 0.78), jnode);

    // -----------------------------------------------------------------------
    //  7. Seasonal ghost Earths at the four cardinal points.
    // -----------------------------------------------------------------------
    if (showGhostEarths > 0.5) {
        for (int i = 0; i < 4; ++i) {
            float ang  = float(i) * 0.5 * PI;
            float sinA = sin(ang);
            vec2  gc   = vec2(rx * cos(ang), ry * sinA);
            vec2  gd   = q - gc;
            float gr   = 0.055;
            float glen = length(gd);
            float gback  = 0.5 + 0.5 * sinA;            // far ghosts dimmer
            float gdim   = mix(1.0, 0.62, gback);

            if (glen < gr + EDGE_AA) {
                float gz  = sqrt(max(0.0, 1.0 - (glen * glen) / (gr * gr)));
                vec3  gN  = vec3(gd / gr, gz);

                vec3  gp  = vec3(gc, -rx * sinA * sin(orbitTiltRad) * 0.60);
                vec3  gL  = normalize(-gp);
                float gmu = dot(gN, gL);
                float gday = smoothstep(-0.12, 0.20, gmu);

                vec3 gcol = mix(vec3(0.055, 0.100, 0.190),
                                vec3(0.330, 0.550, 0.710),
                                0.35 + 0.65 * gday);
                gcol += vec3(0.100, 0.220, 0.400)
                      * pow(1.0 - gz, 2.0) * 0.50;      // limb airglow
                float gmask = 1.0 - smoothstep(gr - EDGE_AA, gr + EDGE_AA, glen);
                over(col, alpha, gcol, gmask * 0.35 * gdim);
            }

            // Tiny axis line.
            vec2  ga   = vec2(sin(axialTiltRad), cos(axialTiltRad));
            float gt   = dot(gd, ga);
            float gperp = abs(dot(gd, vec2(-ga.y, ga.x)));
            float gline = 1.0 - smoothstep(0.0016, 0.0038, gperp);
            float gseg  = smoothstep(-gr * 1.25 - AA, -gr * 1.25 + AA, gt)
                        * (1.0 - smoothstep(gr * 1.25 - AA, gr * 1.25 + AA, gt));
            over(col, alpha, vec3(0.70, 0.80, 0.92),
                 gline * gseg * 0.45 * gdim);
        }
    }

    // -----------------------------------------------------------------------
    //  8. The Sun: warm limb-darkened sphere.
    // -----------------------------------------------------------------------
    float sr = 0.13;
    float st = clamp(r / sr, 0.0, 1.0);
    vec3  sunCol = mix(vec3(1.0, 0.969, 0.839),
                       vec3(1.0, 0.616, 0.180),
                       pow(st, 1.35));
    sunCol += vec3(0.18, 0.14, 0.06) * pow(1.0 - st, 2.0);
    float sunMask = 1.0 - smoothstep(sr - EDGE_AA, sr + EDGE_AA, r);
    over(col, alpha, sunCol, sunMask);

    // -----------------------------------------------------------------------
    //  9. Active Earth.
    // -----------------------------------------------------------------------
    float sinE = sin(earthHelioLonRad);
    float er   = 0.095 * (1.0 - 0.12 * sinE);
    vec2  ec   = vec2(rx * cos(earthHelioLonRad), ry * sinE);
    vec2  ed   = q - ec;
    float elen = length(ed);

    if (elen < er + EDGE_AA) {
        float ez  = sqrt(max(0.0, 1.0 - (elen * elen) / (er * er)));
        vec3  N   = vec3(ed / er, ez);

        // 3D position on the tilted orbit, then light from the Sun at origin.
        // A reduced depth term keeps the bottom/front Earth from going fully
        // black while still producing a physical terminator.
        vec3  P   = vec3(ec, -rx * sinE * sin(orbitTiltRad) * 0.60);
        vec3  L   = normalize(-P);
        float mu  = dot(N, L);
        float day = smoothstep(-0.12, 0.24, mu);

        // Body frame: north = axial-tilt direction, east perpendicular to it.
        vec3  axisDir = vec3(sin(axialTiltRad), cos(axialTiltRad), 0.0);
        vec3  eastDir = vec3(axisDir.y, -axisDir.x, 0.0);
        vec3  B = vec3(dot(N, eastDir), dot(N, axisDir), N.z);

        // Spin the surface so the continents are not centred on the limb.
        float spin = 1.35;
        float cs = cos(spin), sn = sin(spin);
        B = vec3(cs * B.x - sn * B.z, B.y, sn * B.x + cs * B.z);

        vec3 surf = earthSurface(B);
        // The mini-Earth is a schematic, not a photometric render: keep a
        // generous night-side fill so it stays readable at 230 px.
        vec3 lit  = surf * (0.34 + 0.75 * day);
        lit += vec3(0.035, 0.055, 0.095) * (1.0 - day);         // night side
        lit += vec3(0.45, 0.22, 0.06) * exp(-mu * mu * 22.0) * 0.10;

        // Thin atmosphere at the limb.
        float fres = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.2);
        lit += vec3(0.18, 0.42, 0.75) * fres * (0.30 + 0.55 * day);

        float emask = 1.0 - smoothstep(er - EDGE_AA, er + EDGE_AA, elen);
        over(col, alpha, clamp(lit, 0.0, 1.0), emask);

        // Axis line, protruding slightly at both poles.
        vec2  ax   = vec2(sin(axialTiltRad), cos(axialTiltRad));
        float at   = dot(ed, ax);
        float aperp = abs(dot(ed, vec2(-ax.y, ax.x)));
        float aline = 1.0 - smoothstep(0.0014, 0.0034, aperp);
        float aseg  = smoothstep(-er * 1.35 - AA, -er * 1.35 + AA, at)
                    * (1.0 - smoothstep(er * 1.35 - AA, er * 1.35 + AA, at));
        float amask = aline * aseg;
        over(col, alpha, vec3(0.78, 0.86, 0.96),
             amask * (1.0 - emask * 0.65) * 0.70);

        // Faint equator: great circle perpendicular to the axis.
        float eqDist = abs(dot(ed, ax));
        float eqMask = (1.0 - smoothstep(0.0010, 0.0026, eqDist)) * emask;
        over(col, alpha, vec3(0.62, 0.78, 0.92), eqMask * 0.20);
    }

    // -----------------------------------------------------------------------
    // 10. Premultiplied output.
    // -----------------------------------------------------------------------
    fragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0)) * qt_Opacity;
}

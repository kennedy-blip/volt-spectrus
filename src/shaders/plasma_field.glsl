#version 300 es
/*
 * =============================================================================
 *  VOLT-SPECTRA — plasma_field.glsl   (WebGL2 / GLSL ES 3.00)
 *  Electromagnetic flux-line & plasma sine-wave canvas.
 *
 *  The field is a superposition of a travelling AC sine front and a domain-warped
 *  fbm plasma.  Live telemetry modulates it:
 *    u_thd   0..1  total harmonic distortion  -> waveform turbulence / arcing
 *    u_flux  0..1  magnetic flux density (uT) -> flux-line density & jitter
 *    u_freq  0..1  normalized fundamental     -> spatial wavelength
 *    u_theme 0..3  obsidian / daylight / amber / eco palette
 *    u_lowGpu 0/1  drops fbm octaves for the battery-saver Eco-Glass mode
 * =============================================================================
 */

precision highp float;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_thd;     /* 0..1  (thdPercent / 40) */
uniform float u_flux;    /* 0..1  (microtesla / 100) */
uniform float u_freq;    /* 0..1  (50..65 Hz mapped) */
uniform float u_energy;  /* 0..1  overall brightness */
uniform int   u_theme;   /* 0 obsidian, 1 daylight, 2 amber, 3 eco */
uniform int   u_lowGpu;  /* 1 = reduced octaves */

out vec4 outColor;

/* ------------------------------------------------------------- noise kit */

float hash21(vec2 p)
{
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
}

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

float fbm(vec2 p)
{
    float v = 0.0;
    float a = 0.5;
    int octaves = (u_lowGpu == 1) ? 3 : 6;
    for (int i = 0; i < 6; i++)
    {
        if (i >= octaves) break;
        v += a * vnoise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return v;
}

/* ------------------------------------------------------------- palettes */

vec3 palette(float t, int theme)
{
    vec3 c1;   /* deep base  */
    vec3 c2;   /* primary    */
    vec3 c3;   /* secondary  */
    vec3 c4;   /* hot accent */

    if (theme == 1)        /* Utility Daylight Frost */
    {
        c1 = vec3(0.86, 0.90, 0.95);
        c2 = vec3(0.10, 0.22, 0.42);
        c3 = vec3(0.16, 0.45, 0.72);
        c4 = vec3(0.95, 0.65, 0.20);
    }
    else if (theme == 2)   /* Substation Amber-Red */
    {
        c1 = vec3(0.09, 0.04, 0.03);
        c2 = vec3(0.95, 0.55, 0.15);
        c3 = vec3(0.85, 0.20, 0.25);
        c4 = vec3(1.00, 0.80, 0.35);
    }
    else if (theme == 3)   /* Eco-Glass matte */
    {
        c1 = vec3(0.06, 0.10, 0.09);
        c2 = vec3(0.20, 0.75, 0.62);
        c3 = vec3(0.10, 0.45, 0.55);
        c4 = vec3(0.85, 0.95, 0.55);
    }
    else                   /* High-Voltage Obsidian */
    {
        c1 = vec3(0.020, 0.027, 0.055);
        c2 = vec3(0.023, 0.714, 0.831);   /* #06B6D4 */
        c3 = vec3(0.231, 0.510, 0.965);   /* #3B82F6 */
        c4 = vec3(0.063, 0.725, 0.506);   /* #10B981 */
    }

    vec3 col = mix(c1, c2, smoothstep(0.15, 0.75, t));
    col = mix(col, c3, smoothstep(0.45, 0.95, t));
    col = mix(col, c4, smoothstep(0.80, 1.00, t) * 0.85);
    return col;
}

/* ------------------------------------------------------------------ main */

void main()
{
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    float t = u_time * 0.32;
    float thd = clamp(u_thd, 0.0, 1.0);
    float flux = clamp(u_flux, 0.0, 1.0);
    float freq = mix(6.0, 14.0, u_freq);      /* spatial wavelength of the AC front */

    /* domain warp grows with THD (dirty power) and flux (EMF) */
    vec2 warp = vec2(
        fbm(uv * 2.4 + vec2(0.0, t * 0.6)),
        fbm(uv * 2.4 + vec2(5.2, -t * 0.5))
    ) - 0.5;
    vec2 p = uv + warp * (0.22 + 0.85 * thd + 0.45 * flux);

    /* travelling AC sine front, phase modulated by the plasma */
    float phase = dot(p, vec2(0.0, freq)) - t * (1.4 + 2.2 * thd);
    float sine = 0.5 + 0.5 * sin(phase + 1.6 * fbm(p * 3.0 + t));

    /* electromagnetic flux lines: sharp ridges around the sine isolines */
    float ridge = abs(fract(sine * 3.0) - 0.5) * 2.0;
    float lines = pow(1.0 - ridge, mix(6.0, 26.0, flux));

    /* plasma body */
    float plasma = fbm(p * mix(1.6, 4.2, thd) + vec2(t * 0.35, -t * 0.22));
    float field = mix(sine, plasma, 0.45) * 0.75 + lines * 0.55;

    /* arc-flash flicker when THD is high */
    float arc = 0.0;
    if (thd > 0.35)
    {
        float n = hash21(floor(p * 14.0) + floor(t * 8.0));
        arc = smoothstep(0.93, 1.0, n) * (thd - 0.35) * 2.4;
    }

    vec3 col = palette(field, u_theme);

    /* theme-aware state tint: amber/violet for TOU peak + vampire, crimson for dirty */
    vec3 warn = (u_theme == 2) ? vec3(1.0, 0.45, 0.15) : vec3(0.96, 0.62, 0.04);
    vec3 danger = vec3(0.94, 0.27, 0.27);
    col = mix(col, warn, flux * 0.35);
    col = mix(col, danger, arc * 0.8 + smoothstep(0.55, 1.0, thd) * 0.25);

    /* vignette + specular sweep tied to flux */
    float vig = smoothstep(1.25, 0.25, length(uv));
    col *= mix(0.55, 1.15, vig);
    col += vec3(0.06, 0.10, 0.16) * lines * flux;

    col *= mix(0.65, 1.12, u_energy);

    /* dither to kill banding on the frosted glass */
    col += (hash21(gl_FragCoord.xy + t) - 0.5) / 255.0;

    outColor = vec4(col, 1.0);
}

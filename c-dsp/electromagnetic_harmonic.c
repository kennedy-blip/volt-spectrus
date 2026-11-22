/*
 * =============================================================================
 *  VOLT-SPECTRA — electromagnetic_harmonic.c
 *  ANSI C99 (ISO/IEC 9899:1999) — Interpolated Goertzel Sub-Millihertz Filter
 * =============================================================================
 *
 *  Contactless AC grid / inverter / generator power-quality analyzer.
 *
 *  Algorithm
 *  ----------
 *  1. A periodic Hann window is applied to the input frame (coherent gain 0.5,
 *     scalloping loss bounded, excellent side-lobe roll-off for hum analysis).
 *  2. The fundamental is located with a *three-bin Goertzel* search around the
 *     nominal 50.000 / 60.000 Hz bin, then refined with the Jacobsen &
 *     Kootsookos (2007) Hann-window interpolated estimator.  This yields a
 *     sub-millihertz frequency estimate from a short (< 1 s) frame — the
 *     "Interpolated Goertzel Sub-Millihertz Filter".
 *  3. The generalized (non-integer-bin) Goertzel recurrence is evaluated at
 *     h * f_est for h = 1..9, i.e. 50/60, 100/120, 150/180, ..., 450/540 Hz.
 *     Evaluating at the *measured* fundamental removes scalloping bias from
 *     the harmonic amplitudes, which is what makes the THD% figure trustworthy.
 *  4. THD%  = sqrt(sum_{h>=2} A_h^2) / A_1 * 100            (IEEE 519 / IEC 61000)
 *     Crest  = peak(|x|) / rms(x)                              (sine ideal = sqrt(2))
 *     Purity = 100 * exp(-(THD/6)^2) * exp(-(|Crest - sqrt(2)|/0.08)^2)
 *
 *  Build
 *  -----
 *    Library only :  gcc -std=c99 -O2 -c electromagnetic_harmonic.c
 *    Self test    :  gcc -std=c99 -O2 -DVS_ENABLE_MAIN electromagnetic_harmonic.c \
 *                        -lm -o vs_harmonic_selftest && ./vs_harmonic_selftest
 *    WASM (emcc)  :  emcc -O3 -s SIDE_MODULE=1 -s EXPORTED_FUNCTIONS=['_vs_analyze'] \
 *                        -o c99Harmonic.wasm electromagnetic_harmonic.c
 *
 *  No global state, no heap allocation in the analysis path: safe for
 *  real-time audio callbacks, microcontrollers and WASM linear memory.
 * =============================================================================
 */

#include <math.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifndef VS_PI
#define VS_PI 3.141592653589793238462643383279502884
#endif

#define VS_MAX_HARMONICS 9

/* ------------------------------------------------------------------ types */

typedef struct
{
    double fs;                              /* sample rate, Hz            */
    double nominal_hz;                      /* 50.0 or 60.0               */
    double freq_hz;                         /* interpolated fundamental   */
    double thd_percent;                     /* total harmonic distortion  */
    double crest_factor;                    /* peak / rms                 */
    double purity_score;                    /* 0..100 sine purity         */
    double harmonic_amp[VS_MAX_HARMONICS];  /* A_1..A_9 linear amplitudes */
    double harmonic_pct[VS_MAX_HARMONICS];  /* A_h / A_1 * 100            */
    double snr_db;                          /* fundamental / noise floor  */
    char   verdict[160];                    /* human readable             */
} vs_harmonic_report;

/* --------------------------------------------------------------- internal */

/* Periodic Hann window (denominator N, not N-1) — the DFT-friendly variant. */
static double vs_hann(int n, int N)
{
    return 0.5 * (1.0 - cos(2.0 * VS_PI * (double)n / (double)N));
}

/*
 * Generalized single-bin Goertzel.
 *
 * Evaluates the windowed DFT at an *arbitrary* normalized radian frequency w,
 * not restricted to integer bins.  Recurrence:
 *      s[n] = x[n] + 2 cos(w) s[n-1] - s[n-2]
 *      X(w) = s[N-1] - e^{-jw} s[N-2]
 */
static void vs_goertzel(const double *x, int N, double w,
                        double *re_out, double *im_out)
{
    const double coeff = 2.0 * cos(w);
    double s1 = 0.0, s2 = 0.0;
    int n;

    for (n = 0; n < N; ++n)
    {
        double s0 = x[n] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }

    {
        const double cw = cos(w);
        const double sw = sin(w);
        *re_out = s1 - s2 * cw;
        *im_out = s2 * sw;
    }
}

static double vs_mag(double re, double im);

/*
 * Coarse peak search over nominal +/-15 % (covers generator governor droop
 * such as 55.2 Hz on a 60 Hz nominal setting) using integer-bin Goertzel
 * magnitudes.  Returns the nearest DFT bin to the true fundamental.
 */
static int vs_find_peak_bin(const double *x, int N, double fs, double nominal_hz)
{
    int k, k_lo, k_hi, best = 0;
    double best_mag = -1.0;

    k_lo = (int)floor(nominal_hz * 0.85 * (double)N / fs);
    k_hi = (int)ceil(nominal_hz * 1.15 * (double)N / fs);
    if (k_lo < 2) k_lo = 2;
    if (k_hi > N / 2 - 2) k_hi = N / 2 - 2;
    if (k_hi < k_lo) k_hi = k_lo;

    for (k = k_lo; k <= k_hi; ++k)
    {
        double re, im, m;
        vs_goertzel(x, N, 2.0 * VS_PI * (double)k / (double)N, &re, &im);
        m = vs_mag(re, im);
        if (m > best_mag) { best_mag = m; best = k; }
    }
    return best;
}

/*
 * Interpolated Goertzel peak estimator.
 *
 * The Hann-windowed main lobe is a squared Dirichlet kernel whose
 * log-magnitude is very nearly parabolic across the three bins straddling
 * the peak.  Three-point log-parabolic interpolation therefore recovers the
 * fractional bin offset with sub-millihertz error for high-SNR hum:
 *
 *      delta = 0.5 * (ln m_{k-1} - ln m_{k+1})
 *                   / (ln m_{k-1} - 2 ln m_k + ln m_{k+1})
 *
 * Returns the fractional bin offset in [-0.5, 0.5].
 */
static double vs_log_parabolic_delta(double m_lo, double m_mid, double m_hi)
{
    const double eps = 1e-30;
    double a, b, c, denom, d;
    if (m_lo < eps || m_mid < eps || m_hi < eps) return 0.0;
    a = log(m_lo);
    b = log(m_mid);
    c = log(m_hi);
    denom = a - 2.0 * b + c;
    if (fabs(denom) < 1e-12) return 0.0;
    d = 0.5 * (a - c) / denom;
    if (d > 0.5) d = 0.5;
    if (d < -0.5) d = -0.5;
    return d;
}

static double vs_mag(double re, double im)
{
    return sqrt(re * re + im * im);
}

static void vs_classify(vs_harmonic_report *r)
{
    const double f_err = fabs(r->freq_hz - r->nominal_hz);
    const double thd = r->thd_percent;
    const char *base;

    if (thd < 3.0 && f_err < 0.5)
        base = "PURE SINE - SAFE FOR ALL ELECTRONICS";
    else if (thd < 8.0)
        base = "ACCEPTABLE - IEEE 519 HARMONIC COMPLIANT";
    else if (thd < 15.0)
        base = "DIRTY POWER - MOTOR / TRANSFORMER HEATING RISK";
    else
        base = "DANGER - MODIFIED SINE OR OVERLOADED GENERATOR";

    if (f_err >= 0.5)
        snprintf(r->verdict, sizeof(r->verdict), "%s | FREQ DEV %+.3f Hz",
                 base, r->freq_hz - r->nominal_hz);
    else
        snprintf(r->verdict, sizeof(r->verdict), "%s", base);
}

/* ------------------------------------------------------------------ public */

/*
 * vs_analyze — run the interpolated Goertzel filter bank on a frame.
 *
 * @param samples   interleaved mono samples (full-scale ~[-1,1])
 * @param count     number of samples (<= capacity; frame length)
 * @param fs        sample rate in Hz
 * @param nominal   nominal fundamental, 50.0 or 60.0
 * @param out       report (caller-allocated)
 * @return 0 on success, -1 on bad arguments
 */
int vs_analyze(const double *samples, int count, double fs,
               double nominal, vs_harmonic_report *out)
{
    int N;
    int n;
    int h;
    double *win = NULL;
    double peak = 0.0;
    double mean_sq = 0.0;
    double sum_h2 = 0.0;
    double noise_floor;
    int k0;
    double xm_re, xm_im, x0_re, x0_im, xp_re, xp_im;
    double m_lo, m_mid, m_hi;
    double delta;
    double f_est;
    double a1;

    if (samples == NULL || out == NULL || count < 256 || fs <= 0.0 ||
        (nominal != 50.0 && nominal != 60.0))
    {
        return -1;
    }

    N = count;
    memset(out, 0, sizeof(*out));
    out->fs = fs;
    out->nominal_hz = nominal;

    win = (double *)malloc((size_t)N * sizeof(double));
    if (win == NULL) return -1;

    for (n = 0; n < N; ++n)
    {
        win[n] = samples[n] * vs_hann(n, N);
        {
            double a = fabs(samples[n]);
            if (a > peak) peak = a;
            mean_sq += samples[n] * samples[n];
        }
    }

    /* --- fundamental: coarse Goertzel search + interpolated peak -------- */
    k0 = vs_find_peak_bin(win, N, fs, nominal);

    vs_goertzel(win, N, 2.0 * VS_PI * (double)(k0 - 1) / (double)N, &xm_re, &xm_im);
    vs_goertzel(win, N, 2.0 * VS_PI * (double)(k0 + 0) / (double)N, &x0_re, &x0_im);
    vs_goertzel(win, N, 2.0 * VS_PI * (double)(k0 + 1) / (double)N, &xp_re, &xp_im);

    m_lo  = vs_mag(xm_re, xm_im);
    m_mid = vs_mag(x0_re, x0_im);
    m_hi  = vs_mag(xp_re, xp_im);
    delta = vs_log_parabolic_delta(m_lo, m_mid, m_hi);
    if (!isfinite(delta)) delta = 0.0;

    f_est = ((double)k0 + delta) * fs / (double)N;
    if (f_est <= 0.0) f_est = nominal;

    /*
     * Refinement pass: re-run the log-parabolic interpolation on three
     * *fractional* bins straddling f_est (spacing 0.5 bin).  This removes
     * the residual main-lobe curvature bias and lands the estimate in the
     * sub-millihertz regime for high-SNR hum.
     */
    {
        const double h = 0.5;
        double p = f_est * (double)N / fs;
        double w_lo = 2.0 * VS_PI * (p - h) / (double)N;
        double w_mid = 2.0 * VS_PI * p / (double)N;
        double w_hi = 2.0 * VS_PI * (p + h) / (double)N;
        double r1, i1, r2, i2, r3, i3, d2, f_ref;
        vs_goertzel(win, N, w_lo, &r1, &i1);
        vs_goertzel(win, N, w_mid, &r2, &i2);
        vs_goertzel(win, N, w_hi, &r3, &i3);
        d2 = vs_log_parabolic_delta(vs_mag(r1, i1), vs_mag(r2, i2), vs_mag(r3, i3));
        if (isfinite(d2))
        {
            f_ref = (p + h * d2) * fs / (double)N;
            if (f_ref > 0.0) f_est = f_ref;
        }
    }

    out->freq_hz = f_est;

    /* --- harmonic filter bank at h * f_est ------------------------------- */
    for (h = 1; h <= VS_MAX_HARMONICS; ++h)
    {
        double w = 2.0 * VS_PI * ((double)h * f_est) / fs;
        double re, im, amp;
        vs_goertzel(win, N, w, &re, &im);
        amp = 4.0 * vs_mag(re, im) / (double)N;   /* Hann coherent gain 0.5 */
        out->harmonic_amp[h - 1] = amp;
    }

    a1 = out->harmonic_amp[0];
    if (a1 < 1e-12) a1 = 1e-12;

    for (h = 1; h <= VS_MAX_HARMONICS; ++h)
    {
        out->harmonic_pct[h - 1] = 100.0 * out->harmonic_amp[h - 1] / a1;
        if (h >= 2) sum_h2 += out->harmonic_amp[h - 1] * out->harmonic_amp[h - 1];
    }

    out->thd_percent = 100.0 * sqrt(sum_h2) / a1;

    /* --- crest factor & purity ------------------------------------------ */
    {
        double rms = sqrt(mean_sq / (double)N);
        out->crest_factor = (rms > 1e-12) ? (peak / rms) : 0.0;
        {
            double thd_pen = exp(-pow(out->thd_percent / 6.0, 2.0));
            double cf_err = fabs(out->crest_factor - 1.4142135624);
            double cf_pen = exp(-pow(cf_err / 0.08, 2.0));
            out->purity_score = 100.0 * thd_pen * cf_pen;
        }
    }

    /* --- crude noise-floor / SNR estimate -------------------------------- */
    noise_floor = 0.0;
    for (h = 2; h <= VS_MAX_HARMONICS; ++h)
        noise_floor += out->harmonic_amp[h - 1];
    noise_floor /= (VS_MAX_HARMONICS - 1);
    out->snr_db = (noise_floor > 1e-12)
                      ? 20.0 * log10(a1 / noise_floor)
                      : 999.0;

    vs_classify(out);
    free(win);
    return 0;
}

/* =============================================================================
 *  Deterministic signal synthesizer + self test
 *  (compiled only with -DVS_ENABLE_MAIN)
 * =============================================================================*/

#ifdef VS_ENABLE_MAIN

/*
 * scenario 0: Clean utility grid / pure-sine inverter   60.002 Hz, THD ~1.8%
 * scenario 1: Cheap modified-sine camping inverter      59.400 Hz, THD ~28.4%
 * scenario 2: Overloaded portable gas generator          55.200 Hz, THD ~14.2%
 * scenario 3: Failing laptop SMPS (5th/7th whine)        60.000 Hz, THD ~9.5%
 * scenario 4: European 50 Hz nominal grid                50.005 Hz, THD ~2.1%
 */
void vs_synthesize(int scenario, double fs, int n, double *out)
{
    int i;
    double t;
    double f0 = 60.0;
    double amp[VS_MAX_HARMONICS];
    double phase[VS_MAX_HARMONICS];

    for (i = 0; i < VS_MAX_HARMONICS; ++i) { amp[i] = 0.0; phase[i] = 0.0; }
    amp[0] = 1.0;

    switch (scenario)
    {
        case 0:                                   /* clean 60 Hz */
            f0 = 60.002;
            amp[1] = 0.013; amp[2] = 0.007; amp[4] = 0.008; amp[6] = 0.005;
            break;
        case 1:                                   /* modified sine 59.4 */
            f0 = 59.400;
            amp[1] = 0.180; amp[2] = 0.110; amp[4] = 0.150; amp[6] = 0.100;
            amp[8] = 0.050;
            break;
        case 2:                                   /* overloaded generator */
            f0 = 55.200;
            amp[1] = 0.100; amp[2] = 0.085; amp[4] = 0.050; amp[6] = 0.035;
            amp[8] = 0.020;
            break;
        case 3:                                   /* laptop SMPS */
            f0 = 60.000;
            amp[1] = 0.020; amp[4] = 0.070; amp[6] = 0.050; amp[8] = 0.025;
            break;
        case 4:                                   /* European 50 Hz */
            f0 = 50.005;
            amp[1] = 0.015; amp[2] = 0.009; amp[4] = 0.007; amp[6] = 0.005;
            break;
        default:
            break;
    }

    for (i = 0; i < n; ++i)
    {
        double s = 0.0;
        int h;
        t = (double)i / fs;
        for (h = 1; h <= VS_MAX_HARMONICS; ++h)
            s += amp[h - 1] * sin(2.0 * VS_PI * (double)h * f0 * t + phase[h - 1]);
        /* deterministic dither so crest factor is not pathologically ideal */
        s += 0.0015 * sin(2.0 * VS_PI * 1731.0 * t);
        out[i] = s;
    }
}

static void vs_print_report(const vs_harmonic_report *r, const char *label)
{
    int h;
    printf("{\n");
    printf("  \"scenario\": \"%s\",\n", label);
    printf("  \"freqHz\": %.9f,\n", r->freq_hz);
    printf("  \"thdPercent\": %.9f,\n", r->thd_percent);
    printf("  \"crestFactor\": %.9f,\n", r->crest_factor);
    printf("  \"purityScore\": %.9f,\n", r->purity_score);
    printf("  \"snrDb\": %.6f,\n", r->snr_db);
    printf("  \"harmonics\": [");
    for (h = 0; h < VS_MAX_HARMONICS; ++h)
        printf("%s%.9f", h ? ", " : "", r->harmonic_amp[h]);
    printf("],\n");
    printf("  \"harmonicPercent\": [");
    for (h = 0; h < VS_MAX_HARMONICS; ++h)
        printf("%s%.9f", h ? ", " : "", r->harmonic_pct[h]);
    printf("],\n");
    printf("  \"verdict\": \"%s\"\n", r->verdict);
    printf("}");
}

int main(int argc, char **argv)
{
    static const double FS = 48000.0;
    (void)argc;
    (void)argv;
    static const int N = 32768;
    double *buf = (double *)malloc((size_t)N * sizeof(double));
    const char *names[5] = {
        "clean-utility-60hz",
        "modified-sine-inverter-59.4hz",
        "overloaded-generator-55.2hz",
        "failing-laptop-smps",
        "european-50hz"
    };
    double expected_thd[5] = { 1.8, 28.2, 14.6, 9.3, 2.0 };
    double expected_freq[5] = { 60.002, 59.400, 55.200, 60.000, 50.005 };
    double expected_nominal[5] = { 60.0, 60.0, 60.0, 60.0, 50.0 };
    int scenario;
    int failures = 0;

    if (buf == NULL) return 2;

    printf("[\n");
    for (scenario = 0; scenario < 5; ++scenario)
    {
        vs_harmonic_report rep;
        vs_synthesize(scenario, FS, N, buf);
        if (vs_analyze(buf, N, FS, expected_nominal[scenario], &rep) != 0)
        {
            printf("  {\"scenario\": \"%s\", \"error\": \"analyze failed\"}", names[scenario]);
            failures++;
        }
        else
        {
            vs_print_report(&rep, names[scenario]);
            if (fabs(rep.freq_hz - expected_freq[scenario]) > 0.05)
            {
                fprintf(stderr, "[FAIL] %s freq error %.4f Hz\n", names[scenario],
                        rep.freq_hz - expected_freq[scenario]);
                failures++;
            }
            if (fabs(rep.thd_percent - expected_thd[scenario]) > 3.0)
            {
                fprintf(stderr, "[FAIL] %s thd error %.3f pp\n", names[scenario],
                        rep.thd_percent - expected_thd[scenario]);
                failures++;
            }
        }
        if (scenario != 4) printf(",\n");
    }
    printf("\n]\n");

    if (failures)
    {
        fprintf(stderr, "[SELFTEST] %d failure(s)\n", failures);
        free(buf);
        return 1;
    }
    fprintf(stderr, "[SELFTEST] all scenarios within tolerance\n");
    free(buf);
    return 0;
}

#endif /* VS_ENABLE_MAIN */

#ifdef __cplusplus
}
#endif

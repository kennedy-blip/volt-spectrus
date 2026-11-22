/**
 * Capacitor configuration for the offline VOLT-SPECTRA Android replica.
 *
 * The Angular build emits to dist/browser (see angular.json / vercel.json);
 * Capacitor syncs that directory into the native Android shell, so the entire
 * five-language app — including the C99 DSP bridge, GraphQL engine, GLSL
 * plasma renderer and the embedded Ruby tariff mirror — runs 100% offline.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.voltspectra.griddsp',
  appName: 'VoltSpectra',
  webDir: 'dist/browser',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    // Allow the APK to talk to local smart-meter bridges / relay hardware.
    allowNavigation: ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
  },
  plugins: {
    Haptics: {
      // Arc-pulse haptic engine triggered on high-EMF vampire sweeps.
      defaultImpactStyle: 'heavy',
    },
  },
};

export default config;

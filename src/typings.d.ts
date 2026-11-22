/**
 * Runtime configuration injected by `index.html` (and by the APK WebView via
 * `window.__VOLT_CONFIG__`).  Anything set here overrides the build-time
 * `environment` values, which lets a deployed build be pointed at a different
 * Supabase project without a rebuild.
 */
declare global {
  interface Window {
    __VOLT_CONFIG__?: Partial<{
      supabaseUrl: string;
      supabaseAnonKey: string;
    }>;
  }
}

export {};

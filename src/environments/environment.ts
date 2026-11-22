/**
 * Build-time environment.  `ng build` swaps this file for
 * `environment.prod.ts` via the `fileReplacements` rule in angular.json.
 *
 * Supabase credentials are *public by design* (the anon key is shipped in the
 * APK) and access is governed by the RLS policies in
 * `supabase/migrations/20261122000000_grid_telemetry.sql`.  Never put a
 * service-role key here.
 */
export const environment = {
  production: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
};

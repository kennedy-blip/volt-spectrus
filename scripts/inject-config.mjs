import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Inject Supabase credentials into the built `index.html` at deploy time.
 *
 * Vercel exposes `SUPABASE_URL` and `SUPABASE_ANON_KEY` as build env vars.
 * This script rewrites the `window.__VOLT_CONFIG__` placeholder in
 * `dist/browser/index.html` so the browser runtime picks them up via
 * `SupabaseSyncService.resolveConfig()` (runtime config wins over the empty
 * build env fallbacks). When the vars are absent (local dev, clean APK), the
 * placeholders stay empty and the app degrades to offline-first mode — no
 * hard failure.
 *
 * Usage: node scripts/inject-config.mjs   (run after `ng build`)
 */

const INDEX = 'dist/browser/index.html';
if (!existsSync(INDEX)) {
  console.log('[inject-config] dist/browser/index.html not found — skipping (nothing built yet).');
  process.exit(0);
}

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

let html = readFileSync(INDEX, 'utf8');

let changed = false;
if (url) {
  const before = `supabaseUrl: '',`;
  const after = `supabaseUrl: '${url}',`;
  if (html.includes(before)) {
    html = html.replace(before, after);
    changed = true;
  }
}
if (anonKey) {
  const before = `supabaseAnonKey: '',`;
  const after = `supabaseAnonKey: '${anonKey}',`;
  if (html.includes(before)) {
    html = html.replace(before, after);
    changed = true;
  }
}

if (changed) {
  writeFileSync(INDEX, html, 'utf8');
  console.log(`[inject-config] Injected Supabase config into ${INDEX} (url=${url ? 'set' : 'empty'}, anonKey=${anonKey ? 'set' : 'empty'}).`);
} else {
  console.log('[inject-config] No Supabase env vars set — leaving offline-first placeholders.');
}

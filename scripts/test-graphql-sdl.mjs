/**
 * Validates src/graphql/grid_telemetry.graphql with the reference `graphql`
 * implementation: parses the SDL, executes representative queries/mutations
 * against an in-memory root, and reports errors.
 *
 *   node scripts/test-graphql-sdl.mjs
 */
import { buildSchema, graphql } from 'graphql';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdlPath = join(root, 'src/graphql/grid_telemetry.graphql');

if (!existsSync(sdlPath)) {
  console.error(`[graphql-test] missing ${sdlPath}`);
  process.exit(1);
}

const sdl = readFileSync(sdlPath, 'utf8');
const schema = buildSchema(sdl);
const typeCount = Object.keys(schema.getTypeMap()).length;
console.log(`[graphql-test] schema built OK · ${typeCount} types`);

const audit = {
  id: 'a1', frequencyHz: 60.002, thdPercent: 1.8, crestFactor: 1.413,
  purityScore: 92, snrDb: 48, nominalHz: 60, verdict: 'PURE_SINE',
  verdictText: 'PURE SINE', harmonics: [1, 0.01], harmonicPercent: [100, 1],
  source: 'sim', createdAt: '2026-01-01T00:00:00Z', synced: 'PENDING',
};

const rootValue = {
  gridAudits: () => [audit],
  gridAudit: ({ id }) => (id === 'a1' ? audit : null),
  vampireAppliances: () => [],
  vampireSavings: () => ({ annualKwh: 367.9, annualUsd: 73.58, count: 1 }),
  tariffCurve: ({ scheduleId }) => ({
    id: scheduleId, name: 'TOU', currency: 'USD', blendedRate: 0.2,
    curve: Array.from({ length: 24 }, (_, hour) => ({
      hour, rate: hour >= 16 && hour < 21 ? 0.52 : 0.24, tier: 'x',
    })),
  }),
  ieee519: (args) => ({
    bus: args.bus, thdPercent: args.thdPercent, voltageThdLimit: 5,
    voltageCompliant: args.thdPercent <= 5, worstHarmonic: 5, individualLimit: 3,
    individualCompliant: true, currentTddLimit: 10, currentCompliant: true,
    compliant: args.thdPercent <= 5,
  }),
  panelCheck: (args) => ({
    panelAmps: args.panelAmps, voltage: args.voltage, capacityKw: 24,
    concurrentKw: args.concurrentKw, headroomKw: 24 - args.concurrentKw,
    loadPercent: (args.concurrentKw / 24) * 100, trips: args.concurrentKw > 19.2,
  }),
  syncQueue: () => [],
  role: () => 'GRID_SYSTEMS_DIRECTOR',
  setRole: ({ role }) => role,
};

const cases = [
  { q: 'query { gridAudits { frequencyHz thdPercent verdict } }' },
  { q: 'query { vampireSavings }' },
  { q: 'query Tou($id: ID!) { tariffCurve(scheduleId: $id) { id name curve { hour rate tier } } }', vars: { id: 'ca_sou_tou' } },
  { q: 'query { ieee519(thdPercent: 28.2, harmonics: [100,18,11,0,15,0,10,0,5]) { thdPercent compliant worstHarmonic } }' },
  { q: 'query { panelCheck(panelAmps: 100, voltage: 240, concurrentKw: 18) { capacityKw loadPercent trips } }' },
  { q: 'mutation { setRole(role: MASTER_ELECTRICIAN) }' },
];

let failures = 0;
for (const c of cases) {
  const res = await graphql({ schema, source: c.q, rootValue, variableValues: c.vars ?? {} });
  const ok = !res.errors;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.q.slice(0, 62)}${ok ? '' : ' :: ' + res.errors[0].message}`);
}

if (failures) {
  console.error(`\n[graphql-test] ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n[graphql-test] OK — SDL parses and representative operations execute');

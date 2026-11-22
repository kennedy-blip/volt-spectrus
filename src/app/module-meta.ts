import type { ModuleMeta } from './models';

/** The five core VOLT-SPECTRA modules shown in the gooey dock. */
export const MODULES: ModuleMeta[] = [
  {
    path: '',
    label: 'Grid & Inverter THD Lab',
    short: 'THD Lab',
    icon: '〰',
    blurb: 'C99 interpolated Goertzel 50/60 Hz frequency tracker and sine-purity oscilloscope.',
    minRole: 'HOMEOWNER',
  },
  {
    path: 'vampire-hunter',
    label: 'Vampire EMF Hunter',
    short: 'Vampire',
    icon: '⌁',
    blurb: 'Contactless phantom-load sweeper: 3-axis µT + 100/120 Hz magnetostrictive hum.',
    minRole: 'HOMEOWNER',
  },
  {
    path: 'meter-tachometer',
    label: 'Smart-Meter Tachometer',
    short: 'Tachometer',
    icon: '◉',
    blurb: 'Optical imp/kWh LED pulse scanner turning any utility meter into a live kW monitor.',
    minRole: 'HOMEOWNER',
  },
  {
    path: 'tariff-auditor',
    label: 'Ruby TOU Tariff Auditor',
    short: 'Tariff',
    icon: '▤',
    blurb: 'Time-of-Use peak arbitrage, vampire dollars and IEEE 519 breaker load sizing.',
    minRole: 'HOMEOWNER',
  },
  {
    path: 'graphql-vault',
    label: 'GraphQL & Polyglot Vault',
    short: 'Vault',
    icon: '⬡',
    blurb: 'Offline GraphQL console, five-language inspector and cloud-sync controller.',
    minRole: 'MASTER_ELECTRICIAN',
  },
];

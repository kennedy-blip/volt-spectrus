import { Routes } from '@angular/router';

/**
 * VOLT-SPECTRA route table. The five core modules are lazily loaded so the
 * initial shell (plasma background, glass chrome, gooey dock) paints instantly.
 */
export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./modules/grid-lab/grid-lab.component').then((m) => m.GridLabComponent),
  },
  {
    path: 'vampire-hunter',
    loadComponent: () =>
      import('./modules/vampire-hunter/vampire-hunter.component').then(
        (m) => m.VampireHunterComponent,
      ),
  },
  {
    path: 'meter-tachometer',
    loadComponent: () =>
      import('./modules/meter-tachometer/meter-tachometer.component').then(
        (m) => m.MeterTachometerComponent,
      ),
  },
  {
    path: 'tariff-auditor',
    loadComponent: () =>
      import('./modules/tariff-auditor/tariff-auditor.component').then(
        (m) => m.TariffAuditorComponent,
      ),
  },
  {
    path: 'graphql-vault',
    loadComponent: () =>
      import('./modules/graphql-vault/graphql-vault.component').then(
        (m) => m.GraphqlVaultComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];

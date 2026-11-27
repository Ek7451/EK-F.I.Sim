export interface NavItem {
  to: string;
  label: string;
  icon: string;
  description?: string;
}
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Primary destinations; existing deep URLs remain the secondary navigation. */
export const PRIMARY_NAV: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/plan', label: 'Edit plan', icon: 'edit' },
      { to: '/explore/projection', label: 'Results', icon: 'projection' },
      { to: '/compare', label: 'Compare', icon: 'compare' },
    ],
  },
  {
    id: 'more',
    label: 'More',
    items: [
      { to: '/track', label: 'Progress', icon: 'progress' },
      { to: '/reports', label: 'Reports', icon: 'reports' },
      { to: '/settings', label: 'App settings', icon: 'settings' },
      { to: '/help/tours', label: 'Help', icon: 'help' },
    ],
  },
];

export const SETUP_NAV: NavGroup[] = [
  {
    id: 'setup',
    label: 'Getting started',
    items: [
      { to: '/start', label: 'Start a plan', icon: 'plus' },
      ...PRIMARY_NAV[1].items.filter((item) => item.to === '/settings' || item.to === '/help/tours'),
    ],
  },
];

/** Information architecture organised by task: Plan -> Explore -> Compare -> Track (plan 10). */
export const NAV: NavGroup[] = [
  { id: 'home', label: 'Overview', items: [{ to: '/', label: 'Home', icon: 'home' }] },
  {
    id: 'plan',
    label: 'Plan inputs',
    items: [
      {
        to: '/plan/household',
        label: 'Household',
        description: 'People, residence, filing status and Social Security',
        icon: 'household',
      },
      {
        to: '/plan/snapshot',
        label: 'Accounts, assets and debts',
        description: 'Balances, property, loans and contributions',
        icon: 'wallet',
      },
      { to: '/plan/income', label: 'Income', description: 'Jobs and other income streams', icon: 'income' },
      {
        to: '/plan/savings',
        label: 'Savings and contributions',
        description: 'Annual deposits, employer matches and savings rates by account',
        icon: 'piggy',
      },
      {
        to: '/plan/spending',
        label: 'Spending',
        description: 'Recurring and one-time expenses',
        icon: 'spending',
      },
      {
        to: '/plan/timeline',
        label: 'Timeline and milestones',
        description: 'Retirement dates and other life events',
        icon: 'timeline',
      },
      {
        to: '/plan/strategy',
        label: 'Saving and withdrawal strategy',
        description: 'Surplus savings, withdrawal order and HSA use',
        icon: 'strategy',
      },
      { to: '/plan/healthcare', label: 'Healthcare', description: 'Coverage and care costs', icon: 'health' },
      {
        to: '/plan/assumptions',
        label: 'Assumptions and plan settings',
        description: 'Returns, inflation, start year and dollar display',
        icon: 'assumptions',
      },
    ],
  },
  {
    id: 'explore',
    label: 'Results',
    items: [
      { to: '/explore/projection', label: 'Projection', icon: 'projection' },
      { to: '/explore/cashflow', label: 'Cash flow', icon: 'cashflow' },
      { to: '/explore/taxes', label: 'Taxes', icon: 'taxes' },
      { to: '/explore/success', label: 'Outcomes', icon: 'success' },
      { to: '/explore/history', label: 'History', icon: 'history' },
      { to: '/explore/estate', label: 'Estate', icon: 'estate' },
    ],
  },
  {
    id: 'compare',
    label: 'Compare',
    items: [{ to: '/compare', label: 'Compare scenarios', icon: 'compare' }],
  },
  {
    id: 'track',
    label: 'Track',
    items: [
      { to: '/track', label: 'Progress', icon: 'progress' },
      { to: '/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    id: 'more',
    label: 'Help and settings',
    items: [
      { to: '/help/tours', label: 'Guided tours', icon: 'help' },
      { to: '/help/methods', label: 'How this is calculated', icon: 'info' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export function ownsRoute(to: string, path: string): boolean {
  if (to === '/explore/projection') return path.startsWith('/explore/');
  if (to === '/help/tours') return path.startsWith('/help/');
  if (to === '/settings' && path === '/changelog') return true;
  return path === to || (to !== '/' && path.startsWith(to + '/'));
}

export const DISCLAIMER =
  'For personal educational planning only. Not financial, tax, legal or medical advice. Every figure is an estimate.';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
}
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Information architecture organised by task: Plan -> Explore -> Compare -> Track (plan 10). */
export const NAV: NavGroup[] = [
  { id: 'home', label: 'Overview', items: [{ to: '/', label: 'Home', icon: 'home' }] },
  {
    id: 'plan',
    label: 'Plan',
    items: [
      { to: '/plan/household', label: 'Household', icon: 'household' },
      { to: '/plan/snapshot', label: 'What you have', icon: 'wallet' },
      { to: '/plan/income', label: 'Income', icon: 'income' },
      { to: '/plan/spending', label: 'Spending', icon: 'spending' },
      { to: '/plan/timeline', label: 'Timeline', icon: 'timeline' },
      { to: '/plan/strategy', label: 'Strategy', icon: 'strategy' },
      { to: '/plan/healthcare', label: 'Healthcare', icon: 'health' },
      { to: '/plan/assumptions', label: 'Assumptions', icon: 'assumptions' },
    ],
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      { to: '/explore/projection', label: 'Projection', icon: 'projection' },
      { to: '/explore/cashflow', label: 'Cash flow', icon: 'cashflow' },
      { to: '/explore/taxes', label: 'Taxes', icon: 'taxes' },
      { to: '/explore/success', label: 'Chance of success', icon: 'success' },
      { to: '/explore/history', label: 'Against history', icon: 'history' },
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

export const DISCLAIMER =
  'For personal educational planning only. Not financial, tax, legal or medical advice. Every figure is an estimate.';

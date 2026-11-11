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
      { to: '/plan/household', label: 'Household', icon: 'plan' },
      { to: '/plan/snapshot', label: 'What you have', icon: 'plan' },
      { to: '/plan/income', label: 'Income', icon: 'plan' },
      { to: '/plan/spending', label: 'Spending', icon: 'plan' },
      { to: '/plan/timeline', label: 'Timeline', icon: 'flag' },
      { to: '/plan/strategy', label: 'Strategy', icon: 'plan' },
      { to: '/plan/healthcare', label: 'Healthcare', icon: 'plan' },
      { to: '/plan/assumptions', label: 'Assumptions', icon: 'plan' },
    ],
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      { to: '/explore/projection', label: 'Projection', icon: 'explore' },
      { to: '/explore/cashflow', label: 'Cash flow', icon: 'explore' },
      { to: '/explore/taxes', label: 'Taxes', icon: 'explore' },
      { to: '/explore/success', label: 'Chance of success', icon: 'explore' },
      { to: '/explore/history', label: 'Against history', icon: 'explore' },
      { to: '/explore/estate', label: 'Estate', icon: 'explore' },
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
      { to: '/track', label: 'Progress', icon: 'track' },
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

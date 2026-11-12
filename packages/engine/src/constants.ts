/** Plain lists the app needs without loading the plan schema (and with it, zod). */
export const ASSET_CLASSES = ['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ACCOUNT_TYPES = [
  'taxable',
  'cash',
  'trad401k',
  'trad403b',
  'gov457b',
  'tradIra',
  'sepIra',
  'simpleIra',
  'solo401k',
  'roth401k',
  'rothIra',
  'hsa',
  'plan529',
  'inheritedIra',
  'iBond',
  'tBill',
  'annuity',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

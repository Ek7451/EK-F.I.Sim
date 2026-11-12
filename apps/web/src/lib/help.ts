/**
 * Help text for every input, shown from the (i) beside its label.
 *
 * Keys are the field's label exactly as it appears on screen, so a field picks up its help automatically
 * through `HelpProvider` (see `Field` in @fisim/ui). A few keys are shared ideas used by several fields
 * (prefixed with `@`). Paragraphs are separated by a blank line.
 *
 * Rules for this copy: say what the field is, what to include and leave out, whose it is (each person or
 * the household), a typical value where one exists, and what Longview does with it. Dollar limits are the
 * 2026 figures from packages/data/limits/2026.json; keep them in step at each annual data update.
 *
 * `help.test.ts` fails if a field label in the plan editors or the wizard has no entry here and is not
 * listed in NO_HELP.
 */
export const HELP: Record<string, string> = {
  // ---------------------------------------------------------------- shared ideas
  '@when':
    'When this happens: in a calendar year, when someone reaches an age, or when a milestone is reached (for example "Retire"). Linking to a milestone keeps things in step if you later move the milestone.',
  '@growthBasis':
    '"Above inflation" means the rate is on top of general inflation, so 1% means it keeps pace with prices and then grows 1% more. "In plain dollars" means the number itself grows by this rate, so it loses buying power if the rate is below inflation.',
  '@allocation':
    'How this account is invested, by share. Longview applies the expected return for each kind of investment (set under Assumptions) to this mix every year. If the shares do not add up to 100%, they are scaled so they do.',

  // ---------------------------------------------------------------- new-plan wizard
  'Your first name':
    'Used only to label things on screen, such as "Sam\'s salary". It never leaves this device.',
  'Year they were born': '@see Year you were born',
  'Year you were born':
    'Your age drives retirement-account rules (penalty-free withdrawals from 59½, required distributions from 73 or 75), Social Security claiming ages and Medicare at 65.',
  'Month they were born': '@see Month you were born',
  'Month you were born':
    'Pay that ends at a retirement age runs up to that birthday, so part of that year is still earned. The month also sets when you reach 59½ and when Social Security can start.',
  'Sex (for life tables)':
    'Used only to pick the Social Security life table when lifespans vary in simulations, and to show the odds of reaching your plan-until age. Women live longer than men on average.',
  'State you live in':
    'Sets state income tax and the health-insurance prices used before Medicare. If you plan to move, add the move later under Household.',
  'Plan with a partner':
    'Turn on to plan for two people. Each person gets their own pay, retirement accounts, Social Security and retirement age; spending, cash and the brokerage account are shared. Partners are planned as a married couple filing jointly.',
  'Plan until age':
    'The age to plan for, not a prediction. Money has to last if you live long, so many planners use 90 to 95. The odds shown under the field come from the Social Security 2023 life tables, which leave out future gains in lifespan, so the real odds are probably a little higher.\n\nYou can also let lifespans vary at random in the Chance of success simulations (under Assumptions).',
  'Yearly pay before tax':
    'Gross pay from work for this person: salary, wages and regular bonuses, before tax and before anything is taken out for a 401(k) or health insurance. Leave out investment income and side income; add those later under Income.',
  'Contribution (share of pay)':
    "This person's own payroll contribution to their workplace retirement plan (401(k), 403(b) and similar), as a share of their gross pay. Do not include the employer match; enter that separately.\n\n2026 limit: $24,500, plus $8,000 from age 50, or $11,250 at ages 60 to 63. Longview stops contributions at the limit.",
  'Goes in as':
    'Pre-tax (traditional): lowers your taxable income now; withdrawals are taxed later.\n\nRoth: no tax break now; qualified withdrawals in retirement are tax-free. Check which your plan offers.',
  'Employer matches':
    'How much your employer adds for each dollar you put in, up to a limit. A common formula is 50% of what you contribute, on the first 6% of pay. It goes into the same plan and does not count toward your own $24,500 limit.',
  'Up to (share of pay)':
    'The match stops at this share of your pay. With "50% up to 6%", putting in 6% of pay earns 3% from your employer; putting in more earns no extra match.',
  'Cash and savings':
    'Checking, savings, high-yield savings and money-market accounts. Part of this is kept as an emergency fund (six months of spending by default).',
  'Brokerage (taxable investments)':
    'Investment accounts that are not retirement accounts: stocks, funds and bonds you hold in an ordinary brokerage account. Gains are taxed when you sell, dividends each year.',
  'Pre-tax retirement (401(k), IRA)':
    'The total in traditional (pre-tax) retirement accounts: 401(k), 403(b), 457(b), traditional IRA, SEP and SIMPLE IRA. Withdrawals are taxed as income.',
  'Roth accounts':
    'The total in Roth IRA and Roth 401(k) accounts. Qualified withdrawals are tax-free. Your own contributions to a Roth IRA can come out at any time without tax or penalty.',
  'What you spend in a year':
    'Everything your household spends in a normal year today: housing (rent or mortgage payments), food, transport, insurance other than health, travel and fun.\n\nLeave out taxes, retirement savings, and health insurance and medical costs: Longview works those out separately.',
  'Spend differently as you age':
    'Many retirees spend more in their first active years and less later. When on, the "travel and fun" part of your spending is 10% higher from retirement, 10% lower from ten years later (75 at the earliest) and 25% lower from 85. Everyday living costs stay the same. You can change these phases under Spending.',
  'Age you would like to retire':
    'The age this person stops working. Their pay stops at the start of the year they reach this age. You can retire at different ages from your partner.',

  // ---------------------------------------------------------------- Household
  'Date of birth': '@see Year you were born',
  Born: 'Birth year of a child or other dependent. Children affect your tax credits, the household size used for health subsidies, and the marketplace insurance you pay for until they leave.',
  'Plan to age': '@see Plan until age',
  'Let lifespan vary in simulations (SSA life tables)':
    'When on, each Chance of success run draws a random age at death from Social Security life tables instead of using the plan-until age. This shows the risk of living longer, or shorter, than planned.',
  'Let lifespans vary in simulations (SSA life tables)':
    '@see Let lifespan vary in simulations (SSA life tables)',
  State: 'The state you live in from the year shown. Sets state income tax and health-insurance prices.',
  'County FIPS (optional)':
    'A five-digit county code that makes marketplace health-insurance prices more exact in HealthCare.gov states. Leave it blank to use a state average.',
  Status:
    'How you file your federal tax return from this year on. Married couples usually file jointly. After a spouse dies, the survivor files as single (or as a qualifying surviving spouse for two years when there are dependent children).',
  'Benefit comes from':
    'My earnings record: Longview works out the benefit from your past and future pay using the SSA formula (enter past earnings from your my Social Security statement for the best figure).\n\nA benefit estimate I enter: type the monthly amount at full retirement age from your statement.',
  'Monthly benefit at full retirement age':
    "Your benefit if you claim at full retirement age (67 for anyone born in 1960 or later), in today's dollars. Find it on your statement at ssa.gov/myaccount. Longview raises or lowers it if you claim earlier or later.",
  'Claim at age':
    'When this person starts Social Security, between 62 and 70. Claiming at 62 cuts the benefit by up to 30% for life; each year after full retirement age adds 8%, up to 70.',
  '…plus months': 'Extra months on top of the claim age, from 0 to 11.',
  'From year': 'The first year this applies. It stays in force until a later entry replaces it.',

  // ---------------------------------------------------------------- Snapshot: accounts
  'Balance today': 'What the account is worth today.',
  'Cost basis':
    'What you paid for the investments in this account, including reinvested dividends. Only the gain above this is taxed when you sell. Your brokerage shows it as "cost basis".',
  'Contributions so far':
    'The total you have put into Roth IRAs over the years. This part can come out at any time without tax or penalty; growth above it cannot until 59½ (and five years after your first contribution).',
  'First contribution year':
    'The year of your first-ever Roth IRA contribution. It starts the five-year clock for tax-free growth.',
  'Year opened':
    'The year this account was opened. Used for the 15-year rule on moving 529 money into a Roth IRA.',
  'Year the original owner died':
    'Inherited IRAs must usually be emptied by the end of the 10th year after the original owner died.',
  'They had started required distributions':
    'If the person you inherited from had already begun required minimum distributions, you must also take a yearly amount during the 10 years.',
  'Fund expense ratio':
    "The funds' own yearly fee, as a share of the balance. Index funds are often 0.03% to 0.2%.",
  'Advisory fee':
    "A fee you pay an adviser each year as a share of the balance (often about 1%). Enter 0 if you don't use one.",
  'Glide path': '@see @allocation',
  'Contribute to this account from income':
    'Turn on if money goes into this account straight from a paycheck.',
  'From which income': 'The pay this contribution is taken from. Percentages are of this income.',
  'Share of pay': '@see Contribution (share of pay)',
  'Plus a flat yearly amount':
    "A fixed dollar amount on top of the percentage, in today's dollars (it rises with inflation).",
  'Employer adds (share of pay)':
    'An employer contribution that does not depend on yours (sometimes called a non-elective or profit-sharing contribution), as a share of pay.',
  '…of contributions up to this share of pay': '@see Up to (share of pay)',
  'Contribute the legal maximum, including catch-up amounts':
    'Puts in the most allowed each year: $24,500 in 2026, plus $8,000 from 50, or $11,250 at 60 to 63. The limit rises with inflation.',
  'Rule of 55: I can draw on this penalty-free if I leave this employer at 55 or later':
    "If you leave this employer in or after the year you turn 55, you can withdraw from this employer's plan without the 10% early penalty (income tax still applies). It does not apply to IRAs.",
  'Mega-backdoor Roth: after-tax contributions up to the plan limit, converted to Roth':
    'Some plans allow extra after-tax contributions up to the total limit ($72,000 in 2026, including your own and employer money) and converting them to Roth. Only turn on if your plan allows both.',
  'Roll leftovers into a Roth IRA (after 15 years, within the lifetime cap)':
    "Unused 529 money can move to the beneficiary's Roth IRA once the account is 15 years old, up to $35,000 over a lifetime and within the yearly IRA limit.",
  'Fixed rate': 'The fixed rate on these I bonds, added to the inflation part of the rate.',
  'Interest rate': 'The yearly interest rate.',
  // Snapshot: property and debts
  "Price in today's dollars":
    "The purchase price in today's money. Longview grows it with the appreciation you set until the purchase year.",
  'Value today': 'What it would sell for today.',
  'What you paid (basis)':
    'The purchase price plus the cost of improvements. When you sell, the gain above this is taxable; on a main home, up to $250,000 of gain ($500,000 for a married couple) is tax-free if you lived there two of the last five years.',
  'Yearly appreciation':
    'How fast the value changes each year. Homes have roughly kept pace with inflation over the long run, so 0% above inflation is a cautious choice.',
  'Yearly change in value (negative loses value)': 'Cars usually lose 10% to 20% of their value a year.',
  'This is a future purchase': 'Turn on for something you plan to buy later, such as a first home.',
  Buy: 'When you buy it.',
  'Down payment': 'The share of the price you pay up front. The rest is a new mortgage.',
  'Closing costs': 'Fees paid when buying, as a share of the price. Often 2% to 5%.',
  'Mortgage rate': 'Interest rate on the new mortgage.',
  'Mortgage years': 'Length of the new mortgage, usually 15 or 30 years.',
  'Plan to sell': 'Turn on to sell this property during the plan.',
  Sell: 'When you sell it.',
  'Selling costs': 'Agent fees and other costs of selling, as a share of the price. Often 6% to 10%.',
  'Property tax (share of value)':
    "Yearly property tax as a share of the home's value. The US average is about 1%.",
  'Insurance per year': "Homeowner's insurance premium for a year.",
  'Upkeep (share of value)':
    'Repairs and maintenance each year, as a share of value. A common rule of thumb is 1%.',
  'HOA per year': 'Homeowners-association or condo fees for a year.',
  'Balance owed': 'What you still owe today.',
  'Monthly payment': 'Your regular monthly payment, including interest.',
  'Months left':
    'Payments still to make. Leave as is if Longview can work it out from the balance, rate and payment.',
  'Balance paid down each year':
    'For revolving debt such as a credit card: the share of the balance you pay off each year.',
  'Secured by': 'The property this loan is against, so a sale pays it off.',
  'Interest is deductible (home mortgage)':
    'Mortgage interest is deductible only if you itemize. Longview compares itemizing with the standard deduction each year and uses whichever is larger.',
  Refinance: 'When you refinance this loan.',
  'New rate': 'Interest rate after refinancing.',
  'New term (years)': 'Length of the new loan.',
  Cost: 'Refinancing costs as a share of the balance.',

  // ---------------------------------------------------------------- Income and spending
  'Amount per year': "In today's dollars. Longview raises it each year as set below.",
  'Amount each time': "In today's dollars.",
  Whose:
    'The person this income belongs to. It matters for payroll tax, Social Security credits and what happens when someone dies.',
  'Taxed as':
    'How this income is taxed. Wages pay income tax and payroll tax; self-employment income also pays self-employment tax; qualified dividends and long-term gains get the lower capital-gains rates.',
  'Yearly raise':
    'How much this pay rises each year. Pay has historically grown about 1% a year above inflation.',
  'Cost-of-living increase':
    'How much this pension rises each year once it starts. Many private pensions have none; Social Security follows inflation.',
  'Paid to a surviving spouse':
    'The share of the pension that continues to a spouse after the owner dies (often 50% or 100%, or 0% for a single-life pension).',
  'Share of each payment that is your own money back (not taxed)':
    'For an annuity bought with after-tax money, part of each payment returns your own money and is not taxed. Your annuity statement shows this "exclusion ratio".',
  Starts: '@see @when',
  Ends: '@see @when',
  When: '@see @when',
  Category: 'A label for grouping spending in the charts. Education spending rises with education inflation.',
  'How often': 'Every year, once, or every few years (for example a new car every 8 years).',
  'Every how many years': 'How often this repeats.',
  'Rises with':
    'What makes this cost go up over time. Most costs follow general inflation; a fixed payment such as a mortgage stays flat.',
  'Yearly increase': 'Your own yearly increase for this cost.',
  'Essential (cannot be cut in a bad year)':
    'A cost you cannot trim, such as housing or food. When a flexible spending rule (guardrails, a share of the portfolio, a floor and ceiling) calls for a cut, it comes out of the other expenses and never this one. Raises apply to everything.',
  'Follows the spending phases':
    'When on, this cost goes up or down with the spending phases below (for example less travel after 80).',
  'Spending after one partner dies':
    'What the household spends after one partner dies, as a share of what the two of you spent. Often 70% to 80%: housing stays, but food, travel and transport drop.',
  'From age': 'The age of the first person in the plan at which this phase starts.',
  Spend: 'Spending that follows the phases is multiplied by this share. 100% is unchanged.',
  'From which property': 'The property whose costs this covers.',

  // ---------------------------------------------------------------- Timeline
  Happens:
    "Whether this milestone is set for a year, for someone's age, or for when a condition becomes true (such as reaching financial independence).",
  Condition:
    'Reach this milestone when something becomes true rather than at a set date. "Investments cover spending" means your investments reach the multiple of yearly spending set below.',
  'Years of spending saved':
    'Financial independence here means investments reach this many years of spending. 25 years matches the "4% rule".',
  Amount: "In today's dollars.",
  "Amount (today's dollars)": "In today's dollars; Longview adds inflation for the year it happens.",
  'Lump sum into': 'The account that receives the money.',
  Taxable:
    'Turn on if this money counts as taxable income in the year it arrives (a bonus, for example). Gifts and inheritances usually are not.',
  'File as': '@see Status',
  'Move to': 'The state you move to. State tax and health-insurance prices change from that year.',
  To: 'Scale the item to this share of its amount, from the milestone on. 50% halves it; 0% stops it.',

  // ---------------------------------------------------------------- Strategy
  'Months of spending':
    'How many months of spending to keep in cash before saving anything else. Three to six months is common while working.',
  'Default account for anything left': 'Where money goes once everything above is full.',
  'At most per year (0 = up to the limit)':
    "A cap on what this step takes each year, in today's dollars. At 0 it takes as much as the account's legal limit allows before money moves to the next step.",
  'Withdrawal strategy':
    'Which accounts pay for spending once pay stops.\n\nTaxable first is a common default. Filling a low bracket with pre-tax money first can lower lifetime tax. Required distributions and penalty rules apply whatever you choose.',
  'Fill up to the top of the':
    'Each year, take pre-tax money (or convert to Roth) until taxable income reaches the top of this federal bracket. Filling the 12% bracket is common when you expect a higher rate later.',
  'Health savings account':
    '"Leave it invested" lets the HSA grow tax-free and pays medical bills from other money; it is the better tax choice if you can afford it.',
  Account: 'The pre-tax account the 72(t) payments come from.',
  'Interest rate used':
    'The IRS lets you use a rate up to 5% or 120% of the federal mid-term rate, whichever is higher. A higher rate gives a larger fixed payment.',
  'Payments start':
    'When the 72(t) payments begin. They must continue for five years or until 59½, whichever is later.',
  'Convert pre-tax money to Roth':
    'Moves money from pre-tax accounts to Roth. You pay income tax on it now, so later withdrawals are tax-free and required distributions are smaller. Often done in low-income years after retirement.',
  "Amount per year (today's dollars)": "The amount to convert each year, in today's dollars.",
  From: '@see @when',
  Until: '@see @when',
  'Harvest gains in the 0% bracket: sell and rebuy to raise cost basis when it is tax-free':
    'In years when your taxable income is low enough that long-term gains are taxed at 0%, Longview sells and rebuys taxable investments to lock in those gains tax-free.',
  'Harvest losses: bank losses in down years (offsets gains, then up to $3,000 of other income a year)':
    'In a down year Longview sells investments at a loss to bank it. Banked losses offset gains, then up to $3,000 of other income a year; the rest carries forward.',
  'Manage income while on marketplace coverage':
    'Before Medicare, the premium credit for marketplace insurance depends on your income. When on, Longview limits withdrawals and conversions from pre-tax accounts to keep income in the range below.',
  'Keep income under (share of the poverty line)':
    'Under current law the premium credit stops completely if income goes over 400% of the federal poverty line. Staying under it can be worth thousands a year.',
  'Keep income above (0 = no floor)': '@hint',
  'Spending rule':
    'Fixed spends the plan every year whatever the markets do. Guardrails and portfolio-share rules spend less after bad years and more after good ones, which lowers the chance of running out.',
  'Share of portfolio per year':
    'Spend this share of your investments each year. 4% is the classic starting point.',
  'Guardrail width': '@hint',
  'Adjustment each time':
    'How much spending is cut (or raised) each time a guardrail is crossed. 10% is common.',
  'Never spend less than (share of plan)': 'A floor under spending cuts, as a share of planned spending.',
  'Never spend more than (share of plan)': 'A cap on spending raises, as a share of planned spending.',
  'Rule applies from': 'When the spending rule starts. Usually at retirement.',
  'Rebalance accounts':
    "Rebalancing sells some of what has grown and buys what has fallen, back to each account's mix. Rebalancing in a taxable account can create taxable gains.",
  'Drift that triggers it':
    'Rebalance only when an investment is this far off its target share, for example 5 points.',
  'Tax rate heirs pay on inherited pre-tax accounts':
    'Heirs pay income tax on pre-tax accounts as they withdraw them. Used only to estimate what heirs actually receive.',
  'Backdoor Roth: when income is too high for a direct Roth IRA contribution, contribute after-tax and convert (pro-rata rule applied)':
    'Above the Roth IRA income limit (the phase-out starts at $153,000 single, $242,000 joint in 2026) you can still contribute to a traditional IRA and convert it. If you hold other pre-tax IRA money, part of the conversion is taxed (the pro-rata rule).',

  // ---------------------------------------------------------------- Healthcare
  'Model healthcare costs':
    'When on, Longview estimates premiums and out-of-pocket costs for each person, including marketplace insurance and premium credits before 65 and Medicare after. Leave medical costs out of your spending if this is on.',
  Coverage: 'The kind of health insurance this person has for this period.',
  'Metal tier':
    'Bronze has the lowest premium and highest out-of-pocket costs; gold and platinum the reverse. Silver plans get extra cost-sharing help at lower incomes.',
  'Your share of the yearly premium':
    'What you pay for workplace coverage in a year, from your pay stub. Leave at 0 to use a national average.',
  'Full yearly premium (before the 2% fee)':
    'COBRA lets you keep workplace coverage after leaving, at the full premium plus 2%.',
  'Months of COBRA': 'COBRA usually lasts up to 18 months.',
  'Uses tobacco (raises marketplace premiums in most states)':
    'Insurers in most states can charge tobacco users up to 50% more.',
  'How much care you use':
    'Sets the out-of-pocket estimate: how often you see doctors, take prescriptions and use hospital care.',
  'At 65':
    'How this person is covered once on Medicare. Medigap plans cost more each month but leave little to pay when you use care; Medicare Advantage usually costs less each month but has more cost-sharing.',
  'Part A is premium-free (40 quarters of work)':
    'Part A (hospital) is free if you or your spouse worked about 10 years paying Medicare tax.',
  'Include dental, vision and hearing costs on Medicare':
    'Original Medicare does not cover most dental, vision or hearing care.',
  'Long-term care':
    'Care for help with daily living, at home or in a facility, which Medicare does not cover. "Assume it happens" adds the cost once; "by chance" lets some simulation runs need care and others not.',
  'Kind of care': 'The kind of long-term care to cost. A private nursing-home room is the most expensive.',
  'Starting at age': 'The age at which care begins.',
  'For how many years': 'How long care lasts. About two to three years is typical for those who need it.',
  'Has long-term care insurance':
    'Turn on if this person has a policy that pays a benefit while receiving care.',
  'Premium per year': 'What the policy costs each year.',
  'Benefit per year of care': 'What the policy pays for each year of care.',
  'Benefit years': 'How many years of care the policy pays for.',
  'HSA-eligible plan (bronze and catastrophic plans qualify by default)':
    'High-deductible plans let you contribute to an HSA ($4,400 single, $8,750 family in 2026, plus $1,000 from 55).',
  'High-deductible plan (HSA-eligible)':
    '@see HSA-eligible plan (bronze and catastrophic plans qualify by default)',
  'Monthly benchmark for a 21-year-old (0 = use the dataset)':
    'The second-lowest-cost silver premium for a 21-year-old in your area, which sets the premium credit. Leave at 0 to use the bundled county or state figure.',

  // ---------------------------------------------------------------- Assumptions
  'Plan name': 'A name for this plan, shown in the plan switcher.',
  'First year of the plan': 'The first year projected. Balances you enter are as of the start of this year.',
  'Show money in':
    "Today's dollars take inflation out, so a figure decades away is in today's buying power. Future dollars show the actual amounts in that year.",
  'Cash flows happen':
    'When in the year money comes in and goes out. Mid-year is the most realistic: money saved during a year earns about half a year of return.',
  Inflation:
    'General price inflation each year. The long-run US average is about 3%; the Federal Reserve targets 2%.',
  'Education inflation above general inflation':
    'College costs have risen faster than other prices. 2% above inflation is a common assumption.',
  'Healthcare inflation above general inflation':
    'Medical costs have risen faster than other prices, often by 1% to 2% a year.',
  'Wage growth above inflation':
    'How fast average pay grows above inflation. Used to project Social Security wage indexing.',
  'Expected returns':
    'The figures I set below: Longview uses the returns you enter. Long-run historical averages: uses the compound averages of US market history since 1871 for US stocks, bonds and cash.\n\nEither way these are compound yearly rates before inflation: 7% means money grows by 7% each year on average over the long run.',
  'Dividend yield on stocks':
    "The share of a stock's value paid out each year as dividends. Dividends in a taxable account are taxed each year. About 1.5% to 2% for the US market.",
  'Bond interest yield':
    'Interest paid each year by bonds. Interest in a taxable account is taxed as income.',
  Method:
    'Replay blocks of real history: each run strings together real past years in random order, keeping crashes, recoveries and the way stocks, bonds and inflation moved together.\n\nRandom draws: each year is drawn at random around your expected returns, with the volatility you set.\n\nBoth methods centre on your expected returns unless you choose to replay history as it happened.',
  'Average returns in replayed history':
    'Shifted to my expected returns: history keeps its ups, downs and sequences, but each investment is moved so its long-run compound return matches the figure you set. The simulations and the single projection then use the same outlook.\n\nAs they happened: replays US history since 1871 with its own averages (about 7% a year above inflation for stocks), which is more generous than most forecasts today.',
  'Yearly improvement in death rates':
    "Life tables describe death rates today. People keep living longer, so rates in future years are likely lower. 0% uses the table as published; about 0.8% a year is close to the Social Security Trustees' middle assumption.",
  'Appeal higher Medicare premiums after retiring':
    "Medicare premiums rise with income from two years earlier (IRMAA). After work stops or is cut back you can ask Social Security to use this year's lower income instead (form SSA-44). When on, Longview applies this whenever household pay drops by 10% or more against the lookback year.",
  "Leave at least (today's dollars)":
    "Net worth you want left at the end of the plan, for heirs or a cushion, in today's dollars. 0 means no goal. The projection shows whether the expected path meets it, and Chance of success shows how many simulations do.",
  'Count the goal in the chance of success':
    'When on, a simulation only counts as a success if spending is covered every year and it also ends with at least this much. When off, the goal is reported separately.',
  'Number of runs':
    'How many simulated futures to run. More runs give a steadier answer but take longer. 1,000 is usually enough.',
  Seed: 'The starting point for the random numbers. The same seed always gives the same answer, so a change in the result comes from a change in your plan.',
  'Block length (years)':
    "How many consecutive real years each block keeps together. Longer blocks keep more of history's booms and busts intact.",
  'Inflation in simulations':
    'Whether inflation varies from run to run as it did in history, or stays at your rate.',
  'Let healthcare inflation vary in simulations':
    'When on, the extra healthcare inflation varies at random from run to run.',
  'Assume benefits are cut if the trust fund runs short':
    'The 2026 Social Security Trustees Report projects the trust funds running short in 2034, after which incoming taxes would pay about 83% of scheduled benefits unless Congress acts. Turn on to plan for that cut.',
  'Share of benefits still paid': 'The share of scheduled benefits paid after the trust fund runs short.',
  'At age': 'The age at which this mix applies. Between ages, the mix moves gradually.',
  Name: 'A name to recognise this by.',
};

/** Labels that are clear enough on their own, or too generic to explain out of context. */
export const NO_HELP = new Set<string>([
  'Kind',
  'Type',
  'Owner',
  'Who',
  'Age',
  'Year',
  'Milestone',
  'Measured',
  'Add a step',
  'Add a change',
  'Your first name',
]);

const MAX_HOPS = 3;
/**
 * Resolve `@see` aliases to the text to show. `@hint` marks a field whose visible hint already says
 * enough, so it gets no (i).
 */
export function helpText(key: string): string | undefined {
  let k = key;
  for (let i = 0; i <= MAX_HOPS; i++) {
    const t = HELP[k];
    if (t === undefined) return undefined;
    if (t === '@hint') return undefined;
    if (!t.startsWith('@see ')) return t;
    k = t.slice(5);
  }
  return undefined;
}

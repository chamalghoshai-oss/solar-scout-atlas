// KSEB (Kerala) domestic LT-1A tariff modelling, solar production and ROI maths
// used by the lead solar report generator.

export type BillCycle = "monthly" | "bimonthly";

/** Telescopic slabs, applied on BI-MONTHLY consumption up to 500 units. */
const TELESCOPIC: Array<{ upto: number; rate: number }> = [
  { upto: 100, rate: 3.25 },
  { upto: 200, rate: 4.05 },
  { upto: 300, rate: 5.1 },
  { upto: 400, rate: 7.0 },
  { upto: 500, rate: 8.5 },
];

/** Non-telescopic flat rates, applied on ALL bi-monthly units above 500. */
const NON_TELESCOPIC: Array<{ upto: number; rate: number }> = [
  { upto: 600, rate: 7.6 },
  { upto: 700, rate: 8.1 },
  { upto: 800, rate: 8.3 },
  { upto: 1000, rate: 8.8 },
  { upto: Infinity, rate: 9.2 },
];

/** Fixed / duty component expressed as a share of the energy charge. */
export const FIXED_CHARGE_SHARE = 0.1;

/** Energy charge (₹) for a bi-monthly consumption, before fixed charges. */
export function energyChargeBimonthly(units: number): number {
  if (units <= 0) return 0;
  if (units > 500) {
    const slab = NON_TELESCOPIC.find((s) => units <= s.upto)!;
    return units * slab.rate;
  }
  let rest = units;
  let prev = 0;
  let total = 0;
  for (const s of TELESCOPIC) {
    const width = s.upto - prev;
    const take = Math.min(rest, width);
    total += take * s.rate;
    rest -= take;
    prev = s.upto;
    if (rest <= 0) break;
  }
  return total;
}

/** Full bill (₹) including the 10% fixed-charge component. */
export function billFromUnits(units: number, cycle: BillCycle): number {
  const bim = cycle === "monthly" ? units * 2 : units;
  const total = energyChargeBimonthly(bim) * (1 + FIXED_CHARGE_SHARE);
  return cycle === "monthly" ? total / 2 : total;
}

/** Inverts the tariff: units consumed for a given bill amount. */
export function unitsFromBill(bill: number, cycle: BillCycle): number {
  if (bill <= 0) return 0;
  let lo = 0;
  let hi = 10000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (billFromUnits(mid, cycle) < bill) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** Average ₹/unit the customer pays today (energy + fixed). */
export function effectiveRate(monthlyUnits: number): number {
  if (monthlyUnits <= 0) return 0;
  return billFromUnits(monthlyUnits, "monthly") / monthlyUnits;
}

/** Marginal ₹/unit saved by the last unit offset by solar. */
export function marginalRate(monthlyUnits: number): number {
  if (monthlyUnits <= 0) return 0;
  const d = 5;
  const hi = billFromUnits(monthlyUnits, "monthly");
  const lo = billFromUnits(Math.max(0, monthlyUnits - d), "monthly");
  return (hi - lo) / Math.min(d, monthlyUnits);
}

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Baseline generation before shading: 4 units per kW per day. */
export const UNITS_PER_KW_DAY = 4;

export type ProductionRow = { month: string; days: number; access: number; units: number };

/** Monthly production, scaled by the month's average sun access (shadow factor). */
export function monthlyProduction(kw: number, monthlyAccess: number[]): ProductionRow[] {
  return DAYS_IN_MONTH.map((days, i) => {
    const access = monthlyAccess[i] ?? 1;
    return {
      month: MONTH_NAMES[i],
      days,
      access,
      units: Math.round(kw * UNITS_PER_KW_DAY * days * access),
    };
  });
}

export type RoiInput = {
  kw: number;
  annualUnits: number;
  monthlyConsumption: number;
  costPerKw: number;
  subsidy: number;
  /** monthly generation (12 values) used for monthly net metering */
  monthlyUnitsProduced?: number[];
  /** ₹/unit redeemed for net surplus at the end of the settlement year */
  exportRate?: number;
  tariffEscalation?: number;
  degradation?: number;
  years?: number;
};

export type RoiYear = { year: number; units: number; savings: number; cumulative: number };

export type RoiResult = {
  capex: number;
  netCapex: number;
  selfUse: number;
  exportUnits: number;
  firstYearSavings: number;
  breakEvenYears: number | null;
  rows: RoiYear[];
  lifetimeSavings: number;
};

export function computeRoi(i: RoiInput): RoiResult {
  const years = i.years ?? 25;
  const esc = i.tariffEscalation ?? 0.05;
  const deg = i.degradation ?? 0.007;
  const exportRate = i.exportRate ?? EXPORT_REDEMPTION_RATE;
  const annualConsumption = i.monthlyConsumption * 12;
  const gen =
    i.monthlyUnitsProduced && i.monthlyUnitsProduced.length === 12
      ? i.monthlyUnitsProduced
      : new Array(12).fill(i.annualUnits / 12);
  // Monthly net metering: each month is settled against consumption, the
  // deficit is billed on the KSEB slabs, surplus units bank up and are
  // redeemed once a year at the export rate.
  const netYear = (factor: number) => {
    let billWithout = 0;
    let billWith = 0;
    let banked = 0;
    let self = 0;
    for (let m = 0; m < 12; m++) {
      const prod = (gen[m] ?? 0) * factor;
      const cons = i.monthlyConsumption;
      const deficit = Math.max(0, cons - prod);
      billWithout += billFromUnits(cons, "monthly");
      billWith += billFromUnits(deficit, "monthly");
      banked += Math.max(0, prod - cons);
      self += Math.min(prod, cons);
    }
    return { billSaving: billWithout - billWith, banked, self, units: gen.reduce((a, u) => a + u, 0) * factor };
  };
  const y1 = netYear(1);
  const selfUse = y1.self;
  const exportUnits = y1.banked;
  const capex = i.kw * i.costPerKw;
  const netCapex = Math.max(0, capex - i.subsidy);

  const rows: RoiYear[] = [];
  let cumulative = -netCapex;
  let breakEven: number | null = null;
  for (let y = 1; y <= years; y++) {
    const factor = Math.pow(1 - deg, y - 1);
    const escFactor = Math.pow(1 + esc, y - 1);
    const n = netYear(factor);
    const savings = n.billSaving * escFactor + n.banked * exportRate;
    const prev = cumulative;
    cumulative += savings;
    if (breakEven === null && cumulative >= 0) {
      breakEven = Math.round((y - 1 + (savings > 0 ? -prev / savings : 0)) * 10) / 10;
    }
    rows.push({
      year: y,
      units: Math.round(n.units),
      savings: Math.round(savings),
      cumulative: Math.round(cumulative),
    });
  }
  void annualConsumption;
  return {
    capex,
    netCapex,
    selfUse: Math.round(selfUse),
    exportUnits: Math.round(exportUnits),
    firstYearSavings: rows[0]?.savings ?? 0,
    breakEvenYears: breakEven,
    rows,
    lifetimeSavings: rows[rows.length - 1]?.cumulative ?? 0,
  };
}

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ *
 * Rooftop solar loan (subsidised): 5.75% p.a., up to ₹2,00,000,
 * tenure up to 10 years.
 * ------------------------------------------------------------------ */

export const LOAN_RATE = 0.0575;
export const LOAN_MAX_PRINCIPAL = 200000;
export const LOAN_MAX_YEARS = 10;
/** Customer pays 10% of the system amount up front, the rest is financed. */
export const DOWN_PAYMENT_SHARE = 0.1;
/** ₹/unit redeemed for net exported surplus at the end of the year. */
export const EXPORT_REDEMPTION_RATE = 2.75;

/** Bank loan for a given system amount: 90% financed, capped at ₹2,00,000. */
export function financePlan(netCapex: number) {
  const loan = Math.min(LOAN_MAX_PRINCIPAL, Math.round(netCapex * (1 - DOWN_PAYMENT_SHARE)));
  return { loan: Math.max(0, loan), downPayment: Math.max(0, Math.round(netCapex - loan)) };
}

export type LoanResult = {
  principal: number;
  years: number;
  rate: number;
  emi: number;
  totalPaid: number;
  totalInterest: number;
  downPayment: number;
};

export function computeLoan(opts: {
  principal: number;
  years: number;
  netCapex: number;
  rate?: number;
}): LoanResult {
  const rate = opts.rate ?? LOAN_RATE;
  const principal = Math.max(0, Math.min(opts.principal, LOAN_MAX_PRINCIPAL, opts.netCapex));
  const years = Math.max(1, Math.min(opts.years, LOAN_MAX_YEARS));
  const n = years * 12;
  const r = rate / 12;
  const emi = principal <= 0 ? 0 : (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const totalPaid = emi * n;
  return {
    principal,
    years,
    rate,
    emi: Math.round(emi),
    totalPaid: Math.round(totalPaid),
    totalInterest: Math.round(totalPaid - principal),
    downPayment: Math.max(0, Math.round(opts.netCapex - principal)),
  };
}
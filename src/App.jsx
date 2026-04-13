import { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ── DEFAULTS ── */
const DEFAULTS = {
  mode: "simplified",
  allSpendOnNewCust: false,
  // Simplified
  simpleAov: 75,
  avgVarCostPct: 40,
  spendStep: 20000,
  // Detailed
  newAov: 78, retAov: 65, grossMarginPct: 65,
  shippingPerOrder: 6.5, processingPct: 3.2,
  otherVarPerOrder: 2.0, otherVarPctRevenue: 0,
  newCustPctBase: 60, newCustPctAtMaxSpend: 72,
  monthlyOrganicRevenue: 80000, organicNewPct: 25,
  // LTV
  ltvMode: "modelled", // "modelled" | "known"
  repeatRate: 35, avgOrdersPerRepeater: 3.8, avgRepeatCycleMonths: 2.5,
  ltv30: 85, ltv60: 110, ltv90: 135, ltv180: 170, ltv360: 210, // cumulative revenue per customer
  // Fixed & grid
  monthlyFixedCosts: 35000,
  roasMin: 1.0, roasMax: 5.0, roasStep: 0.5,
  spendMin: 10000, spendMax: 200000, spendSteps: 8,
  // Scaling realism
  roasDecayPct: 15, // % ROAS drops from min→max spend
  // Current
  currentSpend: 50000, currentRoas: 2.5, currentNewCustomers: 0,
};

const newBrand = (name) => ({ name, inputs: { ...DEFAULTS } });
const DEFAULT_BRANDS = [newBrand("My Brand")];
const LS_KEY = "profitMatrix.brands.v2";
const LS_ACTIVE = "profitMatrix.activeBrand";
const LS_THEME = "profitMatrix.theme";

/* ── FORMATTERS ── */
const fmt = (n) => {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const fmtFull = (n) => (!isFinite(n)) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtX = (n) => (!isFinite(n) || isNaN(n)) ? "—" : `${n.toFixed(2)}x`;
const fmtInt = (n) => (!isFinite(n) || isNaN(n)) ? "—" : Math.round(n).toLocaleString();

/* ── THEMES ── */
const THEMES = {
  dark: {
    bg: "#0c0e16", panel: "rgba(255,255,255,0.01)", card: "rgba(255,255,255,0.03)", elev: "#181b2b", sideBg: "rgba(255,255,255,0.01)", inputBg: "#1a1d2e",
    text: "#e8eaf2", textStrong: "#ffffff", muted: "#8a8fa8", subtle: "#6e7390", label: "#d8dae8", rowHead: "#ffffff",
    border: "rgba(255,255,255,0.08)", borderStrong: "rgba(255,255,255,0.12)", borderFaint: "rgba(255,255,255,0.05)",
    green: "#78dca0", amber: "#ffbe50", blue: "#9ec4f5", red: "#ff9999", greenL: "#b8f0c8", amberL: "#ffce70",
    youBg: "rgba(255,190,80,0.08)", youBorder: "rgba(255,190,80,0.3)",
    tooltipBg: "#1a1d2e", tooltipBorder: "rgba(255,255,255,0.18)",
  },
  light: {
    bg: "#f6f7fb", panel: "#ffffff", card: "#ffffff", elev: "#f1f3f9", sideBg: "#fafbff", inputBg: "#ffffff",
    text: "#1f2238", textStrong: "#0a0d1e", muted: "#6a708a", subtle: "#8a8fa8", label: "#2a2e45", rowHead: "#1f2238",
    border: "rgba(15,20,40,0.12)", borderStrong: "rgba(15,20,40,0.22)", borderFaint: "rgba(15,20,40,0.06)",
    green: "#1f9f5c", amber: "#c27a10", blue: "#2a6ad1", red: "#c44141", greenL: "#4fbd7f", amberL: "#e09a2f",
    youBg: "rgba(194,122,16,0.1)", youBorder: "rgba(194,122,16,0.4)",
    tooltipBg: "#1f2238", tooltipBorder: "rgba(15,20,40,0.4)",
  },
};

/* ── TOOLTIP TEXT ── */
const TIPS = {
  roas: "Return on Ad Spend = Paid Revenue ÷ Ad Spend. A 2.5x ROAS means $2.50 in paid revenue for every $1 spent.",
  mer: "Marketing Efficiency Ratio = Total Revenue (paid + organic) ÷ Ad Spend. Shows how hard every ad dollar is working across the whole business.",
  ncCpa: "New Customer CPA = Ad Spend ÷ Number of New Paid Customers. What you pay to acquire one brand-new buyer.",
  ncRoas: "New Customer ROAS = New Customer Revenue ÷ Ad Spend. Strips out returning customer revenue to show pure acquisition efficiency.",
  cpa: "Cost Per Acquisition = Ad Spend ÷ Total Paid Orders (new + returning). Average cost of any order driven by ads.",
  ltvCac: "LTV : CAC = Lifetime Profit per Customer ÷ NC-CPA. Target 3x or higher. Below 1x means acquisition is structurally unprofitable.",
  payback: "Payback Months = how long it takes for repeat-order profit to close the gap between your NC-CPA and first-order profit.",
  ltvNet: "LTV-Adjusted Net = This month's net profit + projected future repeat profit from new customers acquired this month.",
  netProfit: "Net Profit = Total Revenue − COGS − Variable Costs − Ad Spend − Fixed Costs. The actual cash you keep each month.",
  contrib: "Contribution Margin = Gross Profit − Variable Costs − Ad Spend. What's left before paying fixed overhead (rent, payroll, SaaS).",
  aov: "Average Order Value = Total Revenue ÷ Number of Orders. The size of a typical basket.",
  grossMargin: "Gross Margin % = (Revenue − COGS) ÷ Revenue. Your product markup before shipping, fees, and ads.",
  beCpa1: "Breakeven NC-CPA (1st order) = max you can pay for a new customer and still profit on their very first purchase.",
  beCpaLtv: "Breakeven NC-CPA (LTV) = max you can pay for a new customer if you count their full lifetime repeat profit.",
  organic: "Organic revenue = non-paid channels (SEO, direct, email, referral). Held constant in the model — it subsidizes paid acquisition.",
  spendStep: "Each column of the grid goes up by this amount.",
  roasStep: "Each row of the grid goes up by this amount.",
  avgVarCost: "Share of revenue eaten by COGS + shipping + payment fees + other per-order costs.",
  currentNewCust: "Actual new paid customers per month. Overrides the model estimate so NC-CPA is your real one. Leave 0 to let the model estimate.",
  allSpendNC: "Treats all paid revenue as coming from brand-new customers. Useful if your paid channels (Meta prospecting, Google search for brand-new users) are strictly acquisition-focused.",
  roasDecay: "How much your blended ROAS drops as you scale from min to max spend in the grid. Models real-world CPM inflation — higher spend buys less-efficient traffic. Set to 0 for pure what-if view.",
  ltvMode: "Modelled: derive LTV from repeat rate + AOV + cycle. Known: plug in your actual cumulative LTV at 30/60/90/180/360 days — more accurate if you have cohort data.",
  ltvPeriod: "Cumulative revenue earned per new customer by this day. From your cohort analytics (Shopify, Lifetimely, Peel, etc).",
};

/* ── HEAT COLOR ── */
function hc(value, min, max, theme) {
  const isDark = theme === "dark";
  if (max === min) return isDark ? "rgba(100,100,120,0.12)" : "rgba(100,100,120,0.08)";
  if (value < 0) {
    const t = Math.min(1, Math.abs(value) / Math.max(1, Math.abs(min)));
    if (isDark) return `rgba(${Math.round(180 + 60 * t)},${Math.round(70 - 30 * t)},${Math.round(70 - 30 * t)},${0.18 + 0.55 * t})`;
    return `rgba(220, ${Math.round(130 - 60 * t)}, ${Math.round(130 - 60 * t)}, ${0.15 + 0.4 * t})`;
  }
  const t = Math.min(1, value / Math.max(1, max));
  if (isDark) return `rgba(${Math.round(40 + 20 * t)},${Math.round(110 + 120 * t)},${Math.round(70 + 40 * t)},${0.14 + 0.55 * t})`;
  return `rgba(${Math.round(90 - 40 * t)}, ${Math.round(180 + 15 * t)}, ${Math.round(130 - 20 * t)}, ${0.15 + 0.45 * t})`;
}

/* ── MODE DERIVATION ── */
function deriveEffective(I) {
  let out = { ...I };
  if (I.mode === "simplified") {
    const gm = Math.max(0, 100 - I.avgVarCostPct);
    const spendMin = I.spendMin;
    const steps = 8;
    const spendMax = spendMin + steps * I.spendStep;
    const roasMin = I.roasMin;
    const roasMax = roasMin + 8 * I.roasStep;
    out = {
      ...out,
      newAov: I.simpleAov,
      retAov: I.simpleAov,
      grossMarginPct: gm,
      shippingPerOrder: 0, processingPct: 0, otherVarPerOrder: 0, otherVarPctRevenue: 0,
      newCustPctBase: DEFAULTS.newCustPctBase, newCustPctAtMaxSpend: DEFAULTS.newCustPctAtMaxSpend,
      organicNewPct: DEFAULTS.organicNewPct,
      spendMin, spendMax, spendSteps: steps, roasMin, roasMax,
    };
  }
  if (I.allSpendOnNewCust) {
    out.newCustPctBase = 100;
    out.newCustPctAtMaxSpend = 100;
  }
  return out;
}

// Given LTV known mode, approximate monthly repeat profit and lifetime profit used downstream
function knownLtvDerivatives(I) {
  const gm = (I.grossMarginPct || 100) / 100;
  const proc = (I.processingPct || 0) / 100;
  const oVP = (I.otherVarPctRevenue || 0) / 100;
  const effMarginRate = gm - proc - oVP; // revenue → contribution margin rate
  // first-order profit roughly = new AOV * effMargin - (shipping + other per-order)
  const oVO = (I.shippingPerOrder || 0) + (I.otherVarPerOrder || 0);
  const firstOrderProfit = Math.max(0, I.newAov * effMarginRate - oVO);

  const revPeriods = [I.ltv30, I.ltv60, I.ltv90, I.ltv180, I.ltv360];
  const daysPeriods = [30, 60, 90, 180, 360];

  // Lifetime profit = ltv360 * effMargin − approximate per-order variable costs accrued.
  // Simplified: apply margin to the ltv360 revenue; that's our lifetime profit per new customer.
  const ltv360 = I.ltv360 || 0;
  const lifetimeProfit = Math.max(0, ltv360 * effMarginRate - oVO); // treat the "other per-order" as a single overhead on the cohort

  // Future repeat profit only = ltv360 profit − first order profit
  const futureRepeatProfitPerCust = Math.max(0, lifetimeProfit - firstOrderProfit);

  // Average months realized (rough: profit-weighted midpoint of the cumulative schedule)
  const ltvMonths = 12;

  // Monthly repeat profit rate per customer (used for payback math)
  // = futureRepeatProfitPerCust / 12 months
  const monthlyRepeatProfitPerCust = futureRepeatProfitPerCust / 12;

  return { firstOrderProfit, lifetimeProfit, futureRepeatProfitPerCust, ltvMonths, monthlyRepeatProfitPerCust, revPeriods, daysPeriods };
}

/* ── ENGINE ── */
function scaleAdjRoas(baseRoas, spend, spendMin, spendMax, decayPct) {
  if (!decayPct || spendMax <= spendMin) return baseRoas;
  const t = Math.max(0, Math.min(1, (spend - spendMin) / (spendMax - spendMin)));
  const factor = 1 - (decayPct / 100) * t;
  return baseRoas * factor;
}

function computeCell(I, spend, roas, spendMin, spendMax, context) {
  const { oContrib, nOP, rOP, expRepeats, ltvP, monthlyRepeatProfitPerCust, ltvMonthsKnown, knownMode } = context;
  const eRoas = scaleAdjRoas(roas, spend, spendMin, spendMax, I.roasDecayPct);
  const t = spendMax > spendMin ? Math.max(0, Math.min(1, (spend - spendMin) / (spendMax - spendMin))) : 0;
  const nP = (I.newCustPctBase + t * (I.newCustPctAtMaxSpend - I.newCustPctBase)) / 100;
  const pAov = nP * I.newAov + (1 - nP) * I.retAov;
  const pR = spend * eRoas, tR = pR + I.monthlyOrganicRevenue, mer = spend > 0 ? tR / spend : 0;
  const pO = pAov > 0 ? pR / pAov : 0;
  const pNO = pO * nP, pRO = pO * (1 - nP);
  const ncCpa = pNO > 0 ? spend / pNO : Infinity;
  const cpa = pO > 0 ? spend / pO : Infinity;
  const ncRoas = pNO > 0 ? (pNO * I.newAov) / spend : 0;
  const pC = pNO * nOP + pRO * rOP - spend;
  const tC = pC + oContrib, net = tC - I.monthlyFixedCosts;
  const futRP = knownMode ? pNO * context.futureRepeatProfitPerCust : pNO * expRepeats * rOP;
  const ltvNet = net + futRP;
  const gap = ncCpa - nOP;
  let pbMo = 0;
  if (gap > 0) {
    if (knownMode && monthlyRepeatProfitPerCust > 0) {
      pbMo = gap / monthlyRepeatProfitPerCust;
    } else if (rOP > 0 && I.avgRepeatCycleMonths > 0) {
      const mRP = rOP / I.avgRepeatCycleMonths * (I.repeatRate / 100);
      pbMo = mRP > 0 ? gap / mRP : Infinity;
    }
  }
  const ltcac = ncCpa > 0 && isFinite(ncCpa) ? ltvP / ncCpa : 0;
  return { spend, roas, eRoas, paidRev: pR, totalRev: tR, mer, paidOrders: pO, paidNewOrders: pNO, paidRetOrders: pRO, ncCpa, cpa, ncRoas, paidContrib: pC, totalContrib: tC, netProfit: net, ltvAdjustedNet: ltvNet, futureRepeatProfit: futRP, paybackMonths: pbMo, ltvCac: ltcac, newPct: nP };
}

function compute(I, roasVals, spendVals) {
  const gm = I.grossMarginPct / 100, proc = I.processingPct / 100, oVP = I.otherVarPctRevenue / 100, oVO = I.shippingPerOrder + I.otherVarPerOrder;
  const ppo = (aov) => aov * gm - aov * proc - aov * oVP - oVO;
  const nOP = ppo(I.newAov), rOP = ppo(I.retAov);
  const knownMode = I.ltvMode === "known";
  const known = knownLtvDerivatives(I);
  const expRepeats = (I.repeatRate / 100) * I.avgOrdersPerRepeater;
  const ltvP = knownMode ? known.lifetimeProfit : nOP + expRepeats * rOP;
  const ltvR = knownMode ? I.ltv360 : I.newAov + expRepeats * I.retAov;
  const ltvMonths = knownMode ? 12 : expRepeats * I.avgRepeatCycleMonths;
  const beCpa1 = nOP, beCpaLtv = ltvP;

  const oR = I.monthlyOrganicRevenue, oNP = I.organicNewPct / 100;
  const oAov = oNP * I.newAov + (1 - oNP) * I.retAov;
  const oOrd = oR > 0 && oAov > 0 ? oR / oAov : 0;
  const oNew = oOrd * oNP, oRet = oOrd * (1 - oNP);
  const oContrib = oNew * nOP + oRet * rOP;

  const ctx = {
    oContrib, nOP, rOP, expRepeats, ltvP,
    knownMode,
    futureRepeatProfitPerCust: known.futureRepeatProfitPerCust,
    monthlyRepeatProfitPerCust: known.monthlyRepeatProfitPerCust,
    ltvMonthsKnown: known.ltvMonths,
  };

  const spendMin = spendVals[0] ?? I.spendMin;
  const spendMax = spendVals[spendVals.length - 1] ?? I.spendMax;

  // grid[ri][si]
  const grid = roasVals.map(roas => spendVals.map(spend => computeCell(I, spend, roas, spendMin, spendMax, ctx)));

  // Current (exact inputs, with optional newCust override)
  const curRaw = computeCell(I, I.currentSpend, I.currentRoas, spendMin, spendMax, ctx);
  let current = curRaw;
  if (I.currentNewCustomers > 0) {
    const pNO = I.currentNewCustomers;
    const pRO = Math.max(0, curRaw.paidOrders - pNO);
    const ncCpa = pNO > 0 ? I.currentSpend / pNO : Infinity;
    const ncRoas = pNO > 0 ? (pNO * I.newAov) / I.currentSpend : 0;
    const pC = pNO * nOP + pRO * rOP - I.currentSpend;
    const tC = pC + oContrib, net = tC - I.monthlyFixedCosts;
    const futRP = knownMode ? pNO * known.futureRepeatProfitPerCust : pNO * expRepeats * rOP;
    const gap = ncCpa - nOP;
    let pbMo = 0;
    if (gap > 0) {
      if (knownMode && known.monthlyRepeatProfitPerCust > 0) pbMo = gap / known.monthlyRepeatProfitPerCust;
      else if (rOP > 0 && I.avgRepeatCycleMonths > 0) {
        const mRP = rOP / I.avgRepeatCycleMonths * (I.repeatRate / 100);
        pbMo = mRP > 0 ? gap / mRP : Infinity;
      }
    }
    const ltcac = ncCpa > 0 && isFinite(ncCpa) ? ltvP / ncCpa : 0;
    current = { ...curRaw, paidNewOrders: pNO, paidRetOrders: pRO, ncCpa, ncRoas, paidContrib: pC, totalContrib: tC, netProfit: net, ltvAdjustedNet: net + futRP, futureRepeatProfit: futRP, paybackMonths: pbMo, ltvCac: ltcac };
  }

  let nearestRi = 0, nearestSi = 0, nearestD = Infinity;
  roasVals.forEach((r, ri) => spendVals.forEach((sv, si) => {
    const ds = Math.abs(sv - I.currentSpend) / Math.max(1, spendMax - spendMin);
    const roasRange = (roasVals[roasVals.length - 1] || 1) - (roasVals[0] || 0);
    const dr = Math.abs(r - I.currentRoas) / Math.max(0.01, roasRange);
    const d = ds * ds + dr * dr;
    if (d < nearestD) { nearestD = d; nearestRi = ri; nearestSi = si; }
  }));

  return { grid, nOP, rOP, ltvP, ltvR, expRepeats, ltvMonths, beCpa1, beCpaLtv, oContrib, oR, oOrd, oNew, current, nearestRi, nearestSi, known, knownMode };
}

/* ── TOOLTIP ── */
function Tip({ text, T, inline }) {
  const [show, setShow] = useState(false);
  return (
    <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)} tabIndex={0}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: T.border, color: T.muted, fontSize: 9, fontWeight: 700, marginLeft: inline ? 4 : 6, cursor: "help", position: "relative", verticalAlign: "middle", lineHeight: 1 }}>
      ?
      {show && (
        <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: T.tooltipBg, border: `1.5px solid ${T.tooltipBorder}`, borderRadius: 7, padding: "9px 11px", fontSize: 12, lineHeight: 1.5, color: "#ffffff", width: 240, zIndex: 100, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", fontWeight: 500, textAlign: "left", pointerEvents: "none", fontFamily: "var(--h)" }}>
          {text}
        </span>
      )}
    </span>
  );
}

/* ── INPUT (select-on-focus, arrow or typing) ── */
function Inp({ label, value, onChange, pre, suf, step, min, max, tip, help, T }) {
  const selectAll = e => e.target.select();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: T.label, letterSpacing: "0.01em", display: "flex", alignItems: "center" }}>
        {label}{tip && <Tip text={tip} T={T} />}
      </label>
      <div style={{ display: "flex", alignItems: "center", background: T.inputBg, border: `1.5px solid ${T.border}`, borderRadius: 7, padding: "7px 9px", gap: 4 }}>
        {pre && <span style={{ color: T.muted, fontSize: 14, fontWeight: 600 }}>{pre}</span>}
        <input type="number" value={value} onChange={e => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))} onFocus={selectAll} onClick={selectAll} step={step || 1} min={min} max={max}
          style={{ background: "transparent", border: "none", outline: "none", color: T.textStrong, fontSize: 15, fontWeight: 600, width: "100%", fontFamily: "var(--m)" }} />
        {suf && <span style={{ color: T.muted, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{suf}</span>}
      </div>
      {help && <span style={{ fontSize: 11, color: T.muted, lineHeight: 1.4 }}>{help}</span>}
    </div>
  );
}

function Sec({ label, open, onToggle, children, badge, sub, accent, T }) {
  const bg = accent === "you" ? T.youBg : T.card;
  const border = accent === "you" ? T.youBorder : T.border;
  const arrow = accent === "you" ? T.amber : T.green;
  return (
    <div style={{ marginBottom: 8, background: bg, borderRadius: 9, border: `1.5px solid ${border}`, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: "11px 13px", width: "100%", textAlign: "left" }}>
        <span style={{ fontSize: 11, color: arrow, transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block", fontWeight: 700 }}>▶</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.textStrong, letterSpacing: "-0.01em" }}>{label}</span>
            {badge && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: accent === "you" ? "rgba(255,190,80,0.15)" : "rgba(120,220,160,0.14)", color: accent === "you" ? T.amber : T.green, fontFamily: "var(--m)", fontWeight: 700, letterSpacing: "0.05em" }}>{badge}</span>}
          </div>
          {sub && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{sub}</div>}
        </div>
      </button>
      {open && <div style={{ padding: "12px 14px 14px" }}>{children}</div>}
    </div>
  );
}

function MetPill({ label, tip, value, sub, color, you, T }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 7, background: you ? T.youBg : T.card, border: `1px solid ${you ? T.youBorder : T.border}`, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: you ? T.amber : T.muted, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "var(--m)", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {you && <span style={{ marginRight: 4 }}>●</span>}{label}{tip && <Tip text={tip} T={T} />}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || T.textStrong, letterSpacing: "-0.015em", lineHeight: 1.2, fontFamily: "var(--h)", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function LD({ color, label, T }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: color }} /><span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{label}</span></div>;
}

function Toggle({ on, onChange, label, tip, T }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
      <span onClick={() => onChange(!on)} style={{ width: 36, height: 20, borderRadius: 12, background: on ? T.green : T.border, position: "relative", transition: "all .15s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </span>
      <span style={{ fontSize: 12.5, color: T.label, fontWeight: 600, display: "flex", alignItems: "center" }}>{label}{tip && <Tip text={tip} T={T} />}</span>
    </label>
  );
}

function MP({ options, value, onChange, multi = true, T }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([k, label, tip]) => {
        const active = multi ? value.includes(k) : value === k;
        return (
          <button key={k} onClick={() => {
            if (multi) onChange(value.includes(k) ? value.filter(v => v !== k) : [...value, k]);
            else onChange(k);
          }} style={{
            padding: "6px 11px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
            border: "1.5px solid", borderColor: active ? T.green : T.border,
            background: active ? "rgba(120,220,160,0.15)" : T.card,
            color: active ? T.green : T.muted, display: "inline-flex", alignItems: "center", fontFamily: "var(--h)"
          }}>
            {label}{tip && <span style={{ marginLeft: 5 }}><Tip text={tip} T={T} inline /></span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── PRIMARY TABLE (ROAS rows × Spend cols) ── */
function PrimaryTable({ engine, roasVals, spendVals, primaryMetric, overlayMode, beCpa1, beCpaLtv, onSelect, selected, T }) {
  const { grid, nearestRi, nearestSi } = engine;
  const all = grid.flat().map(c => c[primaryMetric === "contrib" ? "totalContrib" : "netProfit"]);
  const mn = Math.min(...all), mx = Math.max(...all);
  let pV = -Infinity, pRi = -1, pSi = -1;
  grid.forEach((row, ri) => row.forEach((c, si) => {
    const v = c[primaryMetric === "contrib" ? "totalContrib" : "netProfit"];
    if (v > pV) { pV = v; pRi = ri; pSi = si; }
  }));
  const overlayCell = (c) => {
    switch (overlayMode) {
      case "ncCpa": return <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>NC-CPA <b style={{ color: c.ncCpa > beCpaLtv ? T.red : c.ncCpa > beCpa1 ? T.amber : T.green }}>{fmt(c.ncCpa)}</b></div>;
      case "mer": return <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>MER <b style={{ color: T.blue }}>{fmtX(c.mer)}</b></div>;
      case "ncRoas": return <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>NC-ROAS <b style={{ color: T.text }}>{fmtX(c.ncRoas)}</b></div>;
      case "newOrders": return <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{fmtInt(c.paidNewOrders)} new</div>;
      case "eRoas": return <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>Effective <b style={{ color: T.text }}>{fmtX(c.eRoas)}</b></div>;
      default: return null;
    }
  };

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: `1.5px solid ${T.border}` }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
        <thead><tr>
          <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "10px 12px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 10.5, fontWeight: 700, color: T.text, textAlign: "left", minWidth: 85, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
            <div style={{ fontSize: 9.5, color: T.muted, marginBottom: 2 }}>ROAS ↓</div>
            <div>Spend →</div>
          </th>
          {spendVals.map(sv => <th key={sv} style={{ padding: "10px 8px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 12.5, fontWeight: 700, color: T.textStrong, textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{fmt(sv)}</th>)}
        </tr></thead>
        <tbody>
          {roasVals.map((roas, ri) => (
            <tr key={roas}>
              <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "8px 12px", background: T.elev, borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12.5, fontWeight: 700, color: T.textStrong, whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{roas.toFixed(2)}x</td>
              {spendVals.map((sv, si) => {
                const c = grid[ri][si];
                const v = primaryMetric === "contrib" ? c.totalContrib : c.netProfit;
                const isPeak = ri === pRi && si === pSi;
                const isYou = ri === nearestRi && si === nearestSi;
                const isSel = selected && selected.ri === ri && selected.si === si;
                return (
                  <td key={sv} onClick={() => onSelect && onSelect({ ri, si, c })}
                    style={{ padding: "8px 6px", textAlign: "center", background: hc(v, mn, mx, T === THEMES.dark ? "dark" : "light"), borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12.5, fontWeight: (isPeak || isYou || isSel) ? 800 : 600, color: v < 0 ? T.red : T.textStrong, whiteSpace: "nowrap", outline: isSel ? `2.5px solid ${T.blue}` : isYou ? `2.5px solid ${T.amber}` : isPeak ? `2.5px solid ${T.green}` : "none", outlineOffset: -2, position: "relative", fontFamily: "var(--m)", cursor: "pointer" }}>
                    {fmt(v)}
                    {overlayCell(c)}
                    {isPeak && !isYou && !isSel && <div style={{ position: "absolute", top: 1, right: 3, fontSize: 8.5, color: T.green, fontWeight: 800 }}>★</div>}
                    {isYou && !isSel && <div style={{ position: "absolute", top: 1, right: 3, fontSize: 8.5, color: T.amber, fontWeight: 800 }}>●</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── CELL DETAIL PANEL ── */
function CellDetail({ cell, engine, T }) {
  if (!cell) {
    return (
      <div style={{ padding: "20px 18px", borderRadius: 9, background: T.card, border: `1.5px dashed ${T.border}`, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
        <div style={{ fontSize: 13, color: T.text, fontWeight: 600, marginBottom: 4 }}>Click any cell</div>
        <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5, maxWidth: 180 }}>See the full acquisition, revenue, and profit breakdown for that scenario.</div>
      </div>
    );
  }
  const c = cell.c;
  const { beCpa1, beCpaLtv } = engine;
  const zone = c.ncCpa > beCpaLtv ? "Above LTV BE" : c.ncCpa > beCpa1 ? "LTV zone" : "Under 1st-order BE";
  const zoneColor = c.ncCpa > beCpaLtv ? T.red : c.ncCpa > beCpa1 ? T.amber : T.green;

  const Row = ({ label, value, tip, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${T.borderFaint}` }}>
      <span style={{ fontSize: 11.5, color: T.muted, display: "flex", alignItems: "center", fontFamily: "var(--m)" }}>{label}{tip && <Tip text={tip} T={T} />}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: color || T.textStrong, fontFamily: "var(--m)" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: "14px 16px", borderRadius: 9, background: T.card, border: `1.5px solid ${T.border}` }}>
      <div style={{ borderBottom: `1.5px solid ${T.border}`, paddingBottom: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--m)", marginBottom: 2 }}>Scenario breakdown</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: T.textStrong }}>{fmt(c.spend)} @ {fmtX(c.roas)}</div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{fmt(c.paidRev)} paid rev · {fmt(c.totalRev)} total{c.eRoas !== c.roas ? ` · eff. ${fmtX(c.eRoas)}` : ""}</div>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Acquisition</div>
      <Row label="NC-CPA" tip={TIPS.ncCpa} value={fmt(c.ncCpa)} color={zoneColor} />
      <Row label="Zone" value={zone} color={zoneColor} />
      <Row label="CPA" tip={TIPS.cpa} value={fmt(c.cpa)} />
      <Row label="NC-ROAS" tip={TIPS.ncRoas} value={fmtX(c.ncRoas)} />
      <Row label="MER" tip={TIPS.mer} value={fmtX(c.mer)} color={T.blue} />
      <Row label="New orders / mo" value={fmtInt(c.paidNewOrders)} />
      <Row label="Repeat orders / mo" value={fmtInt(c.paidRetOrders)} />

      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px", fontFamily: "var(--m)" }}>Profit</div>
      <Row label="Contribution" tip={TIPS.contrib} value={fmt(c.totalContrib)} color={T.green} />
      <Row label="Net Profit" tip={TIPS.netProfit} value={fmtFull(c.netProfit)} color={c.netProfit > 0 ? T.green : T.red} />
      <Row label="LTV-Adj. Net" tip={TIPS.ltvNet} value={fmt(c.ltvAdjustedNet)} color={T.blue} />

      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px", fontFamily: "var(--m)" }}>LTV health</div>
      <Row label="LTV:CAC" tip={TIPS.ltvCac} value={fmtX(c.ltvCac)} color={c.ltvCac >= 3 ? T.green : c.ltvCac >= 1 ? T.amber : T.red} />
      <Row label="Payback" tip={TIPS.payback} value={c.paybackMonths <= 0 ? "Instant" : !isFinite(c.paybackMonths) ? "Never" : `${c.paybackMonths.toFixed(1)}mo`} />
    </div>
  );
}

/* ── LTV CHART (multi-metric table) ── */
function LtvChart({ engine, roasVals, spendVals, T }) {
  const { grid, nearestRi, nearestSi } = engine;
  const [metrics, setMetrics] = useState(["payback", "ltvCac", "ltvNet"]);
  const metricDefs = {
    payback: { short: "Payback", fmt: v => v <= 0 ? "Instant" : !isFinite(v) ? "Never" : `${v.toFixed(1)}mo`, get: c => c.paybackMonths, colorFn: c => c.paybackMonths <= 0 ? T.greenL : c.paybackMonths > 12 || !isFinite(c.paybackMonths) ? T.red : c.paybackMonths > 6 ? T.amberL : T.greenL },
    ltvCac: { short: "LTV:CAC", fmt: fmtX, get: c => c.ltvCac, colorFn: c => c.ltvCac >= 3 ? T.greenL : c.ltvCac >= 1 ? T.amberL : T.red },
    ltvNet: { short: "LTV Net", fmt: fmt, get: c => c.ltvAdjustedNet, colorFn: c => c.ltvAdjustedNet < 0 ? T.red : T.blue },
    futureProfit: { short: "Future Rpt", fmt: fmt, get: c => c.futureRepeatProfit, colorFn: () => T.greenL },
  };
  const cellBgFn = c => {
    const pbBad = c.paybackMonths > 12 || !isFinite(c.paybackMonths);
    const pbWarn = c.paybackMonths > 6;
    return pbBad ? "rgba(200,60,60,0.1)" : pbWarn ? "rgba(255,190,80,0.06)" : "rgba(60,180,100,0.06)";
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
          LTV, Payback & Efficiency<Tip text="How long it takes to recover your customer acquisition cost, and how much lifetime profit you earn per acquisition dollar." T={T} />
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: T.text }}>Short payback + LTV:CAC ≥ 3× is the sweet spot.</p>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontFamily: "var(--m)" }}>Show in cells</div>
        <MP T={T} options={[
          ["payback", "Payback", TIPS.payback],
          ["ltvCac", "LTV:CAC", TIPS.ltvCac],
          ["ltvNet", "LTV Net", TIPS.ltvNet],
          ["futureProfit", "Future Repeat $", "Projected future repeat profit from customers acquired this month."],
        ]} value={metrics} onChange={setMetrics} />
      </div>

      <div style={{ overflowX: "auto", borderRadius: 8, border: `1.5px solid ${T.border}` }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "10px 12px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 10.5, fontWeight: 700, color: T.text, textAlign: "left", minWidth: 85, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
              <div style={{ fontSize: 9.5, color: T.muted, marginBottom: 2 }}>ROAS ↓</div>
              <div>Spend →</div>
            </th>
            {spendVals.map(sv => <th key={sv} style={{ padding: "10px 8px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 12.5, fontWeight: 700, color: T.textStrong, textAlign: "center", fontFamily: "var(--m)" }}>{fmt(sv)}</th>)}
          </tr></thead>
          <tbody>
            {roasVals.map((roas, ri) => (
              <tr key={roas}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "8px 12px", background: T.elev, borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12.5, fontWeight: 700, color: T.textStrong, fontFamily: "var(--m)" }}>{roas.toFixed(2)}x</td>
                {spendVals.map((sv, si) => {
                  const c = grid[ri][si];
                  const isY = ri === nearestRi && si === nearestSi;
                  return (
                    <td key={sv} style={{ padding: "8px 10px", borderBottom: `1px solid ${T.borderFaint}`, background: cellBgFn(c), fontFamily: "var(--m)", fontSize: 11.5, lineHeight: 1.65, textAlign: "left", outline: isY ? `2.5px solid ${T.amber}` : "none", outlineOffset: -2, position: "relative" }}>
                      {isY && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: T.amber, fontWeight: 800 }}>●</div>}
                      {metrics.map(mk => {
                        const def = metricDefs[mk]; if (!def) return null;
                        return (<div key={mk}><span style={{ color: T.muted }}>{def.short} </span><span style={{ color: def.colorFn(c), fontWeight: 700 }}>{def.fmt(def.get(c))}</span></div>);
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        <LD T={T} color={T.greenL} label="Strong — Instant / LTV:CAC ≥ 3×" />
        <LD T={T} color={T.amberL} label="Viable — 6–12mo / 1–3×" />
        <LD T={T} color={T.red} label="Weak — 12mo+ / < 1×" />
      </div>
    </div>
  );
}

/* ── LTV BUILD-UP TABLE (known-LTV mode) ── */
function LtvBuildupTable({ I, engine, T }) {
  const gm = (I.grossMarginPct || 100) / 100;
  const proc = (I.processingPct || 0) / 100;
  const oVP = (I.otherVarPctRevenue || 0) / 100;
  const effRate = gm - proc - oVP;
  const periods = [
    { label: "Day 30", days: 30, rev: I.ltv30 },
    { label: "Day 60", days: 60, rev: I.ltv60 },
    { label: "Day 90", days: 90, rev: I.ltv90 },
    { label: "Day 180", days: 180, rev: I.ltv180 },
    { label: "Day 360", days: 360, rev: I.ltv360 },
  ];
  const ncCpa = engine.current.ncCpa;

  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800, color: T.textStrong, display: "flex", alignItems: "center" }}>
        Cohort LTV Build-up<Tip text="Cumulative revenue and profit per new customer over time. Shows when the cohort repays your current NC-CPA." T={T} />
      </h3>
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1.5px solid ${T.border}` }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
          <thead>
            <tr>
              {["Period", "Cum. Revenue", "Cum. Profit", "vs NC-CPA", "Status"].map((h, i) => (
                <th key={i} style={{ padding: "10px 12px", background: T.elev, borderBottom: `2px solid ${T.borderStrong}`, fontSize: 11, fontWeight: 700, color: T.text, textAlign: i < 2 ? "left" : "right", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => {
              const profit = Math.max(0, p.rev * effRate - (I.shippingPerOrder || 0) - (I.otherVarPerOrder || 0));
              const coverage = isFinite(ncCpa) && ncCpa > 0 ? profit / ncCpa : 0;
              const paidBack = profit >= ncCpa;
              return (
                <tr key={p.days}>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, fontWeight: 700, color: T.textStrong, fontFamily: "var(--m)" }}>{p.label}</td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, color: T.text, fontFamily: "var(--m)" }}>{fmt(p.rev)}</td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, color: T.green, fontWeight: 700, textAlign: "right", fontFamily: "var(--m)" }}>{fmt(profit)}</td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 13, color: T.text, textAlign: "right", fontFamily: "var(--m)" }}>{(coverage * 100).toFixed(0)}%</td>
                  <td style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderFaint}`, fontSize: 12, fontWeight: 800, textAlign: "right", fontFamily: "var(--m)", color: paidBack ? T.green : T.amber }}>{paidBack ? "✓ Paid back" : "In payback"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11.5, color: T.muted, margin: "8px 0 0", lineHeight: 1.5 }}>Profit = cumulative revenue × ({(effRate * 100).toFixed(0)}% variable margin) − per-order costs. Shows when repeat revenue recovers your current NC-CPA of <b style={{ color: T.textStrong }}>{fmt(ncCpa)}</b>.</p>
    </div>
  );
}

/* ── SCALE CURVES (fixed: uses effective ROAS decay for diminishing returns) ── */
function CurveChart({ engine, roasVals, spendVals, T, decayOn }) {
  const { grid, nearestRi, nearestSi, current } = engine;
  const W = 820, H = 420, padL = 70, padR = 30, padT = 30, padB = 60;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const allNet = grid.flat().map(c => c.netProfit);
  const yMin = Math.min(0, ...allNet), yMax = Math.max(...allNet);
  const xMin = spendVals[0], xMax = spendVals[spendVals.length - 1];
  const x = v => padL + ((v - xMin) / Math.max(1, xMax - xMin)) * plotW;
  const y = v => padT + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH;

  const step = roasVals.length > 6 ? Math.ceil(roasVals.length / 6) : 1;
  const shownRoas = roasVals.filter((_, i) => i % step === 0 || i === roasVals.length - 1);

  // Vibrant palette that scales from warm (low ROAS) to cool (high ROAS)
  const palette = ["#ff6b6b", "#ff9f43", "#feca57", "#78dca0", "#4ecdc4", "#5f9ef7", "#a78bfa"];
  const lineColor = (idx, total) => {
    const t = total > 1 ? idx / (total - 1) : 0;
    const p = Math.floor(t * (palette.length - 1));
    return palette[p];
  };

  const peaks = shownRoas.map(roas => {
    const ri = roasVals.indexOf(roas);
    let peak = null;
    grid[ri].forEach(c => { if (!peak || c.netProfit > peak.netProfit) peak = c; });
    return { roas, peak, ri };
  });

  let gPeak = null;
  grid.forEach(row => row.forEach(c => { if (!gPeak || c.netProfit > gPeak.netProfit) gPeak = c; }));

  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * (yMax - yMin));

  const axisColor = T === THEMES.dark ? "rgba(255,255,255,0.08)" : "rgba(20,30,60,0.08)";
  const gridColor = T === THEMES.dark ? "rgba(255,255,255,0.04)" : "rgba(20,30,60,0.04)";

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
          Scale vs. Efficiency Curves<Tip text="Each line shows how net profit changes as you scale spend at a fixed starting ROAS. With ROAS Decay turned on, curves bend and roll over — diminishing returns visualized." T={T} />
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: T.text }}>
          {decayOn ? "Curves flatten or peak where extra spend costs more than it earns." : "Turn on ROAS Decay (sidebar) to see realistic diminishing returns. Without it, curves are linear by definition."}
        </p>
      </div>
      <div style={{ borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.card, padding: 14 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {/* horizontal grid lines */}
          {yTickVals.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={Math.abs(v) < 1 ? axisColor : gridColor} strokeWidth={Math.abs(v) < 1 ? 1.5 : 1} strokeDasharray={Math.abs(v) < 1 ? "5 4" : "none"} />
              <text x={padL - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill={T.muted} fontFamily="JetBrains Mono">{fmt(v)}</text>
            </g>
          ))}
          {/* vertical grid lines */}
          {spendVals.map((sv, i) => (
            <g key={i}>
              <line x1={x(sv)} x2={x(sv)} y1={padT} y2={H - padB} stroke={gridColor} strokeWidth={1} />
              <text x={x(sv)} y={H - padB + 20} textAnchor="middle" fontSize={11} fill={T.muted} fontFamily="JetBrains Mono">{fmt(sv)}</text>
            </g>
          ))}
          <text x={padL + plotW / 2} y={H - 8} textAnchor="middle" fontSize={13} fill={T.text} fontWeight={700}>Monthly Ad Spend</text>
          <text x={20} y={padT + plotH / 2} textAnchor="middle" fontSize={13} fill={T.text} fontWeight={700} transform={`rotate(-90 20 ${padT + plotH / 2})`}>Net Profit</text>

          {/* Smooth lines via Catmull-Rom-ish quadratic approximation */}
          {shownRoas.map((roas, idx) => {
            const ri = roasVals.indexOf(roas);
            const col = lineColor(idx, shownRoas.length);
            const pts = spendVals.map((sv, si) => ({ x: x(sv), y: y(grid[ri][si].netProfit) }));
            let d = `M ${pts[0].x} ${pts[0].y}`;
            for (let i = 1; i < pts.length; i++) {
              const p0 = pts[i - 1], p1 = pts[i];
              const cx = (p0.x + p1.x) / 2;
              d += ` Q ${cx} ${p0.y} ${cx} ${(p0.y + p1.y) / 2} T ${p1.x} ${p1.y}`;
            }
            return <path key={roas} d={d} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.92} />;
          })}

          {/* Per-line peak dots */}
          {peaks.map(({ roas, peak }, idx) => {
            const col = lineColor(idx, shownRoas.length);
            return <circle key={`pk-${roas}`} cx={x(peak.spend)} cy={y(peak.netProfit)} r={4.5} fill={col} stroke={T.bg} strokeWidth={2} />;
          })}

          {/* Global peak ring + label */}
          {gPeak && (
            <g>
              <circle cx={x(gPeak.spend)} cy={y(gPeak.netProfit)} r={10} fill="none" stroke={T.green} strokeWidth={2.5} />
              <rect x={x(gPeak.spend) - 50} y={y(gPeak.netProfit) - 32} width={100} height={18} rx={4} fill={T.elev} stroke={T.green} />
              <text x={x(gPeak.spend)} y={y(gPeak.netProfit) - 18} textAnchor="middle" fontSize={11} fill={T.green} fontWeight={800} fontFamily="JetBrains Mono">★ PEAK {fmt(gPeak.netProfit)}</text>
            </g>
          )}

          {/* YOU marker */}
          <g>
            <circle cx={x(current.spend)} cy={y(current.netProfit)} r={7} fill={T.amber} stroke={T.bg} strokeWidth={2.5} />
            <rect x={x(current.spend) - 32} y={y(current.netProfit) + 14} width={64} height={18} rx={4} fill={T.elev} stroke={T.amber} />
            <text x={x(current.spend)} y={y(current.netProfit) + 28} textAnchor="middle" fontSize={11} fill={T.amber} fontWeight={800} fontFamily="JetBrains Mono">● YOU</text>
          </g>

          {/* Legend */}
          <g transform={`translate(${W - padR - 110}, ${padT + 5})`}>
            <rect x={0} y={0} width={105} height={shownRoas.length * 16 + 10} rx={5} fill={T.elev} stroke={T.border} />
            {shownRoas.map((roas, i) => {
              const col = lineColor(i, shownRoas.length);
              return (
                <g key={roas} transform={`translate(8, ${12 + i * 16})`}>
                  <line x1={0} x2={16} y1={4} y2={4} stroke={col} strokeWidth={3} />
                  <text x={20} y={8} fontSize={11} fill={T.text} fontFamily="JetBrains Mono" fontWeight={600}>{roas.toFixed(2)}x ROAS</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p style={{ fontSize: 12, color: T.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
        💡 <b style={{ color: T.text }}>Read the curves:</b> a flat or declining line means you've hit diminishing returns — every extra dollar of spend earns less (or loses money).
        {!decayOn && <> Enable <b style={{ color: T.amber }}>ROAS Decay</b> in the sidebar to model realistic CPM inflation at scale.</>}
      </p>
    </div>
  );
}

/* ── SOCIAL ENVIRO RECOMMENDATIONS ── */
function Recs({ engine, I, T }) {
  const { current, grid, beCpa1, beCpaLtv } = engine;
  let pN = -Infinity, pkCell = null;
  grid.forEach(row => row.forEach(c => { if (c.netProfit > pN) { pN = c.netProfit; pkCell = c; } }));

  const recs = [];
  const status = current.netProfit > 0 ? "profitable" : current.ltvAdjustedNet > 0 ? "break-even long-term" : "losing money";
  const statusColor = current.netProfit > 0 ? T.green : current.ltvAdjustedNet > 0 ? T.amber : T.red;
  recs.push({ i: "📍", tone: "info", title: "Where you are now", t: <>At <b>{fmt(current.spend)}/mo</b> spend and <b>{fmtX(current.roas)}</b> ROAS{I.currentNewCustomers > 0 && <> with <b>{fmtInt(I.currentNewCustomers)}</b> new customers</>}, you're <b style={{ color: statusColor }}>{status}</b>. Net <b>{fmtFull(current.netProfit)}</b>, NC-CPA <b>{fmt(current.ncCpa)}</b>, MER <b>{fmtX(current.mer)}</b>, payback <b>{current.paybackMonths <= 0 ? "instant" : !isFinite(current.paybackMonths) ? "never" : `${current.paybackMonths.toFixed(1)}mo`}</b>.</> });

  const peakDelta = pN - current.netProfit;
  if (peakDelta > 100 && pkCell) {
    const spendShift = pkCell.spend - current.spend;
    const roasShift = pkCell.roas - current.roas;
    const direction = spendShift > 0 ? "scale up" : spendShift < 0 ? "pull back" : "hold spend";
    recs.push({ i: "🎯", tone: "good", title: "Biggest opportunity", t: <>Peak is <b>{fmtFull(pN)}</b> at <b>{fmt(pkCell.spend)} @ {fmtX(pkCell.roas)}</b> — <b style={{ color: T.green }}>{fmtFull(peakDelta)}/mo more</b>. Direction: {direction}{spendShift !== 0 && <> <b>{fmt(Math.abs(spendShift))}</b></>}{roasShift > 0 ? <>, lift ROAS by <b>{roasShift.toFixed(2)}x</b></> : roasShift < 0 ? <>, accept ROAS dip of <b>{Math.abs(roasShift).toFixed(2)}x</b></> : ""}.</> });
  }

  if (current.ncCpa > beCpaLtv) {
    recs.push({ i: "🚨", tone: "bad", title: "NC-CPA above LTV", t: <>You pay <b style={{ color: T.red }}>{fmt(current.ncCpa)}</b>; LTV breakeven is <b>{fmt(beCpaLtv)}</b>. Priority: raise AOV, repeat rate, or creative efficiency before scaling.</> });
  } else if (current.ncCpa > beCpa1) {
    recs.push({ i: "⏳", tone: "warn", title: "Buying future profit", t: <>NC-CPA ({fmt(current.ncCpa)}) sits between 1st-order BE ({fmt(beCpa1)}) and LTV BE ({fmt(beCpaLtv)}). Need <b>{current.paybackMonths.toFixed(1)} months</b> of runway.</> });
  } else {
    recs.push({ i: "💪", tone: "good", title: "NC-CPA comfortable", t: <>At <b>{fmt(current.ncCpa)}</b>, under 1st-order BE ({fmt(beCpa1)}). Room to push spend.</> });
  }

  if (current.ltvCac < 1) recs.push({ i: "📉", tone: "bad", title: "LTV:CAC below 1×", t: <>Every $1 CAC recovers only <b>{fmtX(current.ltvCac)}</b>. Structurally unprofitable — check repeat rate, AOV, margin.</> });
  else if (current.ltvCac < 3) recs.push({ i: "📊", tone: "warn", title: "LTV:CAC viable", t: <>LTV:CAC is <b>{fmtX(current.ltvCac)}</b>. Target ≥3× by lifting repeat rate or AOV.</> });
  else recs.push({ i: "🏆", tone: "good", title: "Strong LTV:CAC", t: <>LTV:CAC of <b>{fmtX(current.ltvCac)}</b> is above 3× benchmark. You can spend more aggressively.</> });

  if (current.netProfit > 0 && pkCell && pkCell.spend > current.spend) {
    const nextStep = Math.round((current.spend + pkCell.spend) / 2 / 1000) * 1000;
    recs.push({ i: "🚀", tone: "info", title: "Next test to run", t: <>Test <b>{fmt(nextStep)}/mo</b> (halfway to peak) for 30 days. Keep climbing if NC-CPA stays under <b>{fmt(beCpaLtv)}</b>.</> });
  }

  const cashBurn = current.paidNewOrders * Math.max(0, current.ncCpa - beCpa1);
  if (cashBurn > 0 && current.paybackMonths > 0 && isFinite(current.paybackMonths)) {
    const tied = cashBurn * current.paybackMonths;
    if (tied > 10000) recs.push({ i: "💸", tone: "warn", title: "Working capital needed", t: <>Fronting ~<b>{fmt(cashBurn)}/mo</b> above 1st-order BE. Over {current.paybackMonths.toFixed(1)}mo, ~<b>{fmt(tied)}</b> cash tied up.</> });
  }

  const toneColor = t => t === "good" ? { bg: "rgba(120,220,160,0.06)", border: "rgba(120,220,160,0.28)", ic: T.green }
    : t === "bad" ? { bg: "rgba(200,60,60,0.07)", border: "rgba(200,60,60,0.32)", ic: T.red }
    : t === "warn" ? { bg: "rgba(255,190,80,0.06)", border: "rgba(255,190,80,0.28)", ic: T.amber }
    : { bg: "rgba(120,170,237,0.06)", border: "rgba(120,170,237,0.25)", ic: T.blue };

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.015em" }}>🌱 Social Enviro Recommendations</h3>
        <span style={{ fontSize: 12, color: T.muted }}>From your {fmt(current.spend)} @ {fmtX(current.roas)} baseline</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
        {recs.map((r, i) => {
          const col = toneColor(r.tone);
          return (
            <div key={i} style={{ padding: "12px 14px", borderRadius: 9, background: col.bg, border: `1.5px solid ${col.border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 17, lineHeight: "22px", flexShrink: 0 }}>{r.i}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: col.ic, marginBottom: 3 }}>{r.title}</div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: T.text }}>{r.t}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── MAIN APP ── */
export default function App() {
  // Brands
  const [brands, setBrands] = useState(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return DEFAULT_BRANDS;
  });
  const [activeIdx, setActiveIdx] = useState(() => {
    try { const v = parseInt(localStorage.getItem(LS_ACTIVE) || "0", 10); return isNaN(v) ? 0 : v; } catch { return 0; }
  });
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(LS_THEME) || "dark"; } catch { return "dark"; }
  });
  const T = THEMES[theme];

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(brands)); } catch {} }, [brands]);
  useEffect(() => { try { localStorage.setItem(LS_ACTIVE, String(activeIdx)); } catch {} }, [activeIdx]);
  useEffect(() => { try { localStorage.setItem(LS_THEME, theme); } catch {} }, [theme]);

  const I = brands[activeIdx]?.inputs ?? DEFAULTS;
  const setI = useCallback((updater) => {
    setBrands(prev => prev.map((b, i) => i === activeIdx ? { ...b, inputs: typeof updater === "function" ? updater(b.inputs) : updater } : b));
  }, [activeIdx]);
  const s = useCallback((k, v) => setI(p => ({ ...p, [k]: v })), [setI]);

  const [os, setOs] = useState({ current: true, basics: true, ltv: false, advanced: false });
  const [primaryMetric, setPrimaryMetric] = useState("contrib");
  const [overlay, setOverlay] = useState("none");
  const [mainView, setMainView] = useState("grid");
  const [selected, setSelected] = useState(null);
  const tg = (k) => setOs(p => ({ ...p, [k]: !p[k] }));

  const effI = useMemo(() => deriveEffective(I), [I]);
  const rV = useMemo(() => { const v = []; for (let r = effI.roasMin; r <= effI.roasMax + 0.001; r += effI.roasStep) v.push(Math.round(r * 100) / 100); return v; }, [effI.roasMin, effI.roasMax, effI.roasStep]);
  const sV = useMemo(() => { const v = [], st = (effI.spendMax - effI.spendMin) / effI.spendSteps; for (let i = 0; i <= effI.spendSteps; i++) v.push(Math.round(effI.spendMin + i * st)); return v; }, [effI.spendMin, effI.spendMax, effI.spendSteps]);
  const eng = useMemo(() => compute(effI, rV, sV), [effI, rV, sV]);

  let pN = -Infinity, pkCell = null;
  eng.grid.forEach(row => row.forEach(c => { if (c.netProfit > pN) { pN = c.netProfit; pkCell = c; } }));
  const cur = eng.current;
  const simple = I.mode === "simplified";
  const isDark = theme === "dark";

  // Brand mgmt
  const addBrand = () => {
    const name = prompt("Brand name?", `Brand ${brands.length + 1}`);
    if (!name) return;
    setBrands(prev => [...prev, newBrand(name)]);
    setActiveIdx(brands.length);
  };
  const renameBrand = () => {
    const name = prompt("Rename brand:", brands[activeIdx].name);
    if (!name) return;
    setBrands(prev => prev.map((b, i) => i === activeIdx ? { ...b, name } : b));
  };
  const deleteBrand = () => {
    if (brands.length === 1) return alert("At least one brand is required.");
    if (!confirm(`Delete "${brands[activeIdx].name}"? This can't be undone.`)) return;
    setBrands(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
  };

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:${T.borderStrong};border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.5}`}</style>

      {/* HEADER */}
      <div style={{ padding: "16px 26px 14px", borderBottom: `1.5px solid ${T.border}`, background: isDark ? "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)" : "linear-gradient(180deg, rgba(0,0,0,0.015) 0%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* Logo */}
          <a href="https://socialenviro.ie" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            <img src="/social-enviro-logo.png" alt="Social Enviro" onError={e => { e.currentTarget.style.display = "none"; }}
              style={{ height: 40, width: "auto", filter: isDark ? "invert(1) brightness(1.1)" : "none", background: "transparent" }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: T.textStrong }}>Profit Matrix</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: T.muted }}>by Social Enviro — scale profitably</p>
            </div>
          </a>

          <div style={{ flex: 1 }} />

          {/* Brand switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px", background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 8 }}>
            <span style={{ fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--m)", fontWeight: 700 }}>Brand</span>
            <select value={activeIdx} onChange={e => setActiveIdx(parseInt(e.target.value, 10))} style={{ background: "transparent", color: T.textStrong, border: "none", outline: "none", fontSize: 13, fontWeight: 700, padding: "4px 6px", cursor: "pointer", fontFamily: "var(--h)" }}>
              {brands.map((b, i) => <option key={i} value={i} style={{ background: T.elev, color: T.textStrong }}>{b.name}</option>)}
            </select>
            <button onClick={renameBrand} title="Rename" style={{ background: "transparent", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", padding: 4 }}>✎</button>
            <button onClick={addBrand} title="New brand" style={{ background: "transparent", border: "none", color: T.green, fontSize: 15, cursor: "pointer", padding: 4, fontWeight: 700 }}>+</button>
            <button onClick={deleteBrand} title="Delete brand" style={{ background: "transparent", border: "none", color: T.red, fontSize: 13, cursor: "pointer", padding: 4 }}>✕</button>
          </div>

          {/* Theme toggle */}
          <button onClick={() => setTheme(isDark ? "light" : "dark")} title="Toggle theme"
            style={{ padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.card, color: T.textStrong, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "var(--h)" }}>
            {isDark ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* LEFT — INPUTS */}
        <div style={{ borderRight: `1.5px solid ${T.border}`, padding: "14px 16px", overflowY: "auto", maxHeight: "calc(100vh - 72px)", background: T.sideBg }}>

          {/* Mode toggle */}
          <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 9, background: isDark ? "rgba(120,170,237,0.05)" : "rgba(120,170,237,0.08)", border: "1.5px solid rgba(120,170,237,0.22)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: "var(--m)" }}>Input mode</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => s("mode", "simplified")} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: simple ? T.blue : T.border, background: simple ? "rgba(120,170,237,0.18)" : T.card, color: simple ? T.blue : T.muted, fontFamily: "var(--h)" }}>Simplified</button>
              <button onClick={() => s("mode", "detailed")} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: !simple ? T.blue : T.border, background: !simple ? "rgba(120,170,237,0.18)" : T.card, color: !simple ? T.blue : T.muted, fontFamily: "var(--h)" }}>Detailed</button>
            </div>
          </div>

          <Sec T={T} label="Your Current Performance" sub="Spend, ROAS, real new customers" badge="YOU" accent="you" open={os.current} onToggle={() => tg("current")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp T={T} label="Monthly Spend" pre="$" value={I.currentSpend} onChange={v => s("currentSpend", v)} step={1000} tip="Your actual monthly paid ad spend." />
              <Inp T={T} label="Blended ROAS" suf="x" value={I.currentRoas} onChange={v => s("currentRoas", v)} step={0.1} tip={TIPS.roas} />
              <Inp T={T} label="New Customers / Mo" value={I.currentNewCustomers} onChange={v => s("currentNewCustomers", v)} step={10} min={0} tip={TIPS.currentNewCust} help={I.currentNewCustomers > 0 ? `Real NC-CPA: ${fmt(cur.ncCpa)}` : "0 = use model estimate"} />
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.borderFaint}` }}>
              <Toggle T={T} on={I.allSpendOnNewCust} onChange={v => s("allSpendOnNewCust", v)} label="All spend on new customer acquisition" tip={TIPS.allSpendNC} />
            </div>
          </Sec>

          {simple ? (
            <>
              <Sec T={T} label="Business Basics" sub="Essentials" open={os.basics} onToggle={() => tg("basics")}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp T={T} label="Average Order Value" pre="$" value={I.simpleAov} onChange={v => s("simpleAov", v)} step={1} tip={TIPS.aov} />
                  <Inp T={T} label="Avg Variable Costs" suf="%" value={I.avgVarCostPct} onChange={v => s("avgVarCostPct", v)} step={1} tip={TIPS.avgVarCost} />
                  <Inp T={T} label="Monthly Fixed Costs" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} tip="Rent, salaries, SaaS." />
                  <Inp T={T} label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} tip={TIPS.organic} />
                </div>
              </Sec>
            </>
          ) : (
            <Sec T={T} label="Unit Economics" sub="AOV, margin, variable costs" open={os.basics} onToggle={() => tg("basics")}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp T={T} label="New AOV" pre="$" value={I.newAov} onChange={v => s("newAov", v)} step={1} tip="Average order value for first-time buyers." />
                <Inp T={T} label="Return AOV" pre="$" value={I.retAov} onChange={v => s("retAov", v)} step={1} tip="Average order value for repeat buyers." />
                <Inp T={T} label="Gross Margin" suf="%" value={I.grossMarginPct} onChange={v => s("grossMarginPct", v)} step={.5} tip={TIPS.grossMargin} />
                <Inp T={T} label="Shipping / Order" pre="$" value={I.shippingPerOrder} onChange={v => s("shippingPerOrder", v)} step={.5} tip="Fulfillment cost per order." />
                <Inp T={T} label="Processing" suf="%" value={I.processingPct} onChange={v => s("processingPct", v)} step={.1} tip="Card processing fees." />
                <Inp T={T} label="Other Var / Order" pre="$" value={I.otherVarPerOrder} onChange={v => s("otherVarPerOrder", v)} step={.5} tip="Other per-order costs." />
                <Inp T={T} label="Var % of Rev" suf="%" value={I.otherVarPctRevenue} onChange={v => s("otherVarPctRevenue", v)} step={.1} tip="Revenue-share fees." />
                <Inp T={T} label="Monthly Fixed Costs" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} tip="Rent, salaries, SaaS." />
                <Inp T={T} label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} tip={TIPS.organic} />
              </div>
            </Sec>
          )}

          <Sec T={T} label="LTV" sub={I.ltvMode === "known" ? "From your cohort data" : "Modelled from repeat rate"} open={os.ltv} onToggle={() => tg("ltv")}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button onClick={() => s("ltvMode", "modelled")} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: I.ltvMode === "modelled" ? T.green : T.border, background: I.ltvMode === "modelled" ? "rgba(120,220,160,0.15)" : T.card, color: I.ltvMode === "modelled" ? T.green : T.muted, fontFamily: "var(--h)" }}>Modelled</button>
              <button onClick={() => s("ltvMode", "known")} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: I.ltvMode === "known" ? T.green : T.border, background: I.ltvMode === "known" ? "rgba(120,220,160,0.15)" : T.card, color: I.ltvMode === "known" ? T.green : T.muted, fontFamily: "var(--h)" }}>Known (Cohort)</button>
            </div>
            <p style={{ fontSize: 11, color: T.muted, margin: "0 0 10px", lineHeight: 1.5 }}>{TIPS.ltvMode}</p>

            {I.ltvMode === "modelled" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp T={T} label="Repeat Rate" suf="%" value={I.repeatRate} onChange={v => s("repeatRate", v)} step={1} tip="% of new customers who reorder." />
                <Inp T={T} label="Orders / Repeater" value={I.avgOrdersPerRepeater} onChange={v => s("avgOrdersPerRepeater", v)} step={.1} tip="Avg lifetime orders for repeaters." />
                <Inp T={T} label="Repeat Cycle" suf="mo" value={I.avgRepeatCycleMonths} onChange={v => s("avgRepeatCycleMonths", v)} step={.5} tip="Avg months between orders." />
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp T={T} label="LTV @ 30d" pre="$" value={I.ltv30} onChange={v => s("ltv30", v)} step={5} tip={TIPS.ltvPeriod} />
                  <Inp T={T} label="LTV @ 60d" pre="$" value={I.ltv60} onChange={v => s("ltv60", v)} step={5} tip={TIPS.ltvPeriod} />
                  <Inp T={T} label="LTV @ 90d" pre="$" value={I.ltv90} onChange={v => s("ltv90", v)} step={5} tip={TIPS.ltvPeriod} />
                  <Inp T={T} label="LTV @ 180d" pre="$" value={I.ltv180} onChange={v => s("ltv180", v)} step={5} tip={TIPS.ltvPeriod} />
                  <Inp T={T} label="LTV @ 360d" pre="$" value={I.ltv360} onChange={v => s("ltv360", v)} step={10} tip={TIPS.ltvPeriod} />
                </div>
                <p style={{ fontSize: 11, color: T.muted, margin: "8px 0 0", lineHeight: 1.5 }}>Enter cumulative revenue per new customer at each checkpoint. Lifetime profit is derived using your variable margin.</p>
              </>
            )}
          </Sec>

          <Sec T={T} label="Advanced Settings" sub="Grid, decay, mix" open={os.advanced} onToggle={() => tg("advanced")}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>Scaling realism</div>
            <div style={{ marginBottom: 12 }}>
              <Inp T={T} label="ROAS Decay at Scale" suf="%" value={I.roasDecayPct} onChange={v => s("roasDecayPct", v)} step={1} min={0} max={60} tip={TIPS.roasDecay} help={I.roasDecayPct > 0 ? `ROAS drops ${I.roasDecayPct}% from min→max spend` : "Off — curves are linear"} />
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>Grid</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <Inp T={T} label="Ad Starting Spend" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} />
              {simple ? <Inp T={T} label="Spend Increment" pre="$" value={I.spendStep} onChange={v => s("spendStep", v)} step={5000} tip={TIPS.spendStep} />
                : <Inp T={T} label="Spend Max" pre="$" value={I.spendMax} onChange={v => s("spendMax", v)} step={10000} />}
              <Inp T={T} label="ROAS Start" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={.25} />
              <Inp T={T} label="ROAS Increment" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={.05} tip={TIPS.roasStep} />
              {!simple && <>
                <Inp T={T} label="Spend Steps" value={I.spendSteps} onChange={v => s("spendSteps", v)} step={1} min={3} max={16} />
                <Inp T={T} label="ROAS Max" suf="x" value={I.roasMax} onChange={v => s("roasMax", v)} step={.25} />
              </>}
            </div>

            {!simple && <>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>New vs Returning mix</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <Inp T={T} label="New % at Low Spend" suf="%" value={I.newCustPctBase} onChange={v => s("newCustPctBase", v)} step={1} />
                <Inp T={T} label="New % at High Spend" suf="%" value={I.newCustPctAtMaxSpend} onChange={v => s("newCustPctAtMaxSpend", v)} step={1} />
              </div>
              <Inp T={T} label="Organic New %" suf="%" value={I.organicNewPct} onChange={v => s("organicNewPct", v)} step={5} tip="Share of organic orders that are new customers." />
            </>}
          </Sec>

        </div>

        {/* RIGHT — OUTPUT */}
        <div style={{ padding: "14px 22px", overflowY: "auto", maxHeight: "calc(100vh - 72px)" }}>

          {/* Snapshot + Peak */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "var(--m)" }}>● Your current snapshot</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <MetPill T={T} label="Net" tip={TIPS.netProfit} value={fmtFull(cur.netProfit)} color={cur.netProfit > 0 ? T.green : T.red} you />
                <MetPill T={T} label="NC-CPA" tip={TIPS.ncCpa} value={fmt(cur.ncCpa)} color={cur.ncCpa <= eng.beCpa1 ? T.green : cur.ncCpa <= eng.beCpaLtv ? T.amber : T.red} you />
                <MetPill T={T} label="MER" tip={TIPS.mer} value={fmtX(cur.mer)} color={T.blue} you />
                <MetPill T={T} label="LTV:CAC" tip={TIPS.ltvCac} value={fmtX(cur.ltvCac)} color={cur.ltvCac >= 3 ? T.green : cur.ltvCac >= 1 ? T.amber : T.red} you />
                <MetPill T={T} label="Payback" tip={TIPS.payback} value={cur.paybackMonths <= 0 ? "Instant" : !isFinite(cur.paybackMonths) ? "Never" : `${cur.paybackMonths.toFixed(1)}mo`} color={cur.paybackMonths <= 6 ? T.green : cur.paybackMonths <= 12 ? T.amber : T.red} you />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "var(--m)" }}>★ Model peak & breakevens</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <MetPill T={T} label="Peak Net" tip={TIPS.netProfit} value={fmtFull(pN)} sub={pkCell ? `${fmt(pkCell.spend)} @ ${fmtX(pkCell.roas)}` : ""} color={pN > 0 ? T.green : T.red} />
                <MetPill T={T} label="BE NC-CPA 1st" tip={TIPS.beCpa1} value={fmt(eng.beCpa1)} color={T.amber} />
                <MetPill T={T} label="BE NC-CPA LTV" tip={TIPS.beCpaLtv} value={fmt(eng.beCpaLtv)} color={T.green} />
                <MetPill T={T} label="Peak MER" tip={TIPS.mer} value={pkCell ? fmtX(pkCell.mer) : "—"} color={T.blue} />
                <MetPill T={T} label="LTV/Customer" tip="Projected lifetime profit per new customer." value={fmtFull(eng.ltvP)} color={T.greenL} />
              </div>
            </div>
          </div>

          {/* Main chart area */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
                Contribution & Net Profit
                <Tip T={T} text="ROAS rows × Spend columns. Green cells profit, red lose. Click cells for full scenario detail. Toggle to Scale Curves for diminishing-returns visualization." />
                <Tip T={T} text="How to use: (1) Enter your real Spend/ROAS/New Customers — plots ● YOU. (2) Read across a row to see scaling at fixed efficiency. (3) Click any cell for full breakdown. (4) Toggle overlay to layer acquisition metrics. (5) Switch to Scale Curves to see diminishing returns." />
              </h3>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
                <button onClick={() => setMainView("grid")} style={{ padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: mainView === "grid" ? T.green : T.border, background: mainView === "grid" ? "rgba(120,220,160,0.15)" : T.card, color: mainView === "grid" ? T.green : T.muted, fontFamily: "var(--h)" }}>Grid</button>
                <button onClick={() => setMainView("curve")} style={{ padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: mainView === "curve" ? T.green : T.border, background: mainView === "curve" ? "rgba(120,220,160,0.15)" : T.card, color: mainView === "curve" ? T.green : T.muted, fontFamily: "var(--h)" }}>Scale Curves</button>
              </div>
            </div>

            {mainView === "grid" && (
              <>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Primary metric</div>
                    <MP T={T} options={[["contrib", "Contribution", TIPS.contrib], ["net", "Net Profit", TIPS.netProfit]]} value={primaryMetric} onChange={setPrimaryMetric} multi={false} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Acquisition overlay</div>
                    <MP T={T} options={[
                      ["none", "None"],
                      ["ncCpa", "NC-CPA", TIPS.ncCpa],
                      ["mer", "MER", TIPS.mer],
                      ["ncRoas", "NC-ROAS", TIPS.ncRoas],
                      ["newOrders", "New Orders", "New paid orders / month."],
                      ["eRoas", "Eff. ROAS", "ROAS after decay at scale."],
                    ]} value={overlay} onChange={setOverlay} multi={false} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 14, alignItems: "start" }}>
                  <PrimaryTable T={T} engine={eng} roasVals={rV} spendVals={sV} primaryMetric={primaryMetric} overlayMode={overlay} beCpa1={eng.beCpa1} beCpaLtv={eng.beCpaLtv} onSelect={setSelected} selected={selected} />
                  <CellDetail T={T} cell={selected} engine={eng} />
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                  <LD T={T} color="rgba(200,60,60,0.6)" label="Loss" />
                  <LD T={T} color="rgba(100,100,120,0.2)" label="~Breakeven" />
                  <LD T={T} color="rgba(60,180,90,0.6)" label="Profit" />
                  <span style={{ fontSize: 11.5, color: T.amber, fontWeight: 700 }}>● YOU</span>
                  <span style={{ fontSize: 11.5, color: T.green, fontWeight: 700 }}>★ PEAK</span>
                  <span style={{ fontSize: 11.5, color: T.blue, fontWeight: 700, marginLeft: "auto" }}>Click any cell →</span>
                </div>
              </>
            )}

            {mainView === "curve" && <CurveChart T={T} engine={eng} roasVals={rV} spendVals={sV} decayOn={I.roasDecayPct > 0} />}
          </div>

          <Recs T={T} engine={eng} I={effI} />

          {I.ltvMode === "known" && <LtvBuildupTable T={T} I={effI} engine={eng} />}

          <LtvChart T={T} engine={eng} roasVals={rV} spendVals={sV} />

          {/* Social Enviro CTA */}
          <div style={{ marginTop: 28, marginBottom: 8, padding: "24px 26px", borderRadius: 12, background: isDark ? "linear-gradient(135deg, rgba(120,220,160,0.08) 0%, rgba(120,170,237,0.08) 100%)" : "linear-gradient(135deg, rgba(120,220,160,0.14) 0%, rgba(120,170,237,0.14) 100%)", border: `1.5px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <img src="/social-enviro-logo.png" alt="Social Enviro" onError={e => { e.currentTarget.style.display = "none"; }}
                  style={{ height: 56, width: "auto", filter: isDark ? "invert(1) brightness(1.1)" : "none" }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--m)", marginBottom: 3 }}>Built by Social Enviro</div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.015em" }}>Ready to scale profitably?</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 13.5, color: T.text, lineHeight: 1.55, maxWidth: 560 }}>
                    We're a performance growth agency for e-commerce brands — obsessed with the unit economics your competitors ignore. Paid media, creative, CRO, lifecycle and LTV work, wired to contribution margin.
                  </p>
                </div>
              </div>
              <a href="https://socialenviro.ie" target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 8, background: T.green, color: isDark ? "#0c0e16" : "#ffffff", textDecoration: "none", fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em", boxShadow: "0 4px 14px rgba(120,220,160,0.25)" }}>
                Book a call at socialenviro.ie →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useCallback, useEffect, useRef, Component, memo } from "react";
import { AuthGate, TeamManagement } from "./Auth.jsx";
import { hasAccess } from "./supabase.js";

/* ── ERROR BOUNDARY ── */
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Caught by boundary:", error, info); }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      const T = this.props.T || { bg: "#0c0e16", panel: "#1a1d2e", text: "#e8eaf2", textStrong: "#fff", muted: "#8a8fa8", border: "rgba(255,255,255,0.12)", red: "#ff9999", green: "#78dca0" };
      return (
        <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 460, padding: "26px 28px", borderRadius: 12, background: T.panel, border: `1.5px solid ${T.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>⚠️</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, color: T.textStrong }}>Something went wrong</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
              {this.state.error.message || "An unexpected error occurred while rendering this view."}
            </p>
            <button onClick={this.reset} style={{ padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontWeight: 700, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
const isNum = (n) => n != null && !isNaN(n) && isFinite(n);
const fmt = (n) => {
  if (!isNum(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const fmtFull = (n) => isNum(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—";
const fmtX = (n) => isNum(n) ? `${n.toFixed(2)}x` : "—";
const fmtInt = (n) => isNum(n) ? Math.round(n).toLocaleString() : "—";

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
const SIMPLIFIED_GRID_STEPS = 8; // 9-point grid (0..steps inclusive) in simplified mode
function deriveEffective(I) {
  let out = { ...I };
  if (I.mode === "simplified") {
    const gm = Math.max(0, 100 - I.avgVarCostPct);
    const spendMin = I.spendMin;
    const steps = SIMPLIFIED_GRID_STEPS;
    const spendMax = spendMin + steps * I.spendStep;
    const roasMin = I.roasMin;
    const roasMax = roasMin + steps * I.roasStep;
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
      <button onClick={onToggle} aria-expanded={!!open} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} style={{ display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: "11px 13px", width: "100%", textAlign: "left", color: "inherit" }}>
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

const MetPill = memo(function MetPill({ label, tip, value, sub, color, you, T }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 7, background: you ? T.youBg : T.card, border: `1px solid ${you ? T.youBorder : T.border}`, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: you ? T.amber : T.muted, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "var(--m)", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {you && <span style={{ marginRight: 4 }}>●</span>}{label}{tip && <Tip text={tip} T={T} />}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || T.textStrong, letterSpacing: "-0.015em", lineHeight: 1.2, fontFamily: "var(--h)", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
});

function LD({ color, label, T }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: color }} /><span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{label}</span></div>;
}

function Toggle({ on, onChange, label, tip, T }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, userSelect: "none" }}>
      <button
        type="button"
        role="switch"
        aria-checked={!!on}
        aria-label={typeof label === "string" ? label : undefined}
        onClick={() => onChange(!on)}
        style={{ width: 36, height: 20, borderRadius: 12, background: on ? T.green : T.border, position: "relative", transition: "all .15s", flexShrink: 0, border: "none", cursor: "pointer", padding: 0 }}
      >
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </button>
      <span style={{ fontSize: 12.5, color: T.label, fontWeight: 600, display: "flex", alignItems: "center", cursor: "pointer" }} onClick={() => onChange(!on)}>{label}{tip && <Tip text={tip} T={T} />}</span>
    </div>
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
const PrimaryTable = memo(function PrimaryTable({ engine, roasVals, spendVals, primaryMetric, overlayMode, beCpa1, beCpaLtv, onSelect, selected, T }) {
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
});

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

  const TONES = {
    good: { bg: "rgba(120,220,160,0.06)", border: "rgba(120,220,160,0.28)", ic: T.green },
    bad:  { bg: "rgba(200,60,60,0.07)",   border: "rgba(200,60,60,0.32)",   ic: T.red },
    warn: { bg: "rgba(255,190,80,0.06)",  border: "rgba(255,190,80,0.28)",  ic: T.amber },
    info: { bg: "rgba(120,170,237,0.06)", border: "rgba(120,170,237,0.25)", ic: T.blue },
  };
  const toneColor = t => TONES[t] || TONES.info;

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

/* ── HOME DASHBOARD ── */
// Deterministic "mock" metrics keyed off the active brand's inputs so the numbers
// feel consistent as users switch brands. Replace `fetchBrandMetrics` with a real
// API call when backend is wired up.
function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function buildMockMetrics(I, timeframe) {
  // scale factor based on timeframe (1d/7d/30d/90d)
  const days = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 }[timeframe] || 30;
  const dailySpend = I.currentSpend / 30;
  const dailyRev = dailySpend * I.currentRoas;
  const seed = (I.currentSpend + I.currentRoas * 1000 + days * 7);

  // Spark line — 14 points
  const spark = (baseline, volatility, trend = 0) => {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const noise = (seededRandom(seed + i * 13) - 0.5) * volatility;
      const drift = (i / 13) * trend;
      pts.push(baseline * (1 + noise + drift));
    }
    return pts;
  };

  const totalSales = dailyRev * days + (I.monthlyOrganicRevenue / 30) * days;
  const adSpend = dailySpend * days;
  const roas = I.currentRoas;
  const orders = Math.round(totalSales / (I.newAov || 75));
  const trueAov = totalSales / Math.max(1, orders);
  const ncRoas = roas * 1.05; // mock
  const fbSpend = adSpend * 0.72;
  const ggSpend = adSpend * 0.22;
  const mer = totalSales / Math.max(1, adSpend);
  const convRate = 1.4 + seededRandom(seed + 99) * 0.6;
  const netProfit = totalSales * 0.25 - adSpend * 0.35 - (I.monthlyFixedCosts / 30) * days;

  const mkMetric = (id, icon, label, value, change, trend, isProfit = false) => ({
    id, icon, label, value, change, trend, spark: spark(1, 0.25, change / 100), isProfit,
  });

  return [
    mkMetric("sales", "🛒", "Total Sales", `£${fmtInt(totalSales)}`, 34.66, "up"),
    mkMetric("adspend", "◉", "Ads", `£${fmtInt(adSpend)}`, -4.36, "down"),
    mkMetric("roas", "◉", "Blended ROAS", roas.toFixed(2), 40.73, "up"),
    mkMetric("aov", "🛒", "True AOV", `£${Math.round(trueAov)}`, 0.16, "up"),
    mkMetric("orders", "🛒", "Orders", fmtInt(orders), 32, "up"),
    mkMetric("ncroas", "◉", "NC-ROAS", ncRoas.toFixed(2), 30.41, "up"),
    mkMetric("metaRoas", "ⓕ", "Meta ROAS", "4.20", 21.04, "up"),
    mkMetric("mer", "▽", "MER", `${(mer * 10).toFixed(0)}%`, -28.98, "down"),
    mkMetric("conv", "▤", "Conversion Rate", `${convRate.toFixed(2)}%`, 25.28, "up"),
    mkMetric("fb", "ⓕ", "Facebook Ads", `£${fmtInt(fbSpend)}`, -13.82, "down"),
    mkMetric("gg", "G", "Google Ads", `£${fmtInt(ggSpend)}`, 49.56, "up"),
    mkMetric("net", "▽", "Net Profit", `£${fmtInt(netProfit)}`, 62.27, "up", true),
  ];
}

// Tiny inline SVG sparkline
function Spark({ points, color, width = 200, height = 40 }) {
  if (!points || points.length < 2) return null;
  const mn = Math.min(...points), mx = Math.max(...points);
  const range = mx - mn || 1;
  const x = i => (i / (points.length - 1)) * width;
  const y = v => height - ((v - mn) / range) * height * 0.9 - height * 0.05;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p).toFixed(2)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const PLATFORM_ICON_COLORS = {
  "🛒": "#95bf47", // shopify green
  "◉": "#e87c6a", // triple-whale like dot
  "ⓕ": "#1877f2", // facebook/meta blue
  "G": "#4285f4", // google
  "▤": "#f9ab00", // ga4
  "▽": "#ff6b6b",
};

function MetricCard({ m, T, brandName, timeframe }) {
  const positive = m.trend === "up";
  const changeColor = (m.label === "Ads" || m.label.includes("Facebook") || m.label.includes("MER")) ? (positive ? T.red : T.green) : (positive ? T.green : T.red);
  return (
    <div style={{ padding: "14px 16px 12px", borderRadius: 10, background: m.isProfit ? (T === THEMES.dark ? "rgba(120,220,160,0.08)" : "#ebfdf3") : T.panel, border: `1.5px solid ${m.isProfit ? "rgba(120,220,160,0.3)" : T.border}`, display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14, color: PLATFORM_ICON_COLORS[m.icon] || T.muted, fontWeight: 700, width: 16, textAlign: "center" }}>{m.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{m.label}</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: changeColor, display: "flex", alignItems: "center", gap: 2 }}>
          <span>{m.trend === "up" ? "↑" : "↓"}</span>
          <span>{Math.abs(m.change).toFixed(2)}%</span>
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "var(--h)" }}>{m.value}</div>
      <div style={{ height: 32, marginTop: 4 }}>
        <Spark points={m.spark} color={m.trend === "up" ? T.green : T.blue} />
      </div>
    </div>
  );
}

function ConnectionChip({ name, icon, status, T, onConnect }) {
  const connected = status === "connected";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: T.panel, border: `1.5px solid ${T.border}` }}>
      <div style={{ width: 28, height: 28, borderRadius: 6, background: T.card, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: PLATFORM_ICON_COLORS[icon] || T.text }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textStrong }}>{name}</div>
        <div style={{ fontSize: 11, color: connected ? T.green : T.muted, fontWeight: 600 }}>{connected ? "● Connected" : "Not connected"}</div>
      </div>
      <button onClick={onConnect} style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontFamily: "var(--h)" }}>
        {connected ? "Manage" : "Connect"}
      </button>
    </div>
  );
}

function HomeDashboard({ open, onClose, onGoToMatrix, T, brand, theme }) {
  const [timeframe, setTimeframe] = useState("30d");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(() => new Date());
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    if (brand) setMetrics(buildMockMetrics(brand.inputs, timeframe));
  }, [brand, timeframe]);

  const refresh = async () => {
    setRefreshing(true);
    // Simulated delay — replace with real API call
    await new Promise(r => setTimeout(r, 900));
    setMetrics(buildMockMetrics(brand.inputs, timeframe));
    setLastSync(new Date());
    setRefreshing(false);
  };

  const fmtSync = (d) => {
    const diff = Math.round((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const connections = [
    { name: "Shopify", icon: "🛒", status: "mock" },
    { name: "Meta Ads", icon: "ⓕ", status: "mock" },
    { name: "Google Ads", icon: "G", status: "mock" },
    { name: "Google Analytics", icon: "▤", status: "mock" },
  ];

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, pointerEvents: open ? "auto" : "none" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", opacity: open ? 1 : 0, transition: "opacity .25s" }} />
      {/* Panel */}
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "min(720px, 92vw)", background: T.bg, borderRight: `1.5px solid ${T.border}`, transform: open ? "translateX(0)" : "translateX(-102%)", transition: "transform .28s cubic-bezier(.2,.8,.2,1)", boxShadow: open ? "4px 0 32px rgba(0,0,0,0.35)" : "none", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1.5px solid ${T.border}`, background: theme === "dark" ? "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)" : "linear-gradient(180deg, rgba(0,0,0,0.015) 0%, transparent 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 18 }}>🏠</div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-0.015em", color: T.textStrong }}>Home Dashboard</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: T.muted }}>Live metrics for <b style={{ color: T.text }}>{brand?.name}</b></p>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 16, cursor: "pointer", fontWeight: 700 }} title="Close">✕</button>
          </div>

          {/* Purpose / elevator pitch */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: T.card, border: `1.5px solid ${T.border}`, marginTop: 4 }}>
            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.55 }}>
              <b style={{ color: T.textStrong }}>What this tool does:</b> Maps your ad spend × efficiency against real unit economics so you can see exactly where you'd make more profit by scaling — and where you'd burn cash. Pair live store data here with the <b style={{ color: T.green }}>Profit Matrix</b> scenario planner to make confident scaling decisions.
            </div>
          </div>
        </div>

        {/* Controls bar */}
        <div style={{ padding: "12px 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1.5px solid ${T.border}` }}>
          <div style={{ display: "flex", gap: 3, background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 7, padding: 3 }}>
            {["1d", "7d", "30d", "90d"].map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{ padding: "5px 12px", borderRadius: 5, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "none", background: timeframe === tf ? T.green : "transparent", color: timeframe === tf ? (theme === "dark" ? "#0c0e16" : "#ffffff") : T.text, fontFamily: "var(--h)" }}>{tf.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginLeft: 4 }}>Last synced <b style={{ color: T.text }}>{fmtSync(lastSync)}</b></div>
          <div style={{ flex: 1 }} />
          <button onClick={refresh} disabled={refreshing} style={{ padding: "7px 13px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: refreshing ? "wait" : "pointer", border: `1.5px solid ${T.border}`, background: T.card, color: T.text, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--h)" }}>
            <span style={{ display: "inline-block", transition: "transform .6s", transform: refreshing ? "rotate(360deg)" : "rotate(0)" }}>⟳</span>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={onGoToMatrix} style={{ padding: "8px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 800, cursor: "pointer", border: `1.5px solid ${T.green}`, background: T.green, color: theme === "dark" ? "#0c0e16" : "#ffffff", fontFamily: "var(--h)" }}>
            Open Profit Matrix →
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>

          {/* Pins grid */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14 }}>📌</span>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: T.textStrong }}>Pins</h3>
              <Tip T={T} text="Your pinned live metrics. In the full version, pull directly from Shopify, Meta Ads, Google Ads and GA4. These cards are currently illustrative (seeded from your Profit Matrix inputs)." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {metrics.map(m => <MetricCard key={m.id} m={m} T={T} brandName={brand?.name} timeframe={timeframe} />)}
            </div>
          </div>

          {/* Connections */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14 }}>🔌</span>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: T.textStrong }}>Data sources</h3>
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: T.card, border: `1.5px solid ${T.amber}`, color: T.amber, fontWeight: 700, letterSpacing: "0.04em", fontFamily: "var(--m)" }}>DEMO</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              {connections.map(c => <ConnectionChip key={c.name} {...c} T={T} onConnect={() => alert(`${c.name} OAuth connection is coming soon. In production this opens a secure OAuth flow on the backend.`)} />)}
            </div>
            <p style={{ fontSize: 11, color: T.muted, margin: "10px 0 0", lineHeight: 1.55 }}>
              🔒 <b style={{ color: T.text }}>How we'll handle your data:</b> OAuth tokens never touch your browser — they're stored server-side, encrypted, and only used to pull read-only metrics on a schedule. You can revoke access anytime from each platform's app settings.
            </p>
          </div>

          {/* Quick actions */}
          <div>
            <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: T.textStrong }}>Quick actions</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <button onClick={onGoToMatrix} style={{ padding: "14px 16px", borderRadius: 10, border: `1.5px solid ${T.green}`, background: theme === "dark" ? "rgba(120,220,160,0.08)" : "rgba(120,220,160,0.12)", textAlign: "left", cursor: "pointer", fontFamily: "var(--h)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Plan</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.textStrong, marginBottom: 3 }}>Run a scenario in the Profit Matrix →</div>
                <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.45 }}>Map spend × ROAS against LTV and find the most profitable scaling path.</div>
              </button>
              <a href="https://socialenviro.ie" target="_blank" rel="noreferrer" style={{ padding: "14px 16px", borderRadius: 10, border: `1.5px solid ${T.border}`, background: T.card, textDecoration: "none", display: "block" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Talk to us</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.textStrong, marginBottom: 3 }}>Book a call with Social Enviro →</div>
                <div style={{ fontSize: 11.5, color: T.text, lineHeight: 1.45 }}>Performance growth agency for e-commerce. socialenviro.ie</div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── PROFIT MATRIX VIEW ── */
function ProfitMatrixView({ T, theme, isDark, brands, setBrands, activeIdx }) {
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
  const [homeOpen, setHomeOpen] = useState(false);
  const tg = (k) => setOs(p => ({ ...p, [k]: !p[k] }));

  const effI = useMemo(() => deriveEffective(I), [I]);
  const rV = useMemo(() => { const v = []; for (let r = effI.roasMin; r <= effI.roasMax + 0.001; r += effI.roasStep) v.push(Math.round(r * 100) / 100); return v; }, [effI.roasMin, effI.roasMax, effI.roasStep]);
  const sV = useMemo(() => { const v = [], st = (effI.spendMax - effI.spendMin) / effI.spendSteps; for (let i = 0; i <= effI.spendSteps; i++) v.push(Math.round(effI.spendMin + i * st)); return v; }, [effI.spendMin, effI.spendMax, effI.spendSteps]);
  const eng = useMemo(() => compute(effI, rV, sV), [effI, rV, sV]);

  // Peak-cell scan only depends on eng — was running every render.
  const pkCell = useMemo(() => {
    let best = null, bestN = -Infinity;
    for (const row of eng.grid) for (const c of row) {
      if (c.netProfit > bestN) { bestN = c.netProfit; best = c; }
    }
    return best;
  }, [eng]);
  const cur = eng.current;
  const simple = I.mode === "simplified";

  return (
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
                <MetPill T={T} label="Peak Net" tip={TIPS.netProfit} value={fmtFull(pkCell?.netProfit)} sub={pkCell ? `${fmt(pkCell.spend)} @ ${fmtX(pkCell.roas)}` : ""} color={(pkCell?.netProfit ?? 0) > 0 ? T.green : T.red} />
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
                  <span style={{ fontSize: 11, fontWeight: 700, marginLeft: "auto", padding: "3px 9px", borderRadius: 999, background: "rgba(120,170,237,0.14)", color: T.blue, border: "1px solid rgba(120,170,237,0.32)", letterSpacing: "0.02em" }}>👆 Click any cell for breakdown</span>
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
                <img src={isDark ? "/logo-white.png" : "/logo-black.png"} alt="Social Enviro" onError={e => { e.currentTarget.style.display = "none"; }}
                  style={{ height: 64, width: "auto" }} />
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
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SOCIAL ENVIRO COMMAND PLATFORM
   ────────────────────────────────────────────────────────────────────────────
   Everything below is the agency-ops layer (Watchdog, Tasks, Approvals,
   Mission Control, Sign-In) wrapping the Profit Matrix tool above.
   All data is currently MOCK — wire to backend by replacing mockData below.
═══════════════════════════════════════════════════════════════════════════ */

/* ── MOCK DATA ─────────────────────────────────────────────────────────── */
const TEAM = [
  { id: "u_dylan", name: "Dylan Anderson", initials: "DA", role: "Founder", avatarColor: "#7c5cff" },
  { id: "u_james", name: "James Kelly", initials: "JK", role: "Head of Strategy", avatarColor: "#5f9ef7" },
  { id: "u_aoife", name: "Aoife Murphy", initials: "AM", role: "Creative Strategist", avatarColor: "#ff7eb9" },
  { id: "u_sean",  name: "Seán O'Brien", initials: "SO", role: "Designer", avatarColor: "#ffbe50" },
  { id: "u_niamh", name: "Niamh Walsh", initials: "NW", role: "Editor", avatarColor: "#78dca0" },
  { id: "u_conor", name: "Conor Doyle", initials: "CD", role: "Account Manager", avatarColor: "#4ecdc4" },
];

const STATUS_META = {
  Critical:     { color: "#ff5470", bg: "rgba(255,84,112,0.14)" },
  "High Risk":  { color: "#ff8a4a", bg: "rgba(255,138,74,0.14)" },
  Moderate:     { color: "#ffbe50", bg: "rgba(255,190,80,0.14)" },
  Healthy:      { color: "#78dca0", bg: "rgba(120,220,160,0.14)" },
  "Upsell Ready": { color: "#a78bfa", bg: "rgba(167,139,250,0.16)" },
};

const MOCK_BRANDS = [
  { id: "b_acme",   name: "Acme Corp",      initials: "AC", color: "#ff7eb9", status: "Moderate",     risk: 35,  priority: 21,  delta: 0,   signals: [
    { kind: "warn", icon: "⚠", title: "Overdue deliverables", detail: "10 items stuck for 14+ days → +25 pts", weight: 25 },
    { kind: "warn", icon: "📞", title: "No recent client call", detail: "Last call 6 weeks ago", weight: 10 },
  ], lastActivity: "6m ago", revenueAtRisk: 0 },
  { id: "b_aura",   name: "Aura & Ash",     initials: "AU", color: "#ff9f7a", status: "Upsell Ready", risk: 15,  priority: 15,  delta: -5,  signals: [], lastActivity: "1d ago", revenueAtRisk: 0 },
  { id: "b_birch",  name: "Birch & Bloom",  initials: "BI", color: "#a8e6cf", status: "Healthy",      risk: 5,   priority: 5,   delta: -1,  signals: [], lastActivity: "1d ago", revenueAtRisk: 0 },
  { id: "b_bloom",  name: "Bloom & Thread", initials: "BL", color: "#ff5470", status: "Critical",     risk: 88,  priority: 100, delta: 14,  signals: [
    { kind: "bad", icon: "💸", title: "$7,480 revenue at risk", detail: "Q3 retainer contract pending renewal" },
  ], lastActivity: "1h ago", revenueAtRisk: 7480 },
  { id: "b_cinder", name: "Cinder & Co.",   initials: "CI", color: "#ff8a4a", status: "Healthy",      risk: 10,  priority: 6,   delta: 0,   signals: [
    { kind: "warn", icon: "📞", title: "No recent client call", detail: "No calls logged — +10 pts", weight: 10 },
  ], lastActivity: "6m ago", revenueAtRisk: 0 },
  { id: "b_cove",   name: "Cove & Craft",   initials: "CO", color: "#ffbe50", status: "Moderate",     risk: 42,  priority: 44,  delta: 0,   signals: [
    { kind: "warn", icon: "💸", title: "$2,730 revenue at risk", detail: "Slow approvals slowing media" },
  ], lastActivity: "14h ago", revenueAtRisk: 2730 },
  { id: "b_crest",  name: "Crest & Copper", initials: "CR", color: "#ff7eb9", status: "Healthy",      risk: 10,  priority: 10,  delta: -2,  signals: [], lastActivity: "2d ago", revenueAtRisk: 0 },
  { id: "b_drift",  name: "Drift & Dune",   initials: "DR", color: "#5f9ef7", status: "High Risk",    risk: 58,  priority: 70,  delta: 3,   signals: [
    { kind: "bad", icon: "📉", title: "MER trending down 18%", detail: "Last 7 days vs prior" },
    { kind: "warn", icon: "🎬", title: "Creative refresh overdue", detail: "Hooks stale — fatigue rising" },
  ], lastActivity: "2h ago", revenueAtRisk: 4200 },
  { id: "b_ember",  name: "Ember & Oak",    initials: "EM", color: "#ff5470", status: "High Risk",    risk: 52,  priority: 62,  delta: 8,   signals: [
    { kind: "warn", icon: "🎯", title: "NC-CPA over LTV breakeven", detail: "Pull back spend or fix funnel" },
  ], lastActivity: "5h ago", revenueAtRisk: 1900 },
];

const MOCK_TASKS = [
  { id: "t1", title: "Static ad set — Spring launch (4 variants)", brandId: "b_aura",   assignee: "u_aoife", status: "in_progress", type: "Static Ads",   priority: "High", due: "+2d", createdBy: "u_dylan" },
  { id: "t2", title: "UGC creator brief — fitness vertical",       brandId: "b_drift",  assignee: "u_aoife", status: "todo",        type: "Creator Brief", priority: "High", due: "today", createdBy: "u_james" },
  { id: "t3", title: "Edit hook tests — 3 variations",              brandId: "b_bloom",  assignee: "u_niamh", status: "in_progress", type: "Video Ads",    priority: "Critical", due: "today", createdBy: "u_dylan" },
  { id: "t4", title: "Carousel design — best sellers",              brandId: "b_birch",  assignee: "u_sean",  status: "review",      type: "Static Ads",   priority: "Medium", due: "+3d", createdBy: "u_conor" },
  { id: "t5", title: "Landing page rewrite — collection page",      brandId: "b_cove",   assignee: "u_james", status: "todo",        type: "Copy",         priority: "Medium", due: "+5d", createdBy: "u_dylan" },
  { id: "t6", title: "Monthly performance report",                  brandId: "b_acme",   assignee: "u_conor", status: "review",      type: "Report",       priority: "Medium", due: "+1d", createdBy: "u_dylan" },
  { id: "t7", title: "Founder testimonial brief",                   brandId: "b_aura",   assignee: "u_aoife", status: "done",        type: "Creator Brief", priority: "Low",  due: "-1d", createdBy: "u_james" },
  { id: "t8", title: "Renewal proposal deck",                       brandId: "b_bloom",  assignee: "u_dylan", status: "todo",        type: "Strategy",     priority: "Critical", due: "tomorrow", createdBy: "u_dylan" },
  { id: "t9", title: "Meta auction analysis",                       brandId: "b_drift",  assignee: "u_james", status: "in_progress", type: "Analysis",     priority: "High", due: "+3d", createdBy: "u_dylan" },
  { id: "t10", title: "Static ad — promo banner",                   brandId: "b_crest",  assignee: "u_sean",  status: "done",        type: "Static Ads",   priority: "Low",  due: "-2d", createdBy: "u_conor" },
];

const TASK_TYPES = ["Static Ads", "Video Ads", "Creator Brief", "Copy", "Strategy", "Report", "Analysis", "Design", "Other"];
const TASK_PRIORITIES = ["Critical", "High", "Medium", "Low"];
const TASK_STATUSES = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Needs Approval" },
  { id: "done", label: "Done" },
];

const MOCK_APPROVALS = [
  { id: "a1", taskId: "t4", title: "Carousel design — best sellers",        brandId: "b_birch", submittedBy: "u_sean",  type: "Design", submitted: "2h ago", thumbnail: "🎨" },
  { id: "a2", taskId: "t6", title: "Monthly performance report — Acme",     brandId: "b_acme",  submittedBy: "u_conor", type: "Report", submitted: "4h ago", thumbnail: "📊" },
  { id: "a3", taskId: null, title: "Static ad concept — limited drop",      brandId: "b_aura",  submittedBy: "u_aoife", type: "Static Ads",  submitted: "1d ago", thumbnail: "🖼" },
  { id: "a4", taskId: null, title: "Hook script — winter collection",       brandId: "b_drift", submittedBy: "u_aoife", type: "Copy",   submitted: "1d ago", thumbnail: "📝" },
];

const MOCK_SLACK = [
  { id: "s1", brandId: "b_drift", channel: "#drift-and-dune", from: "Sarah (Drift CEO)", time: "23m ago", text: "Hey team — saw the Q3 numbers. Can we set up a call to discuss the creative refresh strategy? Last few weeks have felt off.", urgency: "high" },
  { id: "s2", brandId: "b_bloom", channel: "#bloom-thread", from: "Mike (Bloom Marketing)", time: "1h ago", text: "Renewal docs incoming end of this week. Want to flag — budget might be -20% next cycle.", urgency: "critical" },
  { id: "s3", brandId: "b_aura", channel: "#aura-ash", from: "Liz (Aura Founder)", time: "3h ago", text: "Loved the new hooks. Can we explore opening a Google Ads channel? Wondering about budget split.", urgency: "medium" },
];

const MOCK_CALL_NOTES = [
  { id: "c1", brandId: "b_drift", title: "Drift & Dune — weekly sync", date: "Yesterday", duration: "32 min", attendees: ["Sarah (Drift)", "James", "Aoife"], summary: "Discussed declining MER. Sarah open to creative overhaul. Budget locked through Q3 but renewal at risk if numbers don't improve in 30 days.", actions: ["Aoife: brief 4 new UGC creators by Fri", "James: creative audit + recommendations doc by Wed"] },
  { id: "c2", brandId: "b_aura", title: "Aura & Ash — onboarding call #2", date: "2 days ago", duration: "45 min", attendees: ["Liz (Aura)", "Dylan", "Conor"], summary: "Aura ready to scale ad spend 50% in next quarter. Strong LTV signals. Considering Google Ads as second channel — opportunity for upsell.", actions: ["Conor: draft Google Ads scope by Mon", "Dylan: present scaling plan in next sync"] },
];

const ALL_TIME_TIMEFRAMES = ["1d", "7d", "30d", "90d"];

/* ── SHARED UI HELPERS ─────────────────────────────────────────────────── */
function Avatar({ user, size = 28, T }) {
  if (!user) return null;
  return (
    <div title={user.name} style={{ width: size, height: size, borderRadius: "50%", background: user.avatarColor, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 800, fontFamily: "var(--h)", border: `1.5px solid ${T.bg}`, flexShrink: 0 }}>
      {user.initials}
    </div>
  );
}

function StatusBadge({ status, delta, T }) {
  const meta = STATUS_META[status] || { color: T.muted, bg: T.card };
  const dColor = !delta ? T.muted : delta > 0 ? T.red : T.green;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, fontFamily: "var(--m)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
        {status}
      </span>
      {delta !== 0 && delta !== undefined && (
        <span style={{ fontSize: 11, color: dColor, fontWeight: 700, fontFamily: "var(--m)" }}>
          {delta > 0 ? "↗" : "↘"} {Math.abs(delta)}
        </span>
      )}
    </div>
  );
}

function RiskDonut({ value, max = 100, label = "RISK", T, size = 60 }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = circ * pct;
  const color = value >= 70 ? "#ff5470" : value >= 40 ? "#ff8a4a" : value >= 20 ? "#ffbe50" : "#78dca0";
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={stroke} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} transform={`rotate(-90 ${cx} ${cy})`} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        <div style={{ fontSize: size * 0.32, fontWeight: 800, color: T.textStrong, fontFamily: "var(--h)" }}>{value}</div>
        <div style={{ fontSize: 8, fontWeight: 700, color: T.muted, letterSpacing: "0.08em", fontFamily: "var(--m)", marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

function PriorityChip({ priority, T }) {
  const colors = { Critical: "#ff5470", High: "#ff8a4a", Medium: "#ffbe50", Low: "#78dca0" };
  const c = colors[priority] || T.muted;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: c + "22", color: c, fontSize: 10.5, fontWeight: 700, fontFamily: "var(--m)" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />{priority}
    </span>
  );
}

/* ── SIDEBAR ───────────────────────────────────────────────────────────── */
const NAV_ITEMS = [
  { section: "COMMAND", items: [
    { id: "watchdog", label: "Watchdog", icon: "🛡" },
    { id: "mission",  label: "Mission Control", icon: "🎯" },
  ]},
  { section: "ANALYTICS", items: [
    { id: "matrix",   label: "Profit Matrix",   icon: "📊" },
    { id: "shopify",  label: "Shopify Data",    icon: "🛒", soon: true },
    { id: "google",   label: "Google Ads",      icon: "G",  soon: true },
    { id: "meta",     label: "Meta Ads",        icon: "ⓕ", soon: true },
    { id: "email",    label: "Email Marketing", icon: "✉", soon: true },
    { id: "reports",  label: "Reports",         icon: "📈", soon: true },
  ]},
  { section: "OPERATIONS", items: [
    { id: "tasks",     label: "Tasks",     icon: "✅" },
    { id: "approvals", label: "Approvals", icon: "👁" },
  ]},
  { section: "INTELLIGENCE", items: [
    { id: "slack",  label: "Slack Inbox",     icon: "💬" },
    { id: "calls",  label: "Call Notes",      icon: "📞" },
  ]},
  { section: "ADMIN", items: [
    { id: "team",  label: "Team Management", icon: "👥", adminOnly: true },
  ]},
];

function Sidebar({ T, theme, setTheme, isDark, view, setView, brands, activeIdx, setActiveIdx, addBrand, currentUser, signOut }) {
  return (
    <div style={{ width: 240, background: T.panel, borderRight: `1.5px solid ${T.border}`, display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, overflowY: "auto" }}>
      {/* Logo lockup — logo IS the wordmark */}
      <div style={{ padding: "20px 18px 14px", borderBottom: `1.5px solid ${T.border}` }}>
        <a href="https://socialenviro.ie" target="_blank" rel="noreferrer" aria-label="Social Enviro home" style={{ display: "block", textDecoration: "none" }}>
          <img
            src={isDark ? "/logo-white.png" : "/logo-black.png"}
            alt="Social Enviro"
            onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "block"; }}
            style={{ height: 38, width: "auto", display: "block" }}
          />
          <div style={{ display: "none", fontSize: 18, fontWeight: 900, color: T.textStrong, letterSpacing: "-0.02em", lineHeight: 1 }}>SOCIAL ENVIRO</div>
        </a>
        <div style={{ marginTop: 8, fontSize: 9.5, color: T.muted, fontFamily: "var(--m)", letterSpacing: "0.18em", fontWeight: 700 }}>COMMAND&nbsp;OS</div>
      </div>

      {/* Brand switcher */}
      <div style={{ padding: "12px 14px", borderBottom: `1.5px solid ${T.border}` }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", marginBottom: 6, fontFamily: "var(--m)" }}>CLIENT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", borderRadius: 7, background: T.card, border: `1.5px solid ${T.border}` }}>
          <select value={activeIdx} onChange={e => setActiveIdx(parseInt(e.target.value, 10))} style={{ flex: 1, background: "transparent", color: T.textStrong, border: "none", outline: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>
            {brands.map((b, i) => <option key={i} value={i} style={{ background: T.elev, color: T.textStrong }}>{b.name}</option>)}
          </select>
          <button onClick={addBrand} title="Add brand" style={{ background: "transparent", border: "none", color: T.green, fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "0 4px" }}>+</button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
        {NAV_ITEMS.map(group => (
          <div key={group.section} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", padding: "4px 10px", marginBottom: 3, fontFamily: "var(--m)" }}>{group.section}</div>
            {group.items.map(it => {
              if (it.adminOnly && !hasAccess(currentUser?.role, "admin")) return null;
              const active = view === it.id;
              return (
                <button key={it.id} onClick={() => !it.soon && setView(it.id)} disabled={it.soon}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 7, border: "none", background: active ? "rgba(120,220,160,0.14)" : "transparent", color: active ? T.green : it.soon ? T.muted : T.text, cursor: it.soon ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, marginBottom: 1, textAlign: "left", fontFamily: "var(--h)" }}>
                  <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>{it.icon}</span>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.soon && <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 3, background: T.card, color: T.muted, fontWeight: 700, letterSpacing: "0.04em", fontFamily: "var(--m)" }}>SOON</span>}
                  {active && <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.green }} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: theme + user */}
      <div style={{ padding: "10px 12px", borderTop: `1.5px solid ${T.border}` }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button onClick={() => setTheme("light")} title="Light" style={{ flex: 1, padding: "5px", borderRadius: 6, border: `1.5px solid ${!isDark ? T.amber : T.border}`, background: !isDark ? "rgba(255,190,80,0.15)" : T.card, color: !isDark ? T.amber : T.muted, cursor: "pointer", fontSize: 13 }}>☀</button>
          <button onClick={() => setTheme("dark")} title="Dark" style={{ flex: 1, padding: "5px", borderRadius: 6, border: `1.5px solid ${isDark ? T.blue : T.border}`, background: isDark ? "rgba(120,170,237,0.15)" : T.card, color: isDark ? T.blue : T.muted, cursor: "pointer", fontSize: 13 }}>☾</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 9px", borderRadius: 7, background: T.card, border: `1.5px solid ${T.border}` }}>
          <Avatar user={currentUser} size={30} T={T} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: T.textStrong, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
            <div style={{ fontSize: 10.5, color: T.muted, fontFamily: "var(--m)" }}>{currentUser.role}</div>
          </div>
          <button onClick={signOut} title="Sign out" style={{ background: "transparent", border: "none", color: T.muted, cursor: "pointer", fontSize: 14 }}>↪</button>
        </div>
      </div>
    </div>
  );
}

/* ── PAGE HEADER ────────────────────────────────────────────────────────── */
function PageHeader({ icon, title, subtitle, right, T }) {
  return (
    <div style={{ padding: "20px 28px 16px", borderBottom: `1.5px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.textStrong, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 22 }}>{icon}</span>{title}
          </h1>
          {subtitle && <p style={{ margin: "5px 0 0", fontSize: 13.5, color: T.muted, lineHeight: 1.5, maxWidth: 720 }}>{subtitle}</p>}
        </div>
        {right && <div>{right}</div>}
      </div>
    </div>
  );
}

/* ── WATCHDOG (Command Centre) ─────────────────────────────────────────── */
function Watchdog({ T, theme, brands }) {
  const [tab, setTab] = useState("health");
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("A–Z");

  const counts = useMemo(() => {
    const c = { All: MOCK_BRANDS.length, Critical: 0, "High Risk": 0, Moderate: 0, Healthy: 0, "Upsell Ready": 0 };
    MOCK_BRANDS.forEach(b => { c[b.status] = (c[b.status] || 0) + 1; });
    return c;
  }, []);

  const filtered = useMemo(() => {
    let arr = filter === "All" ? [...MOCK_BRANDS] : MOCK_BRANDS.filter(b => b.status === filter);
    if (sort === "A–Z") arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "Priority") arr.sort((a, b) => b.priority - a.priority);
    if (sort === "Risk") arr.sort((a, b) => b.risk - a.risk);
    return arr;
  }, [filter, sort]);

  const totalAtRisk = MOCK_BRANDS.reduce((s, b) => s + (b.revenueAtRisk || 0), 0);
  const avgPriority = Math.round(MOCK_BRANDS.reduce((s, b) => s + b.priority, 0) / MOCK_BRANDS.length);

  const TABS = [
    { id: "health", label: "Health Board", icon: "🛡" },
    { id: "slack",  label: "Slack Intelligence", icon: "💬" },
    { id: "email",  label: "Email Intelligence", icon: "✉" },
    { id: "calls",  label: "Call Intelligence",  icon: "📞" },
    { id: "rules",  label: "Rules & Config",     icon: "⚙" },
  ];

  const FILTERS = [
    { k: "All", color: T.blue },
    { k: "Critical", color: STATUS_META.Critical.color },
    { k: "High Risk", color: STATUS_META["High Risk"].color },
    { k: "Moderate", color: STATUS_META.Moderate.color },
    { k: "Healthy", color: STATUS_META.Healthy.color },
    { k: "Upsell Ready", color: STATUS_META["Upsell Ready"].color },
  ];

  return (
    <div>
      <PageHeader T={T} icon="🛡" title="Watchdog" subtitle="Automated metric monitoring and client health scoring across all accounts." />

      <div style={{ padding: "16px 28px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: 4, background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 9, marginBottom: 16, width: "fit-content", maxWidth: "100%", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none", background: tab === t.id ? T.panel : "transparent", color: tab === t.id ? T.textStrong : T.muted, fontFamily: "var(--h)", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {tab === "health" && (
          <>
            {/* Filter pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {FILTERS.map(f => {
                const active = filter === f.k;
                const n = counts[f.k] || 0;
                return (
                  <button key={f.k} onClick={() => setFilter(f.k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, border: `1.5px solid ${active ? f.color : T.border}`, background: active ? f.color + "22" : T.card, color: active ? f.color : T.text, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>
                    <span style={{ background: f.color, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{n}</span>
                    {f.k}
                  </button>
                );
              })}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: T.muted }}>
                <span>avg priority <b style={{ color: T.text }}>{avgPriority}</b></span>
                <span style={{ color: T.red, fontWeight: 700 }}>${totalAtRisk.toLocaleString()} at risk</span>
              </div>
            </div>

            {/* Sort + actions */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 3, padding: 3, background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 7 }}>
                {["A–Z", "Priority", "Risk"].map(o => (
                  <button key={o} onClick={() => setSort(o)} style={{ padding: "5px 11px", borderRadius: 5, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "none", background: sort === o ? T.panel : "transparent", color: sort === o ? T.textStrong : T.muted, fontFamily: "var(--h)" }}>{o}</button>
                ))}
              </div>
              <button style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${T.green}`, background: "rgba(120,220,160,0.14)", color: T.green, fontFamily: "var(--h)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                ⟳ Run Evaluation
              </button>
            </div>

            {/* Brand cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
              {filtered.map(b => {
                const meta = STATUS_META[b.status];
                const isCritical = b.status === "Critical";
                return (
                  <div key={b.id} style={{ borderRadius: 11, border: `1.5px solid ${isCritical ? meta.color : T.border}`, background: T.panel, padding: "14px 16px", boxShadow: isCritical ? `0 0 0 2px ${meta.color}22` : "none" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 8, background: b.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, fontFamily: "var(--h)", flexShrink: 0 }}>{b.initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: T.textStrong, marginBottom: 4 }}>{b.name}</div>
                        <StatusBadge T={T} status={b.status} delta={b.delta} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <RiskDonut value={b.risk} T={T} size={56} />
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: T.blue, lineHeight: 1, fontFamily: "var(--m)" }}>{b.priority}</div>
                          <div style={{ fontSize: 8.5, fontWeight: 700, color: T.muted, letterSpacing: "0.07em", fontFamily: "var(--m)", marginTop: 2 }}>PRIORITY</div>
                        </div>
                      </div>
                    </div>

                    {/* Signals */}
                    <div style={{ marginTop: 14 }}>
                      {b.signals.length === 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", borderRadius: 7, background: "rgba(120,220,160,0.08)", border: `1.5px solid ${T.border}` }}>
                          <span style={{ color: T.green }}>✓</span>
                          <span style={{ fontSize: 12, color: T.text }}>No active risk signals</span>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {b.signals.map((s, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 11px", borderRadius: 7, background: s.kind === "bad" ? "rgba(255,84,112,0.08)" : "rgba(255,190,80,0.08)", border: `1.5px solid ${s.kind === "bad" ? "rgba(255,84,112,0.2)" : "rgba(255,190,80,0.2)"}` }}>
                              <span style={{ fontSize: 13 }}>{s.icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: T.textStrong }}>{s.title}</div>
                                <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{s.detail}</div>
                              </div>
                              {s.weight && <span style={{ fontSize: 11, color: s.kind === "bad" ? "#ff5470" : "#ffbe50", fontWeight: 800, fontFamily: "var(--m)" }}>+{s.weight}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.borderFaint}` }}>
                      <span style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>● {b.lastActivity}</span>
                      <span style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>{b.signals.length} signal{b.signals.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "slack" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "12px 14px", borderRadius: 9, background: T.card, border: `1.5px solid ${T.amber}40`, fontSize: 12.5, color: T.text, lineHeight: 1.5 }}>
              <b style={{ color: T.amber }}>DEMO:</b> Real version requires connecting your Slack workspace via OAuth. Once connected, this view ingests messages from client channels, classifies urgency, and surfaces requests that need a response.
            </div>
            {MOCK_SLACK.map(m => {
              const brand = MOCK_BRANDS.find(b => b.id === m.brandId);
              const u = m.urgency === "critical" ? "#ff5470" : m.urgency === "high" ? "#ff8a4a" : "#ffbe50";
              return (
                <div key={m.id} style={{ padding: "13px 16px", borderRadius: 9, background: T.panel, border: `1.5px solid ${T.border}`, borderLeft: `3px solid ${u}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: brand?.color || T.card, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 10, fontFamily: "var(--h)" }}>{brand?.initials}</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textStrong }}>{brand?.name}</span>
                    <span style={{ fontSize: 11.5, color: T.muted }}>{m.channel} · {m.from}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>{m.time}</span>
                    <span style={{ padding: "2px 8px", borderRadius: 999, background: u + "22", color: u, fontSize: 10.5, fontWeight: 700, fontFamily: "var(--m)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.urgency}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.55 }}>{m.text}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${T.green}`, background: "rgba(120,220,160,0.14)", color: T.green }}>+ Create task</button>
                    <button style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${T.border}`, background: T.card, color: T.text }}>Mark handled</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "calls" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: "12px 14px", borderRadius: 9, background: T.card, border: `1.5px solid ${T.amber}40`, fontSize: 12.5, color: T.text, lineHeight: 1.5 }}>
              <b style={{ color: T.amber }}>DEMO:</b> Real version pulls Gemini / Otter / Fireflies / Granola transcripts, summarizes, and suggests tasks per call.
            </div>
            {MOCK_CALL_NOTES.map(c => {
              const brand = MOCK_BRANDS.find(b => b.id === c.brandId);
              return (
                <div key={c.id} style={{ padding: "16px 18px", borderRadius: 9, background: T.panel, border: `1.5px solid ${T.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: brand?.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{brand?.initials}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: T.textStrong }}>{c.title}</div>
                      <div style={{ fontSize: 11.5, color: T.muted }}>{c.date} · {c.duration} · {c.attendees.join(", ")}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6, marginBottom: 10 }}>{c.summary}</div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontFamily: "var(--m)" }}>Suggested actions</div>
                    {c.actions.map((a, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12.5, color: T.text }}>
                        <span style={{ color: T.green }}>→</span> {a}
                        <button style={{ marginLeft: "auto", padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${T.border}`, background: T.card, color: T.text }}>Create task</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(tab === "email" || tab === "rules") && (
          <div style={{ padding: "32px 24px", textAlign: "center", borderRadius: 11, border: `1.5px dashed ${T.border}`, background: T.card }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚧</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.textStrong, marginBottom: 4 }}>Coming soon</div>
            <div style={{ fontSize: 12.5, color: T.muted, maxWidth: 400, margin: "0 auto" }}>
              {tab === "email" ? "Gmail OAuth integration to scan client threads for sentiment and unanswered requests." : "Configure scoring weights, alert thresholds, and signal sources."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── MISSION CONTROL ───────────────────────────────────────────────────── */
function MissionControl({ T, currentUser, setView, setTaskFilter }) {
  const myTasks = MOCK_TASKS.filter(t => t.assignee === currentUser.id && t.status !== "done");
  const criticalBrands = MOCK_BRANDS.filter(b => b.status === "Critical" || b.status === "High Risk").sort((a, b) => b.priority - a.priority);
  const dueToday = MOCK_TASKS.filter(t => (t.due === "today" || t.due === "tomorrow") && t.status !== "done");
  const pendingApprovals = MOCK_APPROVALS;
  const totalAtRisk = MOCK_BRANDS.reduce((s, b) => s + (b.revenueAtRisk || 0), 0);

  const StatCard = ({ label, value, sub, color, onClick }) => (
    <button onClick={onClick} style={{ padding: "16px 18px", borderRadius: 10, background: T.panel, border: `1.5px solid ${T.border}`, textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--h)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--m)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || T.textStrong, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5 }}>{sub}</div>}
    </button>
  );

  return (
    <div>
      <PageHeader T={T} icon="🎯" title="Mission Control" subtitle={`Welcome back, ${currentUser.name.split(" ")[0]}. Here's what needs your attention right now.`} />

      <div style={{ padding: "16px 28px" }}>
        {/* Top stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 22 }}>
          <StatCard label="My Open Tasks" value={myTasks.length} sub="Across all clients" color={T.green} onClick={() => setView("tasks")} />
          <StatCard label="Critical Clients" value={criticalBrands.length} sub="Need intervention" color={T.red} onClick={() => setView("watchdog")} />
          <StatCard label="Awaiting Approval" value={pendingApprovals.length} sub="In review queue" color={T.amber} onClick={() => setView("approvals")} />
          <StatCard label="Due Today / Tomorrow" value={dueToday.length} sub="Across the team" color={T.blue} onClick={() => setView("tasks")} />
          <StatCard label="Revenue at Risk" value={`$${totalAtRisk.toLocaleString()}`} sub="From at-risk accounts" color={T.red} onClick={() => setView("watchdog")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* My tasks */}
          <div style={{ borderRadius: 10, background: T.panel, border: `1.5px solid ${T.border}`, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T.textStrong }}>📌 My Tasks</h3>
              <button onClick={() => setView("tasks")} style={{ background: "transparent", border: "none", color: T.green, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>View all →</button>
            </div>
            {myTasks.length === 0 ? (
              <div style={{ padding: "20px 0", fontSize: 13, color: T.muted, textAlign: "center" }}>You're all caught up 🎉</div>
            ) : myTasks.map(t => {
              const brand = MOCK_BRANDS.find(b => b.id === t.brandId);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${T.borderFaint}` }}>
                  <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: t.priority === "Critical" ? "#ff5470" : t.priority === "High" ? "#ff8a4a" : t.priority === "Medium" ? "#ffbe50" : "#78dca0" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>{brand?.name} · {t.type} · due {t.due}</div>
                  </div>
                  <PriorityChip priority={t.priority} T={T} />
                </div>
              );
            })}
          </div>

          {/* Critical clients */}
          <div style={{ borderRadius: 10, background: T.panel, border: `1.5px solid ${T.border}`, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T.textStrong }}>🚨 Clients in need of care</h3>
              <button onClick={() => setView("watchdog")} style={{ background: "transparent", border: "none", color: T.green, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Watchdog →</button>
            </div>
            {criticalBrands.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${T.borderFaint}` }}>
                <div style={{ width: 32, height: 32, borderRadius: 7, background: b.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11 }}>{b.initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textStrong, marginBottom: 2 }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>Risk {b.risk} · Priority {b.priority}{b.revenueAtRisk ? ` · $${b.revenueAtRisk.toLocaleString()} at risk` : ""}</div>
                </div>
                <StatusBadge status={b.status} delta={b.delta} T={T} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── TASKS ─────────────────────────────────────────────────────────────── */
function TasksView({ T, currentUser, brands }) {
  const [tasks, setTasks] = useState(MOCK_TASKS);
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterBrand, setFilterBrand] = useState("all");
  const [showNew, setShowNew] = useState(false);

  const filtered = tasks.filter(t =>
    (filterAssignee === "all" || t.assignee === filterAssignee) &&
    (filterBrand === "all" || t.brandId === filterBrand)
  );

  const moveTask = (id, status) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  const addTask = (data) => {
    setTasks(prev => [{ id: `t_${Date.now()}`, status: "todo", createdBy: currentUser.id, ...data }, ...prev]);
    setShowNew(false);
  };

  return (
    <div>
      <PageHeader T={T} icon="✅" title="Tasks" subtitle="Assign and track creative briefs, static & video ads, copy, design and strategy work across the team."
        right={<button onClick={() => setShowNew(true)} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontFamily: "var(--h)" }}>+ New Task</button>} />

      <div style={{ padding: "16px 28px" }}>
        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--h)" }}>
            <option value="all" style={{ background: T.elev }}>All assignees</option>
            <option value={currentUser.id} style={{ background: T.elev }}>Just me</option>
            {TEAM.map(u => <option key={u.id} value={u.id} style={{ background: T.elev }}>{u.name}</option>)}
          </select>
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--h)" }}>
            <option value="all" style={{ background: T.elev }}>All clients</option>
            {MOCK_BRANDS.map(b => <option key={b.id} value={b.id} style={{ background: T.elev }}>{b.name}</option>)}
          </select>
          <div style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>{filtered.length} task{filtered.length === 1 ? "" : "s"}</div>
        </div>

        {/* Kanban */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {TASK_STATUSES.map(col => {
            const items = filtered.filter(t => t.status === col.id);
            return (
              <div key={col.id} style={{ background: T.card, borderRadius: 10, border: `1.5px solid ${T.border}`, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8, minHeight: 200 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: T.textStrong, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--m)" }}>{col.label}</div>
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>{items.length}</span>
                </div>
                {items.map(t => {
                  const brand = MOCK_BRANDS.find(b => b.id === t.brandId);
                  const user = TEAM.find(u => u.id === t.assignee);
                  return (
                    <div key={t.id} style={{ padding: "10px 11px", borderRadius: 8, background: T.panel, border: `1.5px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: T.card, color: T.muted, fontWeight: 700, fontFamily: "var(--m)" }}>{t.type}</span>
                        <PriorityChip priority={t.priority} T={T} />
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, lineHeight: 1.4 }}>{t.title}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {brand && <div style={{ width: 18, height: 18, borderRadius: 4, background: brand.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 8 }}>{brand.initials}</div>}
                          <span style={{ fontSize: 10.5, color: T.muted, fontFamily: "var(--m)" }}>{brand?.name}</span>
                        </div>
                        <Avatar user={user} size={20} T={T} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, paddingTop: 6, borderTop: `1px solid ${T.borderFaint}` }}>
                        <span style={{ fontSize: 10.5, color: T.muted, fontFamily: "var(--m)" }}>due {t.due}</span>
                        <select value={t.status} onChange={e => moveTask(t.id, e.target.value)} style={{ background: "transparent", border: "none", color: T.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "var(--h)" }}>
                          {TASK_STATUSES.map(s => <option key={s.id} value={s.id} style={{ background: T.elev, color: T.text }}>→ {s.label}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11.5, color: T.muted }}>—</div>}
              </div>
            );
          })}
        </div>
      </div>

      {showNew && <NewTaskModal T={T} onClose={() => setShowNew(false)} onCreate={addTask} currentUser={currentUser} />}
    </div>
  );
}

function NewTaskModal({ T, onClose, onCreate, currentUser }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Static Ads");
  const [priority, setPriority] = useState("Medium");
  const [assignee, setAssignee] = useState(currentUser.id);
  const [brandId, setBrandId] = useState(MOCK_BRANDS[0]?.id || "");
  const [due, setDue] = useState("+3d");

  const create = () => {
    if (!title.trim()) return alert("Title required");
    onCreate({ title: title.trim(), type, priority, assignee, brandId, due });
  };

  const Field = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: T.label, letterSpacing: "0.01em" }}>{label}</label>
      {children}
    </div>
  );
  const inputStyle = { padding: "8px 10px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.textStrong, fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "var(--h)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: T.bg, borderRadius: 12, border: `1.5px solid ${T.border}`, padding: "22px 24px", boxShadow: "0 16px 60px rgba(0,0,0,0.5)" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 800, color: T.textStrong }}>New task</h3>
        <Field label="Title">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Static ad set for spring drop" style={inputStyle} autoFocus />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Field label="Type"><select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>{TASK_TYPES.map(t => <option key={t} style={{ background: T.elev }}>{t}</option>)}</select></Field>
          <Field label="Priority"><select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>{TASK_PRIORITIES.map(p => <option key={p} style={{ background: T.elev }}>{p}</option>)}</select></Field>
          <Field label="Client"><select value={brandId} onChange={e => setBrandId(e.target.value)} style={inputStyle}>{MOCK_BRANDS.map(b => <option key={b.id} value={b.id} style={{ background: T.elev }}>{b.name}</option>)}</select></Field>
          <Field label="Assignee"><select value={assignee} onChange={e => setAssignee(e.target.value)} style={inputStyle}>{TEAM.map(u => <option key={u.id} value={u.id} style={{ background: T.elev }}>{u.name}</option>)}</select></Field>
          <Field label="Due"><input value={due} onChange={e => setDue(e.target.value)} placeholder="+3d, today, tomorrow…" style={inputStyle} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>Cancel</button>
          <button onClick={create} style={{ padding: "8px 18px", borderRadius: 7, border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "var(--h)" }}>Create task</button>
        </div>
      </div>
    </div>
  );
}

/* ── APPROVALS ─────────────────────────────────────────────────────────── */
function ApprovalsView({ T, currentUser }) {
  const [items, setItems] = useState(MOCK_APPROVALS);
  const [feedback, setFeedback] = useState({});

  const approve = (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
    alert("✓ Approved. In production this notifies the assignee on Slack.");
  };
  const reject = (id) => {
    if (!feedback[id]?.trim()) return alert("Add feedback first.");
    setItems(prev => prev.filter(i => i.id !== id));
    setFeedback(prev => ({ ...prev, [id]: "" }));
    alert("Sent back with feedback. In production this re-opens the task and notifies on Slack.");
  };

  return (
    <div>
      <PageHeader T={T} icon="👁" title="Approvals" subtitle="Review work submitted by the team. Approve to ship, or send back with feedback." />

      <div style={{ padding: "16px 28px" }}>
        {items.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", borderRadius: 10, border: `1.5px dashed ${T.border}`, background: T.card }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.textStrong, marginBottom: 4 }}>Inbox zero</div>
            <div style={{ fontSize: 13, color: T.muted }}>Nothing pending approval right now.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
            {items.map(it => {
              const brand = MOCK_BRANDS.find(b => b.id === it.brandId);
              const submittedBy = TEAM.find(u => u.id === it.submittedBy);
              return (
                <div key={it.id} style={{ borderRadius: 11, border: `1.5px solid ${T.border}`, background: T.panel, overflow: "hidden" }}>
                  {/* Preview area */}
                  <div style={{ height: 140, background: brand?.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60 }}>
                    {it.thumbnail || "📦"}
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: T.card, color: T.muted, fontWeight: 700, fontFamily: "var(--m)" }}>{it.type}</span>
                      {brand && <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: brand.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 7 }}>{brand.initials}</div>
                        <span style={{ fontSize: 11, color: T.muted, fontFamily: "var(--m)" }}>{brand.name}</span>
                      </div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.textStrong, marginBottom: 8, lineHeight: 1.4 }}>{it.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                      <Avatar user={submittedBy} size={22} T={T} />
                      <span style={{ fontSize: 11.5, color: T.muted }}>{submittedBy?.name} submitted {it.submitted}</span>
                    </div>
                    <textarea value={feedback[it.id] || ""} onChange={e => setFeedback(p => ({ ...p, [it.id]: e.target.value }))} placeholder="Optional feedback (required to send back)" rows={2}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.textStrong, fontSize: 12, fontFamily: "var(--h)", outline: "none", resize: "vertical", marginBottom: 10 }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => reject(it.id)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1.5px solid ${T.amber}`, background: "rgba(255,190,80,0.15)", color: T.amber, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--h)" }}>↩ Send back</button>
                      <button onClick={() => approve(it.id)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--h)" }}>✓ Approve</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── SLACK / CALLS standalone (re-uses Watchdog tabs but as full pages) ── */
function SlackInbox({ T }) {
  return (
    <div>
      <PageHeader T={T} icon="💬" title="Slack Inbox" subtitle="Client messages from connected Slack channels, scored by urgency." />
      <div style={{ padding: "16px 28px" }}>
        <Watchdog T={T} brands={[]} />
      </div>
    </div>
  );
}

/* ── SIGN IN ───────────────────────────────────────────────────────────── */
function SignIn({ T, theme, onSignIn }) {
  const [user, setUser] = useState(TEAM[0].id);
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 380, padding: "30px 28px", borderRadius: 14, background: T.panel, border: `1.5px solid ${T.border}`, boxShadow: "0 14px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ marginBottom: 22, textAlign: "center" }}>
          <img src={theme === "dark" ? "/logo-white.png" : "/logo-black.png"} alt="Social Enviro" onError={e => { e.currentTarget.style.display = "none"; }} style={{ height: 48, width: "auto" }} />
          <div style={{ marginTop: 8, fontSize: 10, color: T.muted, fontFamily: "var(--m)", letterSpacing: "0.22em", fontWeight: 700 }}>COMMAND&nbsp;OS</div>
        </div>
        <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.5, marginBottom: 20 }}>
          Sign in to your team account.
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6 }}>
            <b style={{ color: T.amber }}>DEMO MODE:</b> pick a team member to impersonate. Production uses Google SSO.
          </div>
        </div>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: T.label, display: "block", marginBottom: 5 }}>Sign in as</label>
        <select value={user} onChange={e => setUser(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.border}`, background: T.inputBg, color: T.textStrong, fontSize: 14, fontWeight: 700, cursor: "pointer", outline: "none", fontFamily: "var(--h)", marginBottom: 16 }}>
          {TEAM.map(u => <option key={u.id} value={u.id} style={{ background: T.elev }}>{u.name} — {u.role}</option>)}
        </select>
        <button onClick={() => onSignIn(TEAM.find(u => u.id === user))} style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: `1.5px solid ${T.green}`, background: T.green, color: "#0c0e16", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--h)" }}>Sign in →</button>
      </div>
    </div>
  );
}

/* ── ROOT APP (router shell) ───────────────────────────────────────────── */
const LS_USER = "se.user";
const LS_VIEW = "se.view";

/* ── STANDALONE PUBLIC PROFIT MATRIX ────────────────────────────────────
   Rendered when the URL contains #/profit-matrix
   No sign-in, no sidebar. Just the tool + Social Enviro branding + CTA.
   Share this link publicly: yoursite.com/#/profit-matrix
   ──────────────────────────────────────────────────────────────────────── */
function StandaloneMatrix() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem(LS_THEME) || "dark"; } catch { return "dark"; } });
  const T = THEMES[theme];
  const isDark = theme === "dark";
  useEffect(() => { try { localStorage.setItem(LS_THEME, theme); } catch {} }, [theme]);

  const [brands, setBrands] = useState(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return DEFAULT_BRANDS;
  });
  const [activeIdx, setActiveIdx] = useState(() => { try { const v = parseInt(localStorage.getItem(LS_ACTIVE) || "0", 10); return isNaN(v) ? 0 : v; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(brands)); } catch {} }, [brands]);
  useEffect(() => { try { localStorage.setItem(LS_ACTIVE, String(activeIdx)); } catch {} }, [activeIdx]);

  const addBrand = () => {
    const name = prompt("Brand name?", `Brand ${brands.length + 1}`);
    if (!name) return;
    setBrands(prev => [...prev, newBrand(name)]);
    setActiveIdx(brands.length);
  };
  const renameBrand = () => {
    const name = prompt("Rename brand:", brands[activeIdx]?.name);
    if (!name) return;
    setBrands(prev => prev.map((b, i) => i === activeIdx ? { ...b, name } : b));
  };
  const deleteBrand = () => {
    if (brands.length === 1) return alert("At least one brand is required.");
    if (!confirm(`Delete "${brands[activeIdx]?.name}"?`)) return;
    setBrands(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
  };

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:${T.borderStrong};border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.5}body{margin:0}:focus-visible{outline:2px solid ${T.blue};outline-offset:2px;border-radius:4px}button:focus:not(:focus-visible),a:focus:not(:focus-visible){outline:none}`}</style>

      {/* Public header */}
      <div style={{ padding: "14px 24px", borderBottom: `1.5px solid ${T.border}`, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <a href="https://socialenviro.ie" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}>
          <img src={isDark ? "/logo-white.png" : "/logo-black.png"} alt="Social Enviro" onError={e => { e.currentTarget.style.display = "none"; }}
            style={{ height: 40, width: "auto" }} />
          <div style={{ paddingLeft: 14, borderLeft: `1.5px solid ${T.border}` }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", color: T.textStrong, lineHeight: 1.1 }}>Profit Matrix</div>
            <div style={{ fontSize: 10.5, color: T.muted, fontFamily: "var(--m)", letterSpacing: "0.12em", fontWeight: 700, marginTop: 3 }}>FREE TOOL</div>
          </div>
        </a>

        <div style={{ flex: 1 }} />

        {/* Brand switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 6px 5px 10px", background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 8 }}>
          <span style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--m)", fontWeight: 700 }}>Brand</span>
          <select value={activeIdx} onChange={e => setActiveIdx(parseInt(e.target.value, 10))} style={{ background: "transparent", color: T.textStrong, border: "none", outline: "none", fontSize: 13, fontWeight: 700, padding: "4px 6px", cursor: "pointer", fontFamily: "var(--h)" }}>
            {brands.map((b, i) => <option key={i} value={i} style={{ background: T.elev, color: T.textStrong }}>{b.name}</option>)}
          </select>
          <button onClick={renameBrand} title="Rename" style={{ background: "transparent", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", padding: 4 }}>✎</button>
          <button onClick={addBrand} title="Add" style={{ background: "transparent", border: "none", color: T.green, fontSize: 15, cursor: "pointer", padding: 4, fontWeight: 700 }}>+</button>
          {brands.length > 1 && <button onClick={deleteBrand} title="Delete" style={{ background: "transparent", border: "none", color: T.red, fontSize: 13, cursor: "pointer", padding: 4 }}>✕</button>}
        </div>

        <button onClick={() => setTheme(isDark ? "light" : "dark")} title="Toggle theme"
          style={{ padding: "7px 11px", borderRadius: 7, border: `1.5px solid ${T.border}`, background: T.card, color: T.textStrong, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "var(--h)" }}>
          {isDark ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      <ErrorBoundary T={T}>
        <ProfitMatrixView T={T} theme={theme} isDark={isDark} brands={brands} setBrands={setBrands} activeIdx={activeIdx} />
      </ErrorBoundary>
    </div>
  );
}

/* ── ROOT APP (hash router) ────────────────────────────────────────────── */
export default function App() {
  // Hash-based routing: #/profit-matrix renders standalone public tool
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isPublicMatrix = hash === "#/profit-matrix" || hash === "#/profit-matrix/";

  // If public route, render standalone (no auth, no sidebar)
  if (isPublicMatrix) return <StandaloneMatrix />;

  // Otherwise render full platform
  return <Platform />;
}

/* ── PLATFORM (full agency app with auth + sidebar) ────────────────────── */
function Platform() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem(LS_THEME) || "dark"; } catch { return "dark"; } });
  const T = THEMES[theme];
  const isDark = theme === "dark";
  useEffect(() => { try { localStorage.setItem(LS_THEME, theme); } catch {} }, [theme]);

  const [brands, setBrands] = useState(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return DEFAULT_BRANDS;
  });
  const [activeIdx, setActiveIdx] = useState(() => { try { const v = parseInt(localStorage.getItem(LS_ACTIVE) || "0", 10); return isNaN(v) ? 0 : v; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(brands)); } catch {} }, [brands]);
  useEffect(() => { try { localStorage.setItem(LS_ACTIVE, String(activeIdx)); } catch {} }, [activeIdx]);

  const addBrand = () => {
    const name = prompt("Brand name?", `Brand ${brands.length + 1}`);
    if (!name) return;
    setBrands(prev => [...prev, newBrand(name)]);
    setActiveIdx(brands.length);
  };

  const [view, setView] = useState(() => { try { return localStorage.getItem(LS_VIEW) || "watchdog"; } catch { return "watchdog"; } });
  useEffect(() => { try { localStorage.setItem(LS_VIEW, view); } catch {} }, [view]);

  return (
    <AuthGate T={T} theme={theme}>
      {({ user: currentUser, signOut }) => {
        const renderView = () => {
          switch (view) {
            case "watchdog":  return <Watchdog T={T} theme={theme} brands={brands} />;
            case "mission":   return <MissionControl T={T} currentUser={currentUser} setView={setView} />;
            case "tasks":     return <TasksView T={T} currentUser={currentUser} brands={brands} />;
            case "approvals": return <ApprovalsView T={T} currentUser={currentUser} />;
            case "matrix":    return <ProfitMatrixView T={T} theme={theme} isDark={isDark} brands={brands} setBrands={setBrands} activeIdx={activeIdx} />;
            case "team":      return <TeamManagement T={T} currentUser={currentUser} />;
            case "slack":     return <Watchdog T={T} theme={theme} brands={brands} />;
            case "calls":     return <Watchdog T={T} theme={theme} brands={brands} />;
            default:          return <Watchdog T={T} theme={theme} brands={brands} />;
          }
        };

        return (
          <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "var(--h)", display: "flex" }}>
            <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:${T.borderStrong};border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.5}body{margin:0}:focus-visible{outline:2px solid ${T.blue};outline-offset:2px;border-radius:4px}button:focus:not(:focus-visible),a:focus:not(:focus-visible){outline:none}`}</style>
            <Sidebar T={T} theme={theme} setTheme={setTheme} isDark={isDark} view={view} setView={setView} brands={brands} activeIdx={activeIdx} setActiveIdx={setActiveIdx} addBrand={addBrand} currentUser={currentUser} signOut={signOut} />
            <div style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
              <ErrorBoundary T={T} key={view}>{renderView()}</ErrorBoundary>
            </div>
          </div>
        );
      }}
    </AuthGate>
  );
}

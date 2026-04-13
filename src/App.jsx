import { useState, useMemo, useCallback } from "react";

/* ── DEFAULTS ── */
const DEFAULTS = {
  mode: "simplified",
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
  repeatRate: 35, avgOrdersPerRepeater: 3.8,
  avgRepeatCycleMonths: 2.5,
  monthlyFixedCosts: 35000,
  roasMin: 1.0, roasMax: 5.0, roasStep: 0.5,
  spendMin: 10000, spendMax: 200000, spendSteps: 8,
  // Current
  currentSpend: 50000, currentRoas: 2.5,
  currentNewCustomers: 0, // 0 = auto-derive from model
};

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
  spendStep: "Each column of the grid goes up by this amount. Example: $10K start + $20K step = columns at $10K, $30K, $50K…",
  roasStep: "Each row of the grid goes up by this amount. Example: 1.0x start + 0.5x step = rows at 1.0x, 1.5x, 2.0x…",
  avgVarCost: "Average Variable Costs % = share of revenue eaten by COGS + shipping + payment fees + other per-order costs.",
  currentNewCust: "Actual new paid customers you're getting per month. Overrides the model's estimate so your real NC-CPA and payback are accurate. Leave 0 to let the model estimate.",
};

/* ── HEAT COLOR ── */
function hc(value, min, max) {
  if (max === min) return "rgba(100,100,120,0.12)";
  if (value < 0) {
    const t = Math.min(1, Math.abs(value) / Math.max(1, Math.abs(min)));
    return `rgba(${Math.round(180 + 60 * t)},${Math.round(70 - 30 * t)},${Math.round(70 - 30 * t)},${0.18 + 0.55 * t})`;
  }
  const t = Math.min(1, value / Math.max(1, max));
  return `rgba(${Math.round(40 + 20 * t)},${Math.round(110 + 120 * t)},${Math.round(70 + 40 * t)},${0.14 + 0.55 * t})`;
}

/* ── MODE DERIVATION ── */
function deriveEffective(I) {
  if (I.mode === "simplified") {
    const gm = Math.max(0, 100 - I.avgVarCostPct);
    const spendMin = I.spendMin;
    const steps = 8;
    const spendMax = spendMin + steps * I.spendStep;
    const roasMin = I.roasMin;
    const roasMax = roasMin + 8 * I.roasStep;
    return {
      ...I,
      newAov: I.simpleAov,
      retAov: I.simpleAov,
      grossMarginPct: gm,
      shippingPerOrder: 0,
      processingPct: 0,
      otherVarPerOrder: 0,
      otherVarPctRevenue: 0,
      newCustPctBase: DEFAULTS.newCustPctBase,
      newCustPctAtMaxSpend: DEFAULTS.newCustPctAtMaxSpend,
      repeatRate: DEFAULTS.repeatRate,
      avgOrdersPerRepeater: DEFAULTS.avgOrdersPerRepeater,
      avgRepeatCycleMonths: DEFAULTS.avgRepeatCycleMonths,
      organicNewPct: DEFAULTS.organicNewPct,
      spendMin, spendMax, spendSteps: steps,
      roasMin, roasMax,
    };
  }
  return I;
}

/* ── ENGINE ── */
function computeOne(I, spend, roas, spendMin, spendMax, oContrib, nOP, rOP, expRepeats, ltvP, overrideNewCust) {
  const t = spendMax > spendMin ? Math.max(0, Math.min(1, (spend - spendMin) / (spendMax - spendMin))) : 0;
  const nP = (I.newCustPctBase + t * (I.newCustPctAtMaxSpend - I.newCustPctBase)) / 100;
  const pAov = nP * I.newAov + (1 - nP) * I.retAov;
  const pR = spend * roas, tR = pR + I.monthlyOrganicRevenue, mer = spend > 0 ? tR / spend : 0;
  const pO = pAov > 0 ? pR / pAov : 0;
  let pNO = pO * nP;
  let pRO = pO * (1 - nP);
  if (overrideNewCust && overrideNewCust > 0) {
    pNO = overrideNewCust;
    pRO = Math.max(0, pO - pNO);
  }
  const ncCpa = pNO > 0 ? spend / pNO : Infinity;
  const cpa = pO > 0 ? spend / pO : Infinity;
  const ncRoas = pNO > 0 ? (pNO * I.newAov) / spend : 0;
  const pC = pNO * nOP + pRO * rOP - spend;
  const tC = pC + oContrib, net = tC - I.monthlyFixedCosts;
  const futRP = pNO * expRepeats * rOP;
  const ltvNet = net + futRP;
  const gap = ncCpa - nOP;
  let pbMo = 0;
  if (gap > 0 && rOP > 0 && I.avgRepeatCycleMonths > 0) {
    const mRP = rOP / I.avgRepeatCycleMonths * (I.repeatRate / 100);
    pbMo = mRP > 0 ? gap / mRP : Infinity;
  }
  const ltcac = ncCpa > 0 && isFinite(ncCpa) ? ltvP / ncCpa : 0;
  return { spend, roas, paidRev: pR, totalRev: tR, mer, paidOrders: pO, paidNewOrders: pNO, paidRetOrders: pRO, ncCpa, cpa, ncRoas, paidContrib: pC, totalContrib: tC, netProfit: net, ltvAdjustedNet: ltvNet, futureRepeatProfit: futRP, paybackMonths: pbMo, ltvCac: ltcac, newPct: nP };
}

// Grid is organized [roasIndex][spendIndex] — ROAS is rows, Spend is columns.
function compute(I, roasVals, spendVals) {
  const gm = I.grossMarginPct / 100, proc = I.processingPct / 100, oVP = I.otherVarPctRevenue / 100, oVO = I.shippingPerOrder + I.otherVarPerOrder;
  const ppo = (aov) => aov * gm - aov * proc - aov * oVP - oVO;
  const nOP = ppo(I.newAov), rOP = ppo(I.retAov);
  const expRepeats = (I.repeatRate / 100) * I.avgOrdersPerRepeater;
  const ltvP = nOP + expRepeats * rOP;
  const ltvR = I.newAov + expRepeats * I.retAov;
  const ltvMonths = expRepeats * I.avgRepeatCycleMonths;
  const beCpa1 = nOP, beCpaLtv = ltvP;

  const oR = I.monthlyOrganicRevenue, oNP = I.organicNewPct / 100;
  const oAov = oNP * I.newAov + (1 - oNP) * I.retAov;
  const oOrd = oR > 0 && oAov > 0 ? oR / oAov : 0;
  const oNew = oOrd * oNP, oRet = oOrd * (1 - oNP);
  const oContrib = oNew * nOP + oRet * rOP;

  // grid[ri][si]  — rows = roas, cols = spend
  const grid = roasVals.map((roas) => spendVals.map((spend, si) => {
    const t = spendVals.length > 1 ? si / (spendVals.length - 1) : 0;
    const nP = (I.newCustPctBase + t * (I.newCustPctAtMaxSpend - I.newCustPctBase)) / 100;
    const pAov = nP * I.newAov + (1 - nP) * I.retAov;
    const pR = spend * roas, tR = pR + oR, mer = spend > 0 ? tR / spend : 0;
    const pO = pAov > 0 ? pR / pAov : 0;
    const pNO = pO * nP, pRO = pO * (1 - nP);
    const ncCpa = pNO > 0 ? spend / pNO : Infinity;
    const cpa = pO > 0 ? spend / pO : Infinity;
    const ncRoas = pNO > 0 ? (pNO * I.newAov) / spend : 0;
    const pC = pNO * nOP + pRO * rOP - spend;
    const tC = pC + oContrib, net = tC - I.monthlyFixedCosts;
    const futRP = pNO * expRepeats * rOP;
    const ltvNet = net + futRP;
    const gap = ncCpa - nOP;
    let pbMo = 0;
    if (gap > 0 && rOP > 0 && I.avgRepeatCycleMonths > 0) {
      const mRP = rOP / I.avgRepeatCycleMonths * (I.repeatRate / 100);
      pbMo = mRP > 0 ? gap / mRP : Infinity;
    }
    const ltcac = ncCpa > 0 && isFinite(ncCpa) ? ltvP / ncCpa : 0;
    return { spend, roas, paidRev: pR, totalRev: tR, mer, paidOrders: pO, paidNewOrders: pNO, paidRetOrders: pRO, ncCpa, cpa, ncRoas, paidContrib: pC, totalContrib: tC, netProfit: net, ltvAdjustedNet: ltvNet, futureRepeatProfit: futRP, paybackMonths: pbMo, ltvCac: ltcac, newPct: nP };
  }));

  const spendMin = spendVals[0] ?? I.spendMin;
  const spendMax = spendVals[spendVals.length - 1] ?? I.spendMax;
  const current = computeOne(I, I.currentSpend, I.currentRoas, spendMin, spendMax, oContrib, nOP, rOP, expRepeats, ltvP, I.currentNewCustomers);

  let nearestRi = 0, nearestSi = 0, nearestD = Infinity;
  roasVals.forEach((r, ri) => spendVals.forEach((sv, si) => {
    const ds = Math.abs(sv - I.currentSpend) / Math.max(1, spendMax - spendMin);
    const roasRange = (roasVals[roasVals.length - 1] || 1) - (roasVals[0] || 0);
    const dr = Math.abs(r - I.currentRoas) / Math.max(0.01, roasRange);
    const d = ds * ds + dr * dr;
    if (d < nearestD) { nearestD = d; nearestRi = ri; nearestSi = si; }
  }));

  return { grid, nOP, rOP, ltvP, ltvR, expRepeats, ltvMonths, beCpa1, beCpaLtv, oContrib, oR, oOrd, oNew, current, nearestRi, nearestSi };
}

/* ── TOOLTIP COMPONENT ── */
function Tip({ text, inline }) {
  const [show, setShow] = useState(false);
  return (
    <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)} tabIndex={0}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.08)", color: "#9aa0c0", fontSize: 9, fontWeight: 700, marginLeft: inline ? 4 : 6, cursor: "help", position: "relative", verticalAlign: "middle", lineHeight: 1 }}>
      ?
      {show && (
        <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#1a1d2e", border: "1.5px solid rgba(255,255,255,0.18)", borderRadius: 7, padding: "9px 11px", fontSize: 12, lineHeight: 1.5, color: "#e8eaf2", width: 240, zIndex: 100, boxShadow: "0 6px 20px rgba(0,0,0,0.5)", fontWeight: 500, textAlign: "left", pointerEvents: "none", fontFamily: "var(--h)" }}>
          {text}
        </span>
      )}
    </span>
  );
}

/* ── COMPONENTS ── */
function Inp({ label, value, onChange, pre, suf, step, min, max, tip, help }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#d8dae8", letterSpacing: "0.01em", display: "flex", alignItems: "center" }}>
        {label}{tip && <Tip text={tip} />}
      </label>
      <div style={{ display: "flex", alignItems: "center", background: "#1a1d2e", border: "1.5px solid rgba(255,255,255,0.1)", borderRadius: 7, padding: "7px 9px", gap: 4 }}>
        {pre && <span style={{ color: "#8a8fa8", fontSize: 14, fontWeight: 600 }}>{pre}</span>}
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} step={step || 1} min={min} max={max}
          style={{ background: "transparent", border: "none", outline: "none", color: "#ffffff", fontSize: 15, fontWeight: 600, width: "100%", fontFamily: "var(--m)" }} />
        {suf && <span style={{ color: "#8a8fa8", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{suf}</span>}
      </div>
      {help && <span style={{ fontSize: 11, color: "#8a8fa8", lineHeight: 1.4 }}>{help}</span>}
    </div>
  );
}

function Sec({ label, open, onToggle, children, badge, sub, accent }) {
  const bg = accent === "you" ? "rgba(255,190,80,0.05)" : "rgba(255,255,255,0.02)";
  const border = accent === "you" ? "rgba(255,190,80,0.25)" : "rgba(255,255,255,0.06)";
  const arrow = accent === "you" ? "#ffbe50" : "#78dca0";
  return (
    <div style={{ marginBottom: 8, background: bg, borderRadius: 9, border: `1.5px solid ${border}`, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", padding: "11px 13px", width: "100%", textAlign: "left" }}>
        <span style={{ fontSize: 11, color: arrow, transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block", fontWeight: 700 }}>▶</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.01em" }}>{label}</span>
            {badge && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: accent === "you" ? "rgba(255,190,80,0.15)" : "rgba(120,220,160,0.12)", color: accent === "you" ? "#ffbe50" : "#78dca0", fontFamily: "var(--m)", fontWeight: 700, letterSpacing: "0.05em" }}>{badge}</span>}
          </div>
          {sub && <div style={{ fontSize: 11.5, color: "#8a8fa8", marginTop: 2 }}>{sub}</div>}
        </div>
      </button>
      {open && <div style={{ padding: "12px 14px 14px" }}>{children}</div>}
    </div>
  );
}

// Compact metric (inline pill style for dense top bar)
function MetPill({ label, tip, value, sub, color, you }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 7, background: you ? "rgba(255,190,80,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${you ? "rgba(255,190,80,0.3)" : "rgba(255,255,255,0.08)"}`, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: you ? "#ffbe50" : "#8a8fa8", letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "var(--m)", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {you && <span style={{ marginRight: 4 }}>●</span>}{label}{tip && <Tip text={tip} />}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || "#ffffff", letterSpacing: "-0.015em", lineHeight: 1.2, fontFamily: "var(--h)", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#8a8fa8", marginTop: 1, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function LD({ color, label }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: color }} /><span style={{ fontSize: 12, color: "#b8bcd0", fontWeight: 500 }}>{label}</span></div>;
}

/* ── METRIC PICKER CHIPS ── */
function MP({ options, value, onChange, multi = true }) {
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
            border: "1.5px solid", borderColor: active ? "#78dca0" : "rgba(255,255,255,0.1)",
            background: active ? "rgba(120,220,160,0.15)" : "rgba(255,255,255,0.02)",
            color: active ? "#78dca0" : "#8a8fa8", display: "inline-flex", alignItems: "center", fontFamily: "var(--h)"
          }}>
            {label}{tip && <span style={{ marginLeft: 5 }}><Tip text={tip} inline /></span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── PRIMARY HEAT TABLE (roas rows × spend cols) with overlay option ── */
function PrimaryTable({ engine, roasVals, spendVals, primaryMetric, overlayMode, beCpa1, beCpaLtv, onSelect, selected }) {
  const { grid, nearestRi, nearestSi } = engine;

  // Determine which metric drives cell background intensity
  const all = grid.flat().map(c => c[primaryMetric === "contrib" ? "totalContrib" : "netProfit"]);
  const mn = Math.min(...all), mx = Math.max(...all);

  // Peak location (by primary metric)
  let pV = -Infinity, pRi = -1, pSi = -1;
  grid.forEach((row, ri) => row.forEach((c, si) => {
    const v = c[primaryMetric === "contrib" ? "totalContrib" : "netProfit"];
    if (v > pV) { pV = v; pRi = ri; pSi = si; }
  }));

  // Overlay formatter
  const overlayCell = (c) => {
    switch (overlayMode) {
      case "ncCpa": return <div style={{ fontSize: 10, color: "#b8bcd0", marginTop: 2 }}>NC-CPA <b style={{ color: c.ncCpa > beCpaLtv ? "#ff9999" : c.ncCpa > beCpa1 ? "#ffce70" : "#b8f0c8" }}>{fmt(c.ncCpa)}</b></div>;
      case "mer": return <div style={{ fontSize: 10, color: "#b8bcd0", marginTop: 2 }}>MER <b style={{ color: "#9ec4f5" }}>{fmtX(c.mer)}</b></div>;
      case "ncRoas": return <div style={{ fontSize: 10, color: "#b8bcd0", marginTop: 2 }}>NC-ROAS <b>{fmtX(c.ncRoas)}</b></div>;
      case "newOrders": return <div style={{ fontSize: 10, color: "#b8bcd0", marginTop: 2 }}>{fmtInt(c.paidNewOrders)} new</div>;
      default: return null;
    }
  };

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
        <thead><tr>
          <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "10px 12px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 10.5, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 85, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
            <div style={{ fontSize: 9.5, color: "#8a8fa8", marginBottom: 2 }}>ROAS ↓</div>
            <div>Spend →</div>
          </th>
          {spendVals.map(sv => <th key={sv} style={{ padding: "10px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 12.5, fontWeight: 700, color: "#ffffff", textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{fmt(sv)}</th>)}
        </tr></thead>
        <tbody>
          {roasVals.map((roas, ri) => (
            <tr key={roas}>
              <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "8px 12px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12.5, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{roas.toFixed(2)}x</td>
              {spendVals.map((sv, si) => {
                const c = grid[ri][si];
                const v = primaryMetric === "contrib" ? c.totalContrib : c.netProfit;
                const isPeak = ri === pRi && si === pSi;
                const isYou = ri === nearestRi && si === nearestSi;
                const isSel = selected && selected.ri === ri && selected.si === si;
                return (
                  <td key={sv} onClick={() => onSelect && onSelect({ ri, si, c })}
                    style={{ padding: "8px 6px", textAlign: "center", background: hc(v, mn, mx), borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12.5, fontWeight: (isPeak || isYou || isSel) ? 800 : 600, color: v < 0 ? "#ff9999" : "#ffffff", whiteSpace: "nowrap", outline: isSel ? "2.5px solid #9ec4f5" : isYou ? "2.5px solid #ffbe50" : isPeak ? "2.5px solid #78dca0" : "none", outlineOffset: -2, position: "relative", fontFamily: "var(--m)", cursor: "pointer" }}>
                    {fmt(v)}
                    {overlayCell(c)}
                    {isPeak && !isYou && !isSel && <div style={{ position: "absolute", top: 1, right: 3, fontSize: 8.5, color: "#78dca0", fontWeight: 800 }}>★</div>}
                    {isYou && !isSel && <div style={{ position: "absolute", top: 1, right: 3, fontSize: 8.5, color: "#ffbe50", fontWeight: 800 }}>●</div>}
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

/* ── SELECTED-CELL DETAIL PANEL ── */
function CellDetail({ cell, engine, I }) {
  if (!cell) {
    return (
      <div style={{ padding: "20px 18px", borderRadius: 9, background: "rgba(120,170,237,0.04)", border: "1.5px dashed rgba(120,170,237,0.2)", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
        <div style={{ fontSize: 13, color: "#b8bcd0", fontWeight: 600, marginBottom: 4 }}>Click any cell</div>
        <div style={{ fontSize: 11.5, color: "#8a8fa8", lineHeight: 1.5, maxWidth: 180 }}>See the full acquisition, revenue, and profit breakdown for that scenario.</div>
      </div>
    );
  }
  const c = cell.c;
  const { beCpa1, beCpaLtv } = engine;
  const zone = c.ncCpa > beCpaLtv ? "Above LTV BE" : c.ncCpa > beCpa1 ? "LTV zone" : "Under 1st-order BE";
  const zoneColor = c.ncCpa > beCpaLtv ? "#ff9999" : c.ncCpa > beCpa1 ? "#ffce70" : "#78dca0";

  const Row = ({ label, value, tip, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: 11.5, color: "#8a8fa8", display: "flex", alignItems: "center", fontFamily: "var(--m)" }}>{label}{tip && <Tip text={tip} />}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: color || "#ffffff", fontFamily: "var(--m)" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: "14px 16px", borderRadius: 9, background: "rgba(120,170,237,0.04)", border: "1.5px solid rgba(120,170,237,0.2)" }}>
      <div style={{ borderBottom: "1.5px solid rgba(255,255,255,0.08)", paddingBottom: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#9ec4f5", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--m)", marginBottom: 2 }}>Scenario breakdown</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#ffffff" }}>{fmt(c.spend)} @ {fmtX(c.roas)}</div>
        <div style={{ fontSize: 11, color: "#8a8fa8", marginTop: 2 }}>{fmt(c.paidRev)} paid revenue · {fmt(c.totalRev)} total</div>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Acquisition</div>
      <Row label="NC-CPA" tip={TIPS.ncCpa} value={fmt(c.ncCpa)} color={zoneColor} />
      <Row label="Zone" value={zone} color={zoneColor} />
      <Row label="CPA" tip={TIPS.cpa} value={fmt(c.cpa)} />
      <Row label="NC-ROAS" tip={TIPS.ncRoas} value={fmtX(c.ncRoas)} />
      <Row label="MER" tip={TIPS.mer} value={fmtX(c.mer)} color="#9ec4f5" />
      <Row label="New orders / mo" value={fmtInt(c.paidNewOrders)} />
      <Row label="Repeat orders / mo" value={fmtInt(c.paidRetOrders)} />

      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px", fontFamily: "var(--m)" }}>Profit</div>
      <Row label="Contribution" tip={TIPS.contrib} value={fmt(c.totalContrib)} color="#78dca0" />
      <Row label="Net Profit" tip={TIPS.netProfit} value={fmtFull(c.netProfit)} color={c.netProfit > 0 ? "#78dca0" : "#ff9999"} />
      <Row label="LTV-Adj. Net" tip={TIPS.ltvNet} value={fmt(c.ltvAdjustedNet)} color="#9ec4f5" />

      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px", fontFamily: "var(--m)" }}>LTV health</div>
      <Row label="LTV:CAC" tip={TIPS.ltvCac} value={fmtX(c.ltvCac)} color={c.ltvCac >= 3 ? "#78dca0" : c.ltvCac >= 1 ? "#ffce70" : "#ff9999"} />
      <Row label="Payback" tip={TIPS.payback} value={c.paybackMonths <= 0 ? "Instant" : !isFinite(c.paybackMonths) ? "Never" : `${c.paybackMonths.toFixed(1)}mo`} />

      <div style={{ fontSize: 10.5, color: "#8a8fa8", marginTop: 10, lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", fontFamily: "var(--m)" }}>
        Click another cell to compare. Use ★ PEAK and ● YOU as reference points.
      </div>
    </div>
  );
}

/* ── LTV CHART (axis swapped: roas rows, spend cols) ── */
function LtvChart({ engine, roasVals, spendVals }) {
  const { grid, nearestRi, nearestSi } = engine;
  const [metrics, setMetrics] = useState(["payback", "ltvCac", "ltvNet"]);

  const metricDefs = {
    payback: { short: "Payback", fmt: v => v <= 0 ? "Instant" : !isFinite(v) ? "Never" : `${v.toFixed(1)}mo`, get: c => c.paybackMonths, colorFn: c => c.paybackMonths <= 0 ? "#b8f0c8" : c.paybackMonths > 12 || !isFinite(c.paybackMonths) ? "#ff9999" : c.paybackMonths > 6 ? "#ffce70" : "#b8f0c8" },
    ltvCac: { short: "LTV:CAC", fmt: fmtX, get: c => c.ltvCac, colorFn: c => c.ltvCac >= 3 ? "#b8f0c8" : c.ltvCac >= 1 ? "#ffce70" : "#ff9999" },
    ltvNet: { short: "LTV Net", fmt: fmt, get: c => c.ltvAdjustedNet, colorFn: c => c.ltvAdjustedNet < 0 ? "#ff9999" : "#9ec4f5" },
    futureProfit: { short: "Future Rpt", fmt: fmt, get: c => c.futureRepeatProfit, colorFn: () => "#b8f0c8" },
  };

  const cellBgFn = c => {
    const pbBad = c.paybackMonths > 12 || !isFinite(c.paybackMonths);
    const pbWarn = c.paybackMonths > 6;
    return pbBad ? "rgba(200,60,60,0.1)" : pbWarn ? "rgba(255,190,80,0.06)" : "rgba(60,180,100,0.06)";
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
          LTV, Payback & Efficiency<Tip text="How long it takes to recover your customer acquisition cost, and how much lifetime profit you earn per acquisition dollar." />
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#b8bcd0" }}>Short payback + LTV:CAC ≥ 3× is the sweet spot.</p>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontFamily: "var(--m)" }}>Show in cells</div>
        <MP options={[
          ["payback", "Payback", TIPS.payback],
          ["ltvCac", "LTV:CAC", TIPS.ltvCac],
          ["ltvNet", "LTV Net", TIPS.ltvNet],
          ["futureProfit", "Future Repeat $", "Projected future repeat profit from customers acquired this month."],
        ]} value={metrics} onChange={setMetrics} />
      </div>

      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "10px 12px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 10.5, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 85, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
              <div style={{ fontSize: 9.5, color: "#8a8fa8", marginBottom: 2 }}>ROAS ↓</div>
              <div>Spend →</div>
            </th>
            {spendVals.map(sv => <th key={sv} style={{ padding: "10px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 12.5, fontWeight: 700, color: "#ffffff", textAlign: "center", fontFamily: "var(--m)" }}>{fmt(sv)}</th>)}
          </tr></thead>
          <tbody>
            {roasVals.map((roas, ri) => (
              <tr key={roas}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "8px 12px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12.5, fontWeight: 700, color: "#ffffff", fontFamily: "var(--m)" }}>{roas.toFixed(2)}x</td>
                {spendVals.map((sv, si) => {
                  const c = grid[ri][si];
                  const isY = ri === nearestRi && si === nearestSi;
                  return (
                    <td key={sv} style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: cellBgFn(c), fontFamily: "var(--m)", fontSize: 11.5, lineHeight: 1.65, textAlign: "left", outline: isY ? "2.5px solid #ffbe50" : "none", outlineOffset: -2, position: "relative" }}>
                      {isY && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#ffbe50", fontWeight: 800 }}>●</div>}
                      {metrics.map(mk => {
                        const def = metricDefs[mk]; if (!def) return null;
                        return (
                          <div key={mk}>
                            <span style={{ color: "#8a8fa8" }}>{def.short} </span>
                            <span style={{ color: def.colorFn(c), fontWeight: 700 }}>{def.fmt(def.get(c))}</span>
                          </div>
                        );
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
        <LD color="#b8f0c8" label="Strong — Instant / LTV:CAC ≥ 3×" />
        <LD color="#ffce70" label="Viable — 6–12mo / 1–3×" />
        <LD color="#ff9999" label="Weak — 12mo+ / < 1×" />
      </div>
    </div>
  );
}

/* ── DIMINISHING RETURNS CURVE ── */
function CurveChart({ engine, roasVals, spendVals }) {
  const { grid, nearestRi, nearestSi, current } = engine;
  const W = 780, H = 380, padL = 60, padR = 20, padT = 20, padB = 50;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Build one line per ROAS value: x=spend, y=netProfit
  const allNet = grid.flat().map(c => c.netProfit);
  const yMin = Math.min(0, ...allNet), yMax = Math.max(...allNet);
  const xMin = spendVals[0], xMax = spendVals[spendVals.length - 1];

  const x = v => padL + ((v - xMin) / Math.max(1, xMax - xMin)) * plotW;
  const y = v => padT + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH;

  // Subset of ROAS lines to show (every other one if many)
  const step = roasVals.length > 6 ? Math.ceil(roasVals.length / 6) : 1;
  const shownRoas = roasVals.filter((_, i) => i % step === 0 || i === roasVals.length - 1);

  // Color palette for ROAS lines (lower = warmer, higher = cooler)
  const lineColor = (ri, total) => {
    const t = total > 1 ? ri / (total - 1) : 0;
    // red -> amber -> green -> blue
    if (t < 0.33) return `rgb(${Math.round(220 - t * 100)}, ${Math.round(120 + t * 150)}, 100)`;
    if (t < 0.66) return `rgb(${Math.round(180 - t * 120)}, ${Math.round(210 - (t - 0.33) * 60)}, ${Math.round(100 + (t - 0.33) * 100)})`;
    return `rgb(${Math.round(100 - (t - 0.66) * 40)}, ${Math.round(180 - (t - 0.66) * 50)}, ${Math.round(237)})`;
  };

  // Find peak on each line for markers
  const peaks = shownRoas.map(roas => {
    const ri = roasVals.indexOf(roas);
    let peak = null;
    grid[ri].forEach(c => { if (!peak || c.netProfit > peak.netProfit) peak = c; });
    return { roas, peak, ri };
  });

  // Global peak for annotation
  let gPeak = null;
  grid.forEach(row => row.forEach(c => { if (!gPeak || c.netProfit > gPeak.netProfit) gPeak = c; }));

  // Y-axis ticks
  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * (yMax - yMin));

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
          Scale vs. Efficiency Curves<Tip text="Net profit as you scale spend, plotted once per ROAS line. Watch where each line flattens or peaks — that's where diminishing returns bite." />
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#b8bcd0" }}>Lower-ROAS lines often out-earn higher-ROAS lines at scale — until they don't.</p>
      </div>
      <div style={{ borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.015)", padding: 12 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {/* Zero line */}
          {yMin < 0 && yMax > 0 && (
            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="4 3" />
          )}
          {/* Y ticks */}
          {yTickVals.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#8a8fa8" fontFamily="JetBrains Mono">{fmt(v)}</text>
            </g>
          ))}
          {/* X ticks */}
          {spendVals.map((sv, i) => (
            <g key={i}>
              <line x1={x(sv)} x2={x(sv)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
              <text x={x(sv)} y={H - padB + 18} textAnchor="middle" fontSize={11} fill="#8a8fa8" fontFamily="JetBrains Mono">{fmt(sv)}</text>
            </g>
          ))}
          {/* Axis labels */}
          <text x={padL + plotW / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#b8bcd0" fontWeight={700}>Monthly Ad Spend</text>
          <text x={14} y={padT + plotH / 2} textAnchor="middle" fontSize={12} fill="#b8bcd0" fontWeight={700} transform={`rotate(-90 14 ${padT + plotH / 2})`}>Net Profit</text>

          {/* Lines */}
          {shownRoas.map((roas) => {
            const ri = roasVals.indexOf(roas);
            const col = lineColor(shownRoas.indexOf(roas), shownRoas.length);
            const pts = spendVals.map((sv, si) => `${x(sv)},${y(grid[ri][si].netProfit)}`).join(" ");
            return <polyline key={roas} points={pts} fill="none" stroke={col} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />;
          })}

          {/* Peak dots on each line */}
          {peaks.map(({ roas, peak, ri }) => {
            const col = lineColor(shownRoas.indexOf(roas), shownRoas.length);
            return <circle key={`pk-${roas}`} cx={x(peak.spend)} cy={y(peak.netProfit)} r={4} fill={col} stroke="#0c0e16" strokeWidth={1.5} />;
          })}

          {/* Global peak marker */}
          {gPeak && (
            <g>
              <circle cx={x(gPeak.spend)} cy={y(gPeak.netProfit)} r={8} fill="none" stroke="#78dca0" strokeWidth={2} />
              <text x={x(gPeak.spend)} y={y(gPeak.netProfit) - 14} textAnchor="middle" fontSize={11} fill="#78dca0" fontWeight={800}>★ PEAK {fmt(gPeak.netProfit)}</text>
            </g>
          )}

          {/* YOU marker */}
          <g>
            <circle cx={x(current.spend)} cy={y(current.netProfit)} r={6} fill="#ffbe50" stroke="#0c0e16" strokeWidth={2} />
            <text x={x(current.spend)} y={y(current.netProfit) + 18} textAnchor="middle" fontSize={11} fill="#ffbe50" fontWeight={800}>● YOU</text>
          </g>

          {/* Line legend */}
          <g transform={`translate(${W - padR - 100}, ${padT + 8})`}>
            <rect x={0} y={0} width={92} height={shownRoas.length * 15 + 8} rx={4} fill="#181b2b" stroke="rgba(255,255,255,0.08)" />
            {shownRoas.map((roas, i) => {
              const col = lineColor(i, shownRoas.length);
              return (
                <g key={roas} transform={`translate(6, ${10 + i * 15})`}>
                  <line x1={0} x2={14} y1={4} y2={4} stroke={col} strokeWidth={2.5} />
                  <text x={18} y={7} fontSize={10} fill="#b8bcd0" fontFamily="JetBrains Mono">{roas.toFixed(2)}x ROAS</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap", fontSize: 11.5, color: "#8a8fa8" }}>
        <span>💡 <b style={{ color: "#e8eaf2" }}>Read the curves:</b> where a line flattens, every extra dollar of spend earns less. Where it dips, you're overspending at that ROAS.</span>
      </div>
    </div>
  );
}

/* ── SOCIAL ENVIRO RECOMMENDATIONS ── */
function Recs({ engine, I }) {
  const { current, grid, beCpa1, beCpaLtv } = engine;
  let pN = -Infinity, pkCell = null;
  grid.forEach(row => row.forEach(c => { if (c.netProfit > pN) { pN = c.netProfit; pkCell = c; } }));

  const recs = [];
  const status = current.netProfit > 0 ? "profitable" : current.ltvAdjustedNet > 0 ? "break-even long-term" : "losing money";
  const statusColor = current.netProfit > 0 ? "#78dca0" : current.ltvAdjustedNet > 0 ? "#ffbe50" : "#ff9999";
  recs.push({
    i: "📍", tone: "info", title: "Where you are now",
    t: <>At <b>{fmt(current.spend)}/mo</b> spend and <b>{fmtX(current.roas)}</b> ROAS{I.currentNewCustomers > 0 && <> with <b>{fmtInt(I.currentNewCustomers)}</b> new customers</>}, you're <b style={{ color: statusColor }}>{status}</b>. Net <b>{fmtFull(current.netProfit)}</b>, NC-CPA <b>{fmt(current.ncCpa)}</b>, MER <b>{fmtX(current.mer)}</b>, payback <b>{current.paybackMonths <= 0 ? "instant" : !isFinite(current.paybackMonths) ? "never" : `${current.paybackMonths.toFixed(1)}mo`}</b>.</>
  });

  const peakDelta = pN - current.netProfit;
  if (peakDelta > 100 && pkCell) {
    const spendShift = pkCell.spend - current.spend;
    const roasShift = pkCell.roas - current.roas;
    const direction = spendShift > 0 ? "scale up" : spendShift < 0 ? "pull back" : "hold spend";
    recs.push({
      i: "🎯", tone: "good", title: "Biggest opportunity",
      t: <>Peak is <b>{fmtFull(pN)}</b> at <b>{fmt(pkCell.spend)} @ {fmtX(pkCell.roas)}</b> — <b style={{ color: "#78dca0" }}>{fmtFull(peakDelta)}/mo more</b>. To get there: {direction}{spendShift !== 0 && <> <b>{fmt(Math.abs(spendShift))}</b></>}{roasShift > 0 ? <>, lifting ROAS by <b>{roasShift.toFixed(2)}x</b></> : roasShift < 0 ? <>, accepting ROAS dip of <b>{Math.abs(roasShift).toFixed(2)}x</b></> : ""}.</>
    });
  }

  if (current.ncCpa > beCpaLtv) {
    recs.push({ i: "🚨", tone: "bad", title: "NC-CPA above LTV", t: <>You pay <b style={{ color: "#ff9999" }}>{fmt(current.ncCpa)}</b> per new customer; LTV breakeven is <b>{fmt(beCpaLtv)}</b>. Priority: raise AOV, repeat rate, or creative efficiency before adding spend.</> });
  } else if (current.ncCpa > beCpa1) {
    recs.push({ i: "⏳", tone: "warn", title: "Buying future profit", t: <>NC-CPA ({fmt(current.ncCpa)}) sits between 1st-order BE ({fmt(beCpa1)}) and LTV BE ({fmt(beCpaLtv)}). You need <b>{current.paybackMonths.toFixed(1)} months</b> of cash runway.</> });
  } else {
    recs.push({ i: "💪", tone: "good", title: "NC-CPA comfortable", t: <>At <b>{fmt(current.ncCpa)}</b>, you're under 1st-order BE ({fmt(beCpa1)}). Room to push spend.</> });
  }

  if (current.ltvCac < 1) {
    recs.push({ i: "📉", tone: "bad", title: "LTV:CAC below 1×", t: <>Every $1 CAC recovers only <b>{fmtX(current.ltvCac)}</b>. Structurally unprofitable — check repeat rate, AOV, margin.</> });
  } else if (current.ltvCac < 3) {
    recs.push({ i: "📊", tone: "warn", title: "LTV:CAC viable, not strong", t: <>Current LTV:CAC is <b>{fmtX(current.ltvCac)}</b>. Target ≥3×. Improving repeat rate to {(I.repeatRate + 10)}% pushes you safer.</> });
  } else {
    recs.push({ i: "🏆", tone: "good", title: "Strong LTV:CAC", t: <>LTV:CAC of <b>{fmtX(current.ltvCac)}</b> is above the 3× benchmark. You can spend more aggressively.</> });
  }

  if (current.netProfit > 0 && pkCell && pkCell.spend > current.spend) {
    const nextStep = Math.round((current.spend + pkCell.spend) / 2 / 1000) * 1000;
    recs.push({ i: "🚀", tone: "info", title: "Next test to run", t: <>Test <b>{fmt(nextStep)}/mo</b> (halfway to peak) for 30 days. If NC-CPA stays under <b>{fmt(beCpaLtv)}</b>, keep climbing.</> });
  }

  const cashBurn = current.paidNewOrders * Math.max(0, current.ncCpa - beCpa1);
  if (cashBurn > 0 && current.paybackMonths > 0 && isFinite(current.paybackMonths)) {
    const tied = cashBurn * current.paybackMonths;
    if (tied > 10000) recs.push({ i: "💸", tone: "warn", title: "Working capital needed", t: <>Fronting ~<b>{fmt(cashBurn)}/mo</b> above 1st-order BE. Over {current.paybackMonths.toFixed(1)}mo payback, ~<b>{fmt(tied)}</b> of cash tied up.</> });
  }

  const toneColor = (t) => t === "good" ? { bg: "rgba(120,220,160,0.05)", border: "rgba(120,220,160,0.25)", ic: "#78dca0" }
    : t === "bad" ? { bg: "rgba(200,60,60,0.06)", border: "rgba(200,60,60,0.3)", ic: "#ff9999" }
    : t === "warn" ? { bg: "rgba(255,190,80,0.05)", border: "rgba(255,190,80,0.25)", ic: "#ffbe50" }
    : { bg: "rgba(120,170,237,0.05)", border: "rgba(120,170,237,0.22)", ic: "#9ec4f5" };

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>🌱 Social Enviro Recommendations</h3>
        <span style={{ fontSize: 12, color: "#8a8fa8" }}>From your {fmt(current.spend)} @ {fmtX(current.roas)} baseline</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
        {recs.map((r, i) => {
          const col = toneColor(r.tone);
          return (
            <div key={i} style={{ padding: "12px 14px", borderRadius: 9, background: col.bg, border: `1.5px solid ${col.border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 17, lineHeight: "22px", flexShrink: 0 }}>{r.i}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: col.ic, marginBottom: 3 }}>{r.title}</div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "#e8eaf2" }}>{r.t}</p>
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
  const [I, setI] = useState(DEFAULTS);
  const [os, setOs] = useState({ current: true, basics: true, advanced: false });
  const [primaryMetric, setPrimaryMetric] = useState("contrib"); // "contrib" | "net"
  const [overlay, setOverlay] = useState("none"); // "none" | "ncCpa" | "mer" | "ncRoas" | "newOrders"
  const [mainView, setMainView] = useState("grid"); // "grid" | "curve"
  const [selected, setSelected] = useState(null);
  const s = useCallback((k, v) => setI(p => ({ ...p, [k]: v })), []);
  const tg = (k) => setOs(p => ({ ...p, [k]: !p[k] }));

  const effI = useMemo(() => deriveEffective(I), [I]);
  const rV = useMemo(() => { const v = []; for (let r = effI.roasMin; r <= effI.roasMax + 0.001; r += effI.roasStep) v.push(Math.round(r * 100) / 100); return v; }, [effI.roasMin, effI.roasMax, effI.roasStep]);
  const sV = useMemo(() => { const v = [], st = (effI.spendMax - effI.spendMin) / effI.spendSteps; for (let i = 0; i <= effI.spendSteps; i++) v.push(Math.round(effI.spendMin + i * st)); return v; }, [effI.spendMin, effI.spendMax, effI.spendSteps]);
  const eng = useMemo(() => compute(effI, rV, sV), [effI, rV, sV]);

  let pN = -Infinity, pkCell = null;
  eng.grid.forEach(row => row.forEach(c => { if (c.netProfit > pN) { pN = c.netProfit; pkCell = c; } }));
  const cur = eng.current;
  const simple = I.mode === "simplified";

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: "#0c0e16", color: "#e8eaf2", fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.4}`}</style>

      {/* HEADER */}
      <div style={{ padding: "18px 26px 14px", borderBottom: "1.5px solid rgba(255,255,255,0.08)", background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg, rgba(120,220,160,0.2), rgba(120,180,240,0.2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: "1.5px solid rgba(120,220,160,0.25)" }}>📊</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#ffffff" }}>E-Commerce Profit Matrix</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#b8bcd0" }}>Plot your spend × ROAS and map the profitable path to scale</p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* LEFT — INPUTS */}
        <div style={{ borderRight: "1.5px solid rgba(255,255,255,0.08)", padding: "14px 16px", overflowY: "auto", maxHeight: "calc(100vh - 70px)", background: "rgba(255,255,255,0.01)" }}>

          {/* Mode toggle */}
          <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 9, background: "rgba(120,170,237,0.05)", border: "1.5px solid rgba(120,170,237,0.2)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ec4f5", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: "var(--m)" }}>Input mode</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => s("mode", "simplified")} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: simple ? "#9ec4f5" : "rgba(255,255,255,0.1)", background: simple ? "rgba(120,170,237,0.15)" : "rgba(255,255,255,0.02)", color: simple ? "#9ec4f5" : "#8a8fa8", fontFamily: "var(--h)" }}>Simplified</button>
              <button onClick={() => s("mode", "detailed")} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: !simple ? "#9ec4f5" : "rgba(255,255,255,0.1)", background: !simple ? "rgba(120,170,237,0.15)" : "rgba(255,255,255,0.02)", color: !simple ? "#9ec4f5" : "#8a8fa8", fontFamily: "var(--h)" }}>Detailed</button>
            </div>
          </div>

          <Sec label="Your Current Performance" sub="Spend, ROAS, and real new customers" badge="YOU" accent="you" open={os.current} onToggle={() => tg("current")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Monthly Spend" pre="$" value={I.currentSpend} onChange={v => s("currentSpend", v)} step={1000} tip="Your actual monthly paid ad spend." />
              <Inp label="Blended ROAS" suf="x" value={I.currentRoas} onChange={v => s("currentRoas", v)} step={0.1} tip={TIPS.roas} />
              <Inp label="New Customers / Mo" value={I.currentNewCustomers} onChange={v => s("currentNewCustomers", v)} step={10} min={0} tip={TIPS.currentNewCust} help={I.currentNewCustomers > 0 ? `Your real NC-CPA: ${fmt(cur.ncCpa)}` : "0 = use model estimate"} />
            </div>
          </Sec>

          {simple ? (
            <>
              <Sec label="Business Basics" sub="The essentials" open={os.basics} onToggle={() => tg("basics")}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp label="Average Order Value" pre="$" value={I.simpleAov} onChange={v => s("simpleAov", v)} step={1} tip={TIPS.aov} />
                  <Inp label="Avg Variable Costs" suf="%" value={I.avgVarCostPct} onChange={v => s("avgVarCostPct", v)} step={1} tip={TIPS.avgVarCost} />
                  <Inp label="Monthly Fixed Costs" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} tip="Rent, salaries, SaaS — bills you pay regardless of sales." />
                  <Inp label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} tip={TIPS.organic} />
                </div>
              </Sec>
              <Sec label="Grid Settings" sub="Scenarios to plot" open={os.advanced} onToggle={() => tg("advanced")}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp label="Ad Starting Spend" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} tip="Lowest spend scenario in the grid." />
                  <Inp label="Spend Increment" pre="$" value={I.spendStep} onChange={v => s("spendStep", v)} step={5000} tip={TIPS.spendStep} />
                  <Inp label="ROAS Starting Point" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={0.25} tip="Lowest ROAS scenario in the grid." />
                  <Inp label="ROAS Increment" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={0.05} tip={TIPS.roasStep} />
                </div>
                <p style={{ fontSize: 11.5, color: "#8a8fa8", margin: "8px 0 0", lineHeight: 1.5 }}>Grid ends at {fmt(effI.spendMax)} spend / {effI.roasMax.toFixed(2)}x ROAS.</p>
              </Sec>
            </>
          ) : (
            <>
              <Sec label="Unit Economics" sub="AOV, margin, variable costs" open={os.basics} onToggle={() => tg("basics")}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp label="New AOV" pre="$" value={I.newAov} onChange={v => s("newAov", v)} step={1} tip="Average order value for first-time buyers." />
                  <Inp label="Return AOV" pre="$" value={I.retAov} onChange={v => s("retAov", v)} step={1} tip="Average order value for repeat buyers." />
                  <Inp label="Gross Margin" suf="%" value={I.grossMarginPct} onChange={v => s("grossMarginPct", v)} step={.5} tip={TIPS.grossMargin} />
                  <Inp label="Shipping / Order" pre="$" value={I.shippingPerOrder} onChange={v => s("shippingPerOrder", v)} step={.5} tip="Fulfillment cost per order." />
                  <Inp label="Processing" suf="%" value={I.processingPct} onChange={v => s("processingPct", v)} step={.1} tip="Stripe, PayPal, card processing fees." />
                  <Inp label="Other Var / Order" pre="$" value={I.otherVarPerOrder} onChange={v => s("otherVarPerOrder", v)} step={.5} tip="Other fixed-per-order costs." />
                  <Inp label="Var % of Rev" suf="%" value={I.otherVarPctRevenue} onChange={v => s("otherVarPctRevenue", v)} step={.1} tip="Platform or revenue-share fees." />
                  <Inp label="Monthly Fixed Costs" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} tip="Rent, salaries, SaaS." />
                </div>
              </Sec>
              <Sec label="Customer Mix & LTV" sub="New/return split, repeat, organic, grid" open={os.advanced} onToggle={() => tg("advanced")}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>New vs Returning mix</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <Inp label="New % at Low Spend" suf="%" value={I.newCustPctBase} onChange={v => s("newCustPctBase", v)} step={1} tip="Share of paid orders from new customers at lowest spend." />
                  <Inp label="New % at High Spend" suf="%" value={I.newCustPctAtMaxSpend} onChange={v => s("newCustPctAtMaxSpend", v)} step={1} tip="Share of paid orders from new customers at highest spend." />
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>Organic revenue</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <Inp label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} tip={TIPS.organic} />
                  <Inp label="Organic New %" suf="%" value={I.organicNewPct} onChange={v => s("organicNewPct", v)} step={5} tip="Share of organic orders that are new customers." />
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>Repeat behavior</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <Inp label="Repeat Rate" suf="%" value={I.repeatRate} onChange={v => s("repeatRate", v)} step={1} tip="% of new customers who reorder at least once." />
                  <Inp label="Orders / Repeater" value={I.avgOrdersPerRepeater} onChange={v => s("avgOrdersPerRepeater", v)} step={.1} tip="Average number of lifetime orders for repeaters." />
                  <Inp label="Repeat Cycle" suf="mo" value={I.avgRepeatCycleMonths} onChange={v => s("avgRepeatCycleMonths", v)} step={.5} tip="Average months between repeat orders." />
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontFamily: "var(--m)" }}>Grid bounds</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Inp label="Spend Min" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} />
                  <Inp label="Spend Max" pre="$" value={I.spendMax} onChange={v => s("spendMax", v)} step={10000} />
                  <Inp label="Spend Steps" value={I.spendSteps} onChange={v => s("spendSteps", v)} step={1} min={3} max={16} />
                  <Inp label="ROAS Min" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={.25} />
                  <Inp label="ROAS Max" suf="x" value={I.roasMax} onChange={v => s("roasMax", v)} step={.25} />
                  <Inp label="ROAS Step" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={.05} min={.1} tip={TIPS.roasStep} />
                </div>
              </Sec>
            </>
          )}
        </div>

        {/* RIGHT — OUTPUT */}
        <div style={{ padding: "14px 20px", overflowY: "auto", maxHeight: "calc(100vh - 70px)" }}>

          {/* Compact top bar: YOU + PEAK metrics inline */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#ffbe50", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "var(--m)" }}>● Your current snapshot</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <MetPill label="Net" tip={TIPS.netProfit} value={fmtFull(cur.netProfit)} color={cur.netProfit > 0 ? "#78dca0" : "#ff9999"} you />
                <MetPill label="NC-CPA" tip={TIPS.ncCpa} value={fmt(cur.ncCpa)} color={cur.ncCpa <= eng.beCpa1 ? "#78dca0" : cur.ncCpa <= eng.beCpaLtv ? "#ffbe50" : "#ff9999"} you />
                <MetPill label="MER" tip={TIPS.mer} value={fmtX(cur.mer)} color="#9ec4f5" you />
                <MetPill label="LTV:CAC" tip={TIPS.ltvCac} value={fmtX(cur.ltvCac)} color={cur.ltvCac >= 3 ? "#78dca0" : cur.ltvCac >= 1 ? "#ffbe50" : "#ff9999"} you />
                <MetPill label="Payback" tip={TIPS.payback} value={cur.paybackMonths <= 0 ? "Instant" : !isFinite(cur.paybackMonths) ? "Never" : `${cur.paybackMonths.toFixed(1)}mo`} color={cur.paybackMonths <= 6 ? "#78dca0" : cur.paybackMonths <= 12 ? "#ffbe50" : "#ff9999"} you />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#78dca0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "var(--m)" }}>★ Model peak & breakevens</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                <MetPill label="Peak Net" tip={TIPS.netProfit} value={fmtFull(pN)} sub={`${fmt(pkCell.spend)} @ ${fmtX(pkCell.roas)}`} color={pN > 0 ? "#78dca0" : "#ff9999"} />
                <MetPill label="BE NC-CPA 1st" tip={TIPS.beCpa1} value={fmt(eng.beCpa1)} color="#ffbe50" />
                <MetPill label="BE NC-CPA LTV" tip={TIPS.beCpaLtv} value={fmt(eng.beCpaLtv)} color="#78dca0" />
                <MetPill label="Peak MER" tip={TIPS.mer} value={fmtX(pkCell.mer)} color="#9ec4f5" />
                <MetPill label="LTV/Customer" tip="Projected lifetime profit per new customer." value={fmtFull(eng.ltvP)} color="#b8f0c8" />
              </div>
            </div>
          </div>

          {/* Main chart area: CM/Net grid + Cell detail panel */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em", display: "flex", alignItems: "center" }}>
                Contribution & Net Profit<Tip text="Contribution = before fixed overhead. Net = after. Axes: ROAS on rows, Spend on columns — read across a row to see what scaling spend does at a fixed ROAS." />
              </h3>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
                <button onClick={() => setMainView("grid")} style={{ padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: mainView === "grid" ? "#78dca0" : "rgba(255,255,255,0.1)", background: mainView === "grid" ? "rgba(120,220,160,0.15)" : "rgba(255,255,255,0.02)", color: mainView === "grid" ? "#78dca0" : "#8a8fa8", fontFamily: "var(--h)" }}>Grid</button>
                <button onClick={() => setMainView("curve")} style={{ padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: mainView === "curve" ? "#78dca0" : "rgba(255,255,255,0.1)", background: mainView === "curve" ? "rgba(120,220,160,0.15)" : "rgba(255,255,255,0.02)", color: mainView === "curve" ? "#78dca0" : "#8a8fa8", fontFamily: "var(--h)" }}>Scale Curves</button>
              </div>
            </div>

            {mainView === "grid" && (
              <>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Primary metric</div>
                    <MP options={[
                      ["contrib", "Contribution", TIPS.contrib],
                      ["net", "Net Profit", TIPS.netProfit],
                    ]} value={primaryMetric} onChange={setPrimaryMetric} multi={false} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#8a8fa8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "var(--m)" }}>Acquisition overlay</div>
                    <MP options={[
                      ["none", "None", "No overlay — just show profit."],
                      ["ncCpa", "NC-CPA", TIPS.ncCpa],
                      ["mer", "MER", TIPS.mer],
                      ["ncRoas", "NC-ROAS", TIPS.ncRoas],
                      ["newOrders", "New Orders", "New paid orders per month."],
                    ]} value={overlay} onChange={setOverlay} multi={false} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 14, alignItems: "start" }}>
                  <PrimaryTable engine={eng} roasVals={rV} spendVals={sV} primaryMetric={primaryMetric} overlayMode={overlay} beCpa1={eng.beCpa1} beCpaLtv={eng.beCpaLtv} onSelect={setSelected} selected={selected} />
                  <CellDetail cell={selected} engine={eng} I={effI} />
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                  <LD color="rgba(200,60,60,0.6)" label="Loss" />
                  <LD color="rgba(100,100,120,0.2)" label="~Breakeven" />
                  <LD color="rgba(60,180,90,0.6)" label="Profit" />
                  <span style={{ fontSize: 11.5, color: "#ffbe50", fontWeight: 700 }}>● YOU</span>
                  <span style={{ fontSize: 11.5, color: "#78dca0", fontWeight: 700 }}>★ PEAK</span>
                  <span style={{ fontSize: 11.5, color: "#9ec4f5", fontWeight: 700, marginLeft: "auto" }}>Click any cell for full breakdown →</span>
                </div>
              </>
            )}

            {mainView === "curve" && <CurveChart engine={eng} roasVals={rV} spendVals={sV} />}
          </div>

          <Recs engine={eng} I={effI} />

          <LtvChart engine={eng} roasVals={rV} spendVals={sV} />

          {/* Help */}
          <div style={{ marginTop: 14, padding: "13px 16px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1.5px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b8bcd0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: "var(--m)" }}>How to use this</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "#e8eaf2" }}>
              <p style={{ margin: "0 0 5px" }}>1. Enter your real <b style={{ color: "#ffbe50" }}>Spend, ROAS and New Customers</b> in the sidebar — this plots <b>● YOU</b> on every chart.</p>
              <p style={{ margin: "0 0 5px" }}>2. The grid rows are <b>ROAS</b>, columns are <b>Spend</b>. Read across a row to see what happens when you scale at the same efficiency. Read down a column to see what happens if efficiency improves.</p>
              <p style={{ margin: "0 0 5px" }}>3. <b>Click any cell</b> to load its full acquisition + LTV breakdown in the side panel.</p>
              <p style={{ margin: "0" }}>4. Switch to <b>Scale Curves</b> to see diminishing returns visually — where each ROAS line flattens or peaks.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

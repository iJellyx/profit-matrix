import { useState, useMemo, useCallback } from "react";

/* ── DEFAULTS ── */
const DEFAULTS = {
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

/* ── HEAT COLOR ── */
function hc(value, min, max) {
  if (max === min) return "rgba(100,100,120,0.12)";
  if (value < 0) {
    const t = Math.min(1, Math.abs(value) / Math.max(1, Math.abs(min)));
    return `rgba(${Math.round(155 + 75 * t)},${Math.round(52 - 25 * t)},${Math.round(52 - 25 * t)},${0.14 + 0.5 * t})`;
  }
  const t = Math.min(1, value / Math.max(1, max));
  return `rgba(${Math.round(35 + 18 * t)},${Math.round(82 + 115 * t)},${Math.round(58 + 38 * t)},${0.11 + 0.48 * t})`;
}

/* ── ENGINE ── */
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
  const oOrd = oR > 0 ? oR / oAov : 0;
  const oNew = oOrd * oNP, oRet = oOrd * (1 - oNP);
  const oContrib = oNew * nOP + oRet * rOP;

  const grid = spendVals.map((spend, si) => {
    const t = spendVals.length > 1 ? si / (spendVals.length - 1) : 0;
    const nP = (I.newCustPctBase + t * (I.newCustPctAtMaxSpend - I.newCustPctBase)) / 100;
    const pAov = nP * I.newAov + (1 - nP) * I.retAov;
    return roasVals.map((roas) => {
      const pR = spend * roas, tR = pR + oR, mer = tR / spend;
      const pO = pR / pAov, pNO = pO * nP, pRO = pO * (1 - nP);
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
    });
  });

  return { grid, nOP, rOP, ltvP, ltvR, expRepeats, ltvMonths, beCpa1, beCpaLtv, oContrib, oR, oOrd, oNew };
}

/* ── COMPONENTS ── */
function Inp({ label, value, onChange, pre, suf, step, min, max, sub }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9.5, fontWeight: 600, color: "#7a7f98", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--m)" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, padding: "4px 7px", gap: 3 }}>
        {pre && <span style={{ color: "#4e5270", fontSize: 11, fontFamily: "var(--m)" }}>{pre}</span>}
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} step={step || 1} min={min} max={max}
          style={{ background: "transparent", border: "none", outline: "none", color: "#e8eaf2", fontSize: 12.5, fontFamily: "var(--m)", width: "100%", fontWeight: 500 }} />
        {suf && <span style={{ color: "#4e5270", fontSize: 10.5, fontFamily: "var(--m)", whiteSpace: "nowrap" }}>{suf}</span>}
      </div>
      {sub && <span style={{ fontSize: 9, color: "#4e5270" }}>{sub}</span>}
    </div>
  );
}

function Pill({ a, onClick, children }) {
  return <button onClick={onClick} style={{ padding: "4px 11px", borderRadius: 5, fontSize: 10, fontWeight: 600, fontFamily: "var(--m)", cursor: "pointer", border: "1px solid", borderColor: a ? "rgba(120,220,160,0.3)" : "rgba(255,255,255,0.06)", background: a ? "rgba(120,220,160,0.07)" : "rgba(255,255,255,0.02)", color: a ? "#78dca0" : "#7a7f98", transition: "all .2s" }}>{children}</button>;
}

function Sec({ label, open, onToggle, children, badge }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: "6px 0", width: "100%" }}>
        <span style={{ fontSize: 8, color: "#4e5270", transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block" }}>▶</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7a7f98", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--m)" }}>{label}</span>
        {badge && <span style={{ fontSize: 8.5, padding: "1px 5px", borderRadius: 3, background: "rgba(120,220,160,0.08)", color: "#78dca0", fontFamily: "var(--m)", fontWeight: 600 }}>{badge}</span>}
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </button>
      {open && <div style={{ padding: "4px 0 8px" }}>{children}</div>}
    </div>
  );
}

function MC({ label, value, sub, color }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.018)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: "#7a7f98", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--m)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "#e8eaf2", fontFamily: "var(--h)", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#4e5270", marginTop: 1, fontFamily: "var(--m)" }}>{sub}</div>}
    </div>
  );
}

function LD({ color, label }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 9, height: 9, borderRadius: 2, background: color }} /><span style={{ fontSize: 9, color: "#4e5270" }}>{label}</span></div>;
}

/* ── HEAT TABLE ── */
function HT({ title, sub, data, roasVals, spendVals, cellFn, valFn, maxMark }) {
  const all = data.flat().map(valFn);
  const mn = Math.min(...all), mx = Math.max(...all);
  let mV = -Infinity, mR = -1, mS = -1;
  if (maxMark) data.forEach((row, si) => row.forEach((c, ri) => { const v = valFn(c); if (v > mV) { mV = v; mR = ri; mS = si; } }));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 5 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8eaf2", fontFamily: "var(--h)" }}>{title}</h3>
        <span style={{ fontSize: 9.5, color: "#4e5270" }}>{sub}</span>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "7px 9px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 8.5, fontWeight: 700, color: "#4e5270", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--m)", textAlign: "left", minWidth: 80 }}>
              <span style={{ display: "block", fontSize: 7.5, color: "#4e5270" }}>SPEND ↓</span>ROAS →
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "7px 5px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)", textAlign: "center", whiteSpace: "nowrap" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "5px 9px", background: "#111320", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)", whiteSpace: "nowrap" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = data[si][ri]; const v = valFn(c); const isM = maxMark && ri === mR && si === mS;
                  return (
                    <td key={roas} style={{ padding: "5px 4px", textAlign: "center", background: hc(v, mn, mx), borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 10, fontWeight: isM ? 800 : 500, color: v < 0 ? "#ff8a8a" : "#c8e6d0", fontFamily: "var(--m)", whiteSpace: "nowrap", outline: isM ? "2px solid rgba(120,220,160,0.6)" : "none", outlineOffset: -2, position: "relative" }}>
                      {cellFn(c)}
                      {isM && <div style={{ position: "absolute", top: -1, right: -1, width: 0, height: 0, borderTop: "6px solid rgba(120,220,160,0.7)", borderLeft: "6px solid transparent" }} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
        <LD color="rgba(200,50,50,0.5)" label="Loss" /><LD color="rgba(100,100,120,0.15)" label="~Breakeven" /><LD color="rgba(60,180,90,0.5)" label="Profit" />
        {maxMark && mV > -Infinity && <span style={{ marginLeft: "auto", fontSize: 9, color: "#78dca0", fontFamily: "var(--m)", fontWeight: 600 }}>▲ Peak: {fmtFull(mV)}</span>}
      </div>
    </div>
  );
}

/* ── ACQ METRICS TABLE ── */
function AcqT({ engine, roasVals, spendVals }) {
  const { grid, beCpa1, beCpaLtv } = engine;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 5 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8eaf2", fontFamily: "var(--h)" }}>Acquisition Metrics</h3>
        <span style={{ fontSize: 9.5, color: "#4e5270" }}>NC-CPA • CPA • NC-ROAS • MER</span>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "7px 9px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 8.5, fontWeight: 700, color: "#4e5270", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--m)", textAlign: "left", minWidth: 80 }}>
              <span style={{ display: "block", fontSize: 7.5 }}>SPEND ↓</span>ROAS →
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "7px 5px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)", textAlign: "center" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "7px 9px", background: "#111320", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const bad = c.ncCpa > beCpaLtv, warn = c.ncCpa > beCpa1 && !bad;
                  return (
                    <td key={roas} style={{ padding: "5px 5px", borderBottom: "1px solid rgba(255,255,255,0.03)", background: bad ? "rgba(180,50,50,0.07)" : warn ? "rgba(255,190,80,0.05)" : "rgba(60,180,100,0.035)", fontFamily: "var(--m)", fontSize: 9, lineHeight: 1.55, textAlign: "center" }}>
                      <div><span style={{ color: "#4e5270" }}>NC-CPA </span><span style={{ color: bad ? "#ff8a8a" : warn ? "#ffbe50" : "#c8e6d0", fontWeight: 600 }}>{fmt(c.ncCpa)}</span></div>
                      <div><span style={{ color: "#4e5270" }}>CPA </span><span style={{ color: "#b8bcd0" }}>{fmt(c.cpa)}</span></div>
                      <div><span style={{ color: "#4e5270" }}>NC-ROAS </span><span style={{ color: "#b8bcd0" }}>{fmtX(c.ncRoas)}</span></div>
                      <div><span style={{ color: "#4e5270" }}>MER </span><span style={{ color: "#7eaaed" }}>{fmtX(c.mer)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
        <LD color="rgba(60,180,100,0.2)" label={`NC-CPA ≤ ${fmt(beCpa1)} (1st order BE)`} />
        <LD color="rgba(255,190,80,0.2)" label={`NC-CPA ≤ ${fmt(beCpaLtv)} (LTV BE)`} />
        <LD color="rgba(180,50,50,0.2)" label="Exceeds LTV" />
      </div>
    </div>
  );
}

/* ── LTV TABLE ── */
function LtvT({ engine, roasVals, spendVals }) {
  const { grid } = engine;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 5 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#e8eaf2", fontFamily: "var(--h)" }}>LTV Payback & Efficiency</h3>
        <span style={{ fontSize: 9.5, color: "#4e5270" }}>Payback months • LTV:CAC • LTV-adjusted net</span>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "7px 9px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 8.5, fontWeight: 700, color: "#4e5270", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--m)", textAlign: "left", minWidth: 80 }}>
              <span style={{ display: "block", fontSize: 7.5 }}>SPEND ↓</span>ROAS →
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "7px 5px", background: "#111320", borderBottom: "2px solid rgba(255,255,255,0.07)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)", textAlign: "center" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "7px 9px", background: "#111320", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 10.5, fontWeight: 600, color: "#b8bcd0", fontFamily: "var(--m)" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const pbBad = c.paybackMonths > 12 || !isFinite(c.paybackMonths);
                  const pbWarn = c.paybackMonths > 6;
                  return (
                    <td key={roas} style={{ padding: "5px 5px", borderBottom: "1px solid rgba(255,255,255,0.03)", fontFamily: "var(--m)", fontSize: 9, lineHeight: 1.55, textAlign: "center", background: pbBad ? "rgba(180,50,50,0.05)" : "transparent" }}>
                      <div><span style={{ color: "#4e5270" }}>Payback </span><span style={{ color: c.paybackMonths <= 0 ? "#78dca0" : pbBad ? "#ff8a8a" : pbWarn ? "#ffbe50" : "#c8e6d0", fontWeight: 600 }}>{c.paybackMonths <= 0 ? "Instant" : !isFinite(c.paybackMonths) ? "Never" : `${c.paybackMonths.toFixed(1)}mo`}</span></div>
                      <div><span style={{ color: "#4e5270" }}>LTV:CAC </span><span style={{ color: c.ltvCac >= 3 ? "#78dca0" : c.ltvCac >= 1 ? "#ffbe50" : "#ff8a8a", fontWeight: 600 }}>{fmtX(c.ltvCac)}</span></div>
                      <div><span style={{ color: "#4e5270" }}>LTV Net </span><span style={{ color: c.ltvAdjustedNet < 0 ? "#ff8a8a" : "#7eaaed" }}>{fmt(c.ltvAdjustedNet)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
        <LD color="#78dca0" label="Instant / LTV:CAC ≥ 3x" /><LD color="#ffbe50" label="6–12mo / 1–3x" /><LD color="#ff8a8a" label="12+mo / < 1x" />
      </div>
    </div>
  );
}

/* ── INSIGHTS ── */
function Ins({ engine, I, roasVals, spendVals }) {
  const { grid, beCpa1, beCpaLtv, oContrib } = engine;
  const items = [];
  let pN = -Infinity, pSi = 0, pRi = 0;
  grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = grid[pSi][pRi];
  let lN = -Infinity, lSi = 0, lRi = 0;
  grid.forEach((r, si) => r.forEach((c, ri) => { if (c.ltvAdjustedNet > lN) { lN = c.ltvAdjustedNet; lSi = si; lRi = ri; } }));
  const lk = grid[lSi][lRi];

  items.push({ i: "💰", t: `Peak monthly net profit of ${fmtFull(pN)} at ${fmt(pk.spend)} spend / ${fmtX(pk.roas)} ROAS. Total revenue: ${fmt(pk.totalRev)}, MER: ${fmtX(pk.mer)}, NC-CPA: ${fmt(pk.ncCpa)}.` });

  if (lSi !== pSi || lRi !== pRi) {
    items.push({ i: "📈", t: `LTV-adjusted optimal shifts to ${fmt(lk.spend)} at ${fmtX(lk.roas)} — ${fmtFull(lN)} LTV-adjusted net, ${fmtFull(lN - pN)} more than single-month view. This is the case for spending into short-term loss with a ${lk.paybackMonths.toFixed(1)}-month payback.` });
  }

  if (I.monthlyOrganicRevenue > 0) {
    items.push({ i: "🌱", t: `Organic revenue (${fmt(I.monthlyOrganicRevenue)}/mo) generates ${fmt(oContrib)} contribution margin monthly — subsidizing paid acquisition. At peak spend, organic is ${(I.monthlyOrganicRevenue / pk.totalRev * 100).toFixed(0)}% of total revenue.` });
  }

  items.push({ i: "🎯", t: `Breakeven NC-CPA: ${fmt(beCpa1)} (1st order) or ${fmt(beCpaLtv)} (full LTV). Between these two numbers, you're investing in future value — ensure cash flow can absorb a payback window.` });

  const lo = grid[0][roasVals.length - 1];
  if (pN > lo.netProfit && (pSi > 0 || pRi < roasVals.length - 1)) {
    items.push({ i: "⚡", t: `Running ${fmt(spendVals[0])} at ${fmtX(roasVals[roasVals.length - 1])} only nets ${fmtFull(lo.netProfit)} — ${fmtFull(pN - lo.netProfit)} less than optimal. Chasing ROAS at conservative spend is leaving real profit on the table.` });
  }

  // Cash flow warning
  const cashBurn = pk.paidNewOrders * Math.max(0, pk.ncCpa - beCpa1);
  if (cashBurn > 0 && pk.paybackMonths > 0) {
    items.push({ i: "💸", t: `At optimal spend, you're investing ~${fmt(cashBurn)}/mo in customer acquisition above first-order breakeven. Over the ${pk.paybackMonths.toFixed(1)}-month payback, that's ~${fmt(cashBurn * pk.paybackMonths)} in working capital required before these customers become profitable.` });
  }

  return (
    <div style={{ background: "rgba(255,190,80,0.025)", border: "1px solid rgba(255,190,80,0.1)", borderRadius: 6, padding: "12px 16px", marginBottom: 22 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#ffbe50", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "var(--m)" }}>CFO Insights</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 7, marginBottom: i < items.length - 1 ? 8 : 0, alignItems: "flex-start" }}>
          <span style={{ fontSize: 12, lineHeight: "18px", flexShrink: 0 }}>{item.i}</span>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: "#b8bcd0", fontFamily: "var(--h)" }}>{item.t}</p>
        </div>
      ))}
    </div>
  );
}

/* ── MAIN APP ── */
export default function App() {
  const [I, setI] = useState(DEFAULTS);
  const [os, setOs] = useState({ unit: true, mix: false, organic: true, ltv: false, fixed: false, axis: false });
  const [view, setView] = useState("all");
  const s = useCallback((k, v) => setI(p => ({ ...p, [k]: v })), []);
  const tg = (k) => setOs(p => ({ ...p, [k]: !p[k] }));

  const rV = useMemo(() => { const v = []; for (let r = I.roasMin; r <= I.roasMax + 0.001; r += I.roasStep) v.push(Math.round(r * 100) / 100); return v; }, [I.roasMin, I.roasMax, I.roasStep]);
  const sV = useMemo(() => { const v = [], st = (I.spendMax - I.spendMin) / I.spendSteps; for (let i = 0; i <= I.spendSteps; i++) v.push(Math.round(I.spendMin + i * st)); return v; }, [I.spendMin, I.spendMax, I.spendSteps]);
  const eng = useMemo(() => compute(I, rV, sV), [I, rV, sV]);

  // Peak finder
  let pN = -Infinity, pSi = 0, pRi = 0;
  eng.grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = eng.grid[pSi][pRi];

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: "#0c0e16", color: "#e8eaf2", fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:5px;width:5px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07);border-radius:3px}input[type=number]::-webkit-inner-spin-button{opacity:.2}`}</style>

      {/* HEADER */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: "linear-gradient(135deg, rgba(120,220,160,0.15), rgba(120,180,240,0.15))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, border: "1px solid rgba(120,220,160,0.12)" }}>📊</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em" }}>E-Commerce Profit Matrix</h1>
            <p style={{ margin: 0, fontSize: 10, color: "#4e5270", fontFamily: "var(--m)" }}>Spend × Efficiency × LTV — find where total profit peaks</p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "290px 1fr" }}>
        {/* LEFT — INPUTS */}
        <div style={{ borderRight: "1px solid rgba(255,255,255,0.06)", padding: "14px 14px", overflowY: "auto", maxHeight: "calc(100vh - 58px)", background: "rgba(255,255,255,0.006)" }}>

          <Sec label="Unit Economics" open={os.unit} onToggle={() => tg("unit")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Inp label="New Cust AOV" pre="$" value={I.newAov} onChange={v => s("newAov", v)} step={1} sub="1st purchase" />
              <Inp label="Return AOV" pre="$" value={I.retAov} onChange={v => s("retAov", v)} step={1} sub="Repeat orders" />
              <Inp label="Gross Margin" suf="%" value={I.grossMarginPct} onChange={v => s("grossMarginPct", v)} step={.5} sub="After COGS" />
              <Inp label="Shipping/Order" pre="$" value={I.shippingPerOrder} onChange={v => s("shippingPerOrder", v)} step={.5} />
              <Inp label="Processing" suf="%" value={I.processingPct} onChange={v => s("processingPct", v)} step={.1} sub="Stripe etc" />
              <Inp label="Other Var/Ord" pre="$" value={I.otherVarPerOrder} onChange={v => s("otherVarPerOrder", v)} step={.5} />
              <Inp label="Var % of Rev" suf="%" value={I.otherVarPctRevenue} onChange={v => s("otherVarPctRevenue", v)} step={.1} sub="Platform fees" />
            </div>
          </Sec>

          <Sec label="New vs Returning Mix" open={os.mix} onToggle={() => tg("mix")} badge="SPLIT">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Inp label="New % at Low Spend" suf="%" value={I.newCustPctBase} onChange={v => s("newCustPctBase", v)} step={1} sub="At min spend" />
              <Inp label="New % at High Spend" suf="%" value={I.newCustPctAtMaxSpend} onChange={v => s("newCustPctAtMaxSpend", v)} step={1} sub="At max spend" />
            </div>
            <p style={{ fontSize: 9, color: "#4e5270", margin: "6px 0 0", lineHeight: 1.45, fontFamily: "var(--m)" }}>Scales linearly. More spend → more prospecting → higher new customer %.</p>
          </Sec>

          <Sec label="Organic / Non-Paid Revenue" open={os.organic} onToggle={() => tg("organic")} badge="BASELINE">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Inp label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} sub="SEO, direct, email" />
              <Inp label="Organic New %" suf="%" value={I.organicNewPct} onChange={v => s("organicNewPct", v)} step={5} sub="% new customers" />
            </div>
          </Sec>

          <Sec label="LTV Assumptions" open={os.ltv} onToggle={() => tg("ltv")} badge="PAYBACK">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Inp label="Repeat Rate" suf="%" value={I.repeatRate} onChange={v => s("repeatRate", v)} step={1} sub="% who reorder" />
              <Inp label="Orders/Repeater" value={I.avgOrdersPerRepeater} onChange={v => s("avgOrdersPerRepeater", v)} step={.1} sub="Lifetime repeats" />
              <Inp label="Repeat Cycle" suf="mo" value={I.avgRepeatCycleMonths} onChange={v => s("avgRepeatCycleMonths", v)} step={.5} sub="Between orders" />
            </div>
          </Sec>

          <Sec label="Fixed Costs" open={os.fixed} onToggle={() => tg("fixed")}>
            <Inp label="Monthly Fixed" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} sub="Rent, payroll, SaaS" />
          </Sec>

          <Sec label="Axis Configuration" open={os.axis} onToggle={() => tg("axis")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Inp label="ROAS Min" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={.25} />
              <Inp label="ROAS Max" suf="x" value={I.roasMax} onChange={v => s("roasMax", v)} step={.25} />
              <Inp label="ROAS Step" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={.05} min={.1} />
              <Inp label="Spend Steps" value={I.spendSteps} onChange={v => s("spendSteps", v)} step={1} min={3} max={16} />
              <Inp label="Spend Min" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} />
              <Inp label="Spend Max" pre="$" value={I.spendMax} onChange={v => s("spendMax", v)} step={10000} />
            </div>
          </Sec>

          {/* Unit Econ Reference */}
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 6, background: "rgba(120,170,237,0.035)", border: "1px solid rgba(120,170,237,0.09)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#7eaaed", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "var(--m)" }}>Unit Econ Reference</div>
            <div style={{ fontSize: 10, lineHeight: 1.75, fontFamily: "var(--m)", color: "#7a7f98" }}>
              <div>New order profit: <b style={{ color: eng.nOP >= 0 ? "#78dca0" : "#ff8a8a" }}>{fmtFull(eng.nOP)}</b></div>
              <div>Repeat order profit: <b style={{ color: "#78dca0" }}>{fmtFull(eng.rOP)}</b></div>
              <div>Expected repeats: <b style={{ color: "#b8bcd0" }}>{eng.expRepeats.toFixed(1)}</b></div>
              <div>LTV (profit): <b style={{ color: "#78dca0" }}>{fmtFull(eng.ltvP)}</b></div>
              <div>LTV (revenue): <b style={{ color: "#b8bcd0" }}>{fmtFull(eng.ltvR)}</b></div>
              <div>Realized over: <b style={{ color: "#b8bcd0" }}>{eng.ltvMonths.toFixed(0)}mo</b></div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 4, paddingTop: 4 }}>
                BE NC-CPA (1st): <b style={{ color: "#ffbe50" }}>{fmtFull(eng.beCpa1)}</b>
              </div>
              <div>BE NC-CPA (LTV): <b style={{ color: "#78dca0" }}>{fmtFull(eng.beCpaLtv)}</b></div>
            </div>
          </div>
        </div>

        {/* RIGHT — OUTPUT */}
        <div style={{ padding: "14px 18px", overflowY: "auto", maxHeight: "calc(100vh - 58px)" }}>
          {/* Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 8, marginBottom: 16 }}>
            <MC label="BE NC-CPA (1st)" value={fmt(eng.beCpa1)} sub="Break even order 1" color="#ffbe50" />
            <MC label="BE NC-CPA (LTV)" value={fmt(eng.beCpaLtv)} sub={`Over ${eng.ltvMonths.toFixed(0)}mo lifetime`} color="#78dca0" />
            <MC label="Peak Net Profit" value={fmtFull(pN)} sub={`${fmt(pk.spend)} @ ${fmtX(pk.roas)}`} color={pN > 0 ? "#78dca0" : "#ff8a8a"} />
            <MC label="MER at Peak" value={fmtX(pk.mer)} sub={`${fmt(pk.totalRev)} total rev`} color="#7eaaed" />
            <MC label="NC-CPA at Peak" value={fmt(pk.ncCpa)} sub={`${Math.round(pk.paidNewOrders)} new/mo`} color={pk.ncCpa <= eng.beCpaLtv ? "#78dca0" : "#ff8a8a"} />
            <MC label="Organic Contrib" value={fmt(eng.oContrib)} sub={`${fmt(eng.oR)}/mo rev`} color="#b8bcd0" />
          </div>

          <Ins engine={eng} I={I} roasVals={rV} spendVals={sV} />

          {/* View Toggles */}
          <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
            {[["all", "All Tables"], ["acq", "Acquisition Metrics"], ["contrib", "Contribution Margin"], ["net", "Net Profit"], ["ltv", "LTV & Payback"]].map(([k, l]) =>
              <Pill key={k} a={view === k} onClick={() => setView(k)}>{l}</Pill>
            )}
          </div>

          {(view === "all" || view === "acq") && <AcqT engine={eng} roasVals={rV} spendVals={sV} />}

          {(view === "all" || view === "contrib") && (
            <HT title="Total Contribution Margin" sub="Paid + Organic — before fixed costs"
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.totalContrib} cellFn={c => fmt(c.totalContrib)} maxMark />
          )}

          {(view === "all" || view === "net") && (
            <HT title="True Net Profit" sub={`After ${fmtFull(I.monthlyFixedCosts)} fixed costs`}
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.netProfit} cellFn={c => fmt(c.netProfit)} maxMark />
          )}

          {(view === "all" || view === "ltv") && <LtvT engine={eng} roasVals={rV} spendVals={sV} />}

          {/* Methodology */}
          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 6, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#4e5270", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: "var(--m)" }}>Methodology</div>
            <div style={{ fontSize: 10, lineHeight: 1.7, color: "#4e5270", fontFamily: "var(--m)", columns: 2, columnGap: 20 }}>
              <div><b style={{ color: "#7a7f98" }}>Paid Rev</b> = Spend × ROAS</div>
              <div><b style={{ color: "#7a7f98" }}>Total Rev</b> = Paid + Organic</div>
              <div><b style={{ color: "#7a7f98" }}>MER</b> = Total Rev ÷ Spend</div>
              <div><b style={{ color: "#7a7f98" }}>NC-CPA</b> = Spend ÷ New Paid Customers</div>
              <div><b style={{ color: "#7a7f98" }}>NC-ROAS</b> = New Cust Rev ÷ Spend</div>
              <div><b style={{ color: "#7a7f98" }}>CPA</b> = Spend ÷ Total Paid Orders</div>
              <div><b style={{ color: "#7a7f98" }}>Contribution</b> = GP − Var Costs − Spend</div>
              <div><b style={{ color: "#7a7f98" }}>LTV:CAC</b> = LTV Profit ÷ NC-CPA</div>
              <div><b style={{ color: "#7a7f98" }}>Payback</b> = Deficit ÷ Mo. Repeat Profit</div>
              <div><b style={{ color: "#7a7f98" }}>LTV Net</b> = Net + Future Repeat Profit</div>
            </div>
            <p style={{ fontSize: 9.5, color: "#4e5270", margin: "8px 0 0", lineHeight: 1.5, fontFamily: "var(--m)" }}>
              New customer % interpolates linearly between low/high spend bounds. Organic revenue is constant across all scenarios. LTV-adjusted net adds projected future repeat profit from new customers acquired this month. Payback = months until cumulative repeat profit covers the gap between NC-CPA and first-order profit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

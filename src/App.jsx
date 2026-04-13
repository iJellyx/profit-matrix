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
  // Current real-world performance
  currentSpend: 50000, currentRoas: 2.5,
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
    return `rgba(${Math.round(180 + 60 * t)},${Math.round(70 - 30 * t)},${Math.round(70 - 30 * t)},${0.18 + 0.55 * t})`;
  }
  const t = Math.min(1, value / Math.max(1, max));
  return `rgba(${Math.round(40 + 20 * t)},${Math.round(110 + 120 * t)},${Math.round(70 + 40 * t)},${0.14 + 0.55 * t})`;
}

/* ── ENGINE ── */
// Compute metrics for one (spend, roas) scenario given model inputs I
function computeOne(I, spend, roas, spendMin, spendMax, oContrib, nOP, rOP, expRepeats, ltvP) {
  const gm = I.grossMarginPct / 100, proc = I.processingPct / 100, oVP = I.otherVarPctRevenue / 100;
  // Interpolate new-customer % based on where spend falls in the min/max band
  const t = spendMax > spendMin ? Math.max(0, Math.min(1, (spend - spendMin) / (spendMax - spendMin))) : 0;
  const nP = (I.newCustPctBase + t * (I.newCustPctAtMaxSpend - I.newCustPctBase)) / 100;
  const pAov = nP * I.newAov + (1 - nP) * I.retAov;
  const pR = spend * roas, tR = pR + I.monthlyOrganicRevenue, mer = spend > 0 ? tR / spend : 0;
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
}

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

  // Current real-world position (exact, not snapped to grid)
  const spendMin = spendVals[0] ?? I.spendMin;
  const spendMax = spendVals[spendVals.length - 1] ?? I.spendMax;
  const current = computeOne(I, I.currentSpend, I.currentRoas, spendMin, spendMax, oContrib, nOP, rOP, expRepeats, ltvP);

  // Nearest grid cell for visual overlay
  let nearestSi = 0, nearestRi = 0, nearestD = Infinity;
  spendVals.forEach((s, si) => roasVals.forEach((r, ri) => {
    const ds = Math.abs(s - I.currentSpend) / Math.max(1, spendMax - spendMin);
    const dr = Math.abs(r - I.currentRoas) / Math.max(0.01, (roasVals[roasVals.length - 1] || 1) - (roasVals[0] || 0));
    const d = ds * ds + dr * dr;
    if (d < nearestD) { nearestD = d; nearestSi = si; nearestRi = ri; }
  }));

  return { grid, nOP, rOP, ltvP, ltvR, expRepeats, ltvMonths, beCpa1, beCpaLtv, oContrib, oR, oOrd, oNew, current, nearestSi, nearestRi };
}

/* ── COMPONENTS ── */
function Inp({ label, value, onChange, pre, suf, step, min, max, help }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#d8dae8", letterSpacing: "0.01em" }}>{label}</label>
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

function Pill({ a, onClick, children }) {
  return <button onClick={onClick} style={{ padding: "8px 14px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "1.5px solid", borderColor: a ? "#78dca0" : "rgba(255,255,255,0.12)", background: a ? "rgba(120,220,160,0.18)" : "rgba(255,255,255,0.03)", color: a ? "#78dca0" : "#b8bcd0", transition: "all .2s" }}>{children}</button>;
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

function MC({ label, value, sub, color, you }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 9, background: you ? "rgba(255,190,80,0.06)" : "rgba(255,255,255,0.03)", border: `1.5px solid ${you ? "rgba(255,190,80,0.3)" : "rgba(255,255,255,0.08)"}`, position: "relative" }}>
      {you && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 9, color: "#ffbe50", fontWeight: 800, letterSpacing: "0.08em", fontFamily: "var(--m)" }}>● YOU</div>}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#b8bcd0", marginBottom: 4, letterSpacing: "0.02em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.1, fontFamily: "var(--h)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "#8a8fa8", marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

function LD({ color, label }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: color }} /><span style={{ fontSize: 12, color: "#b8bcd0", fontWeight: 500 }}>{label}</span></div>;
}

/* ── HEAT TABLE ── */
function HT({ title, sub, help, data, roasVals, spendVals, cellFn, valFn, maxMark, youSi, youRi }) {
  const all = data.flat().map(valFn);
  const mn = Math.min(...all), mx = Math.max(...all);
  let mV = -Infinity, mR = -1, mS = -1;
  if (maxMark) data.forEach((row, si) => row.forEach((c, ri) => { const v = valFn(c); if (v > mV) { mV = v; mR = ri; mS = si; } }));

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>{title}</h3>
        {sub && <p style={{ margin: "3px 0 0", fontSize: 13, color: "#b8bcd0" }}>{sub}</p>}
        {help && <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#8a8fa8", lineHeight: 1.55, maxWidth: 720 }}>{help}</p>}
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "11px 13px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 11, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 105, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
              <div style={{ fontSize: 10, color: "#8a8fa8", marginBottom: 2 }}>Spend ↓</div>
              <div>ROAS →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "11px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 700, color: "#ffffff", textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "9px 13px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap", fontFamily: "var(--m)" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = data[si][ri]; const v = valFn(c);
                  const isM = maxMark && ri === mR && si === mS;
                  const isY = youSi === si && youRi === ri;
                  return (
                    <td key={roas} style={{ padding: "9px 6px", textAlign: "center", background: hc(v, mn, mx), borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 13, fontWeight: (isM || isY) ? 800 : 600, color: v < 0 ? "#ff9999" : "#ffffff", whiteSpace: "nowrap", outline: isY ? "2.5px solid #ffbe50" : isM ? "2.5px solid #78dca0" : "none", outlineOffset: -2, position: "relative", fontFamily: "var(--m)" }}>
                      {cellFn(c)}
                      {isM && !isY && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#78dca0", fontWeight: 800, letterSpacing: "0.05em" }}>★ PEAK</div>}
                      {isY && !isM && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#ffbe50", fontWeight: 800, letterSpacing: "0.05em" }}>● YOU</div>}
                      {isY && isM && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#ffbe50", fontWeight: 800, letterSpacing: "0.05em" }}>● YOU ★</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <LD color="rgba(200,60,60,0.6)" label="Loss" />
        <LD color="rgba(100,100,120,0.2)" label="~Breakeven" />
        <LD color="rgba(60,180,90,0.6)" label="Profit" />
        <span style={{ fontSize: 12, color: "#ffbe50", fontWeight: 700, fontFamily: "var(--m)" }}>● YOU = your current spot</span>
        {maxMark && mV > -Infinity && <span style={{ marginLeft: "auto", fontSize: 13, color: "#78dca0", fontWeight: 700, fontFamily: "var(--m)" }}>★ Peak: {fmtFull(mV)}</span>}
      </div>
    </div>
  );
}

/* ── ACQ METRICS TABLE ── */
function AcqT({ engine, roasVals, spendVals }) {
  const { grid, beCpa1, beCpaLtv, nearestSi, nearestRi } = engine;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>Acquisition Efficiency</h3>
        <p style={{ margin: "3px 0 0", fontSize: 13, color: "#b8bcd0" }}>NC-CPA · CPA · NC-ROAS · MER across the spend/ROAS grid</p>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#8a8fa8", lineHeight: 1.55, maxWidth: 720 }}>
          Green cells clear 1st-order breakeven. Yellow cells only work with LTV. Red cells overpay even on full lifetime value.
        </p>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "11px 13px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 11, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 105, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
              <div style={{ fontSize: 10, color: "#8a8fa8", marginBottom: 2 }}>Spend ↓</div>
              <div>ROAS →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "11px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 700, color: "#ffffff", textAlign: "center", fontFamily: "var(--m)" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "9px 13px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13, fontWeight: 700, color: "#ffffff", fontFamily: "var(--m)" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const bad = c.ncCpa > beCpaLtv, warn = c.ncCpa > beCpa1 && !bad;
                  const isY = nearestSi === si && nearestRi === ri;
                  return (
                    <td key={roas} style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: bad ? "rgba(200,60,60,0.15)" : warn ? "rgba(255,190,80,0.1)" : "rgba(60,180,100,0.08)", fontFamily: "var(--m)", fontSize: 11.5, lineHeight: 1.7, textAlign: "left", outline: isY ? "2.5px solid #ffbe50" : "none", outlineOffset: -2, position: "relative" }}>
                      {isY && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#ffbe50", fontWeight: 800, letterSpacing: "0.05em" }}>● YOU</div>}
                      <div><span style={{ color: "#8a8fa8" }}>NC-CPA </span><span style={{ color: bad ? "#ff9999" : warn ? "#ffce70" : "#b8f0c8", fontWeight: 800 }}>{fmt(c.ncCpa)}</span></div>
                      <div><span style={{ color: "#8a8fa8" }}>CPA </span><span style={{ color: "#ffffff", fontWeight: 700 }}>{fmt(c.cpa)}</span></div>
                      <div><span style={{ color: "#8a8fa8" }}>NC-ROAS </span><span style={{ color: "#ffffff", fontWeight: 700 }}>{fmtX(c.ncRoas)}</span></div>
                      <div><span style={{ color: "#8a8fa8" }}>MER </span><span style={{ color: "#9ec4f5", fontWeight: 700 }}>{fmtX(c.mer)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <LD color="rgba(60,180,100,0.3)" label={`NC-CPA ≤ ${fmt(beCpa1)} — 1st-order breakeven`} />
        <LD color="rgba(255,190,80,0.3)" label={`NC-CPA ≤ ${fmt(beCpaLtv)} — LTV breakeven`} />
        <LD color="rgba(200,60,60,0.3)" label="Exceeds LTV — unprofitable even long-term" />
      </div>
    </div>
  );
}

/* ── LTV TABLE ── */
function LtvT({ engine, roasVals, spendVals }) {
  const { grid, nearestSi, nearestRi } = engine;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>LTV Payback & Efficiency</h3>
        <p style={{ margin: "3px 0 0", fontSize: 13, color: "#b8bcd0" }}>Payback window · LTV:CAC ratio · LTV-adjusted net profit</p>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#8a8fa8", lineHeight: 1.55, maxWidth: 720 }}>
          Short payback + LTV:CAC ≥ 3× is the sweet spot. LTV Net adds the projected repeat profit from customers you acquire this month.
        </p>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "11px 13px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 11, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 105, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--m)" }}>
              <div style={{ fontSize: 10, color: "#8a8fa8", marginBottom: 2 }}>Spend ↓</div>
              <div>ROAS →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "11px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 700, color: "#ffffff", textAlign: "center", fontFamily: "var(--m)" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "9px 13px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13, fontWeight: 700, color: "#ffffff", fontFamily: "var(--m)" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const pbBad = c.paybackMonths > 12 || !isFinite(c.paybackMonths);
                  const pbWarn = c.paybackMonths > 6;
                  const isY = nearestSi === si && nearestRi === ri;
                  return (
                    <td key={roas} style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontFamily: "var(--m)", fontSize: 11.5, lineHeight: 1.7, textAlign: "left", background: pbBad ? "rgba(200,60,60,0.1)" : pbWarn ? "rgba(255,190,80,0.06)" : "rgba(60,180,100,0.06)", outline: isY ? "2.5px solid #ffbe50" : "none", outlineOffset: -2, position: "relative" }}>
                      {isY && <div style={{ position: "absolute", top: 2, right: 4, fontSize: 9, color: "#ffbe50", fontWeight: 800, letterSpacing: "0.05em" }}>● YOU</div>}
                      <div><span style={{ color: "#8a8fa8" }}>Payback </span><span style={{ color: c.paybackMonths <= 0 ? "#b8f0c8" : pbBad ? "#ff9999" : pbWarn ? "#ffce70" : "#b8f0c8", fontWeight: 800 }}>{c.paybackMonths <= 0 ? "Instant" : !isFinite(c.paybackMonths) ? "Never" : `${c.paybackMonths.toFixed(1)}mo`}</span></div>
                      <div><span style={{ color: "#8a8fa8" }}>LTV:CAC </span><span style={{ color: c.ltvCac >= 3 ? "#b8f0c8" : c.ltvCac >= 1 ? "#ffce70" : "#ff9999", fontWeight: 800 }}>{fmtX(c.ltvCac)}</span></div>
                      <div><span style={{ color: "#8a8fa8" }}>LTV Net </span><span style={{ color: c.ltvAdjustedNet < 0 ? "#ff9999" : "#9ec4f5", fontWeight: 700 }}>{fmt(c.ltvAdjustedNet)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <LD color="#b8f0c8" label="Strong — Instant payback / LTV:CAC ≥ 3×" />
        <LD color="#ffce70" label="Viable — 6–12mo / 1–3×" />
        <LD color="#ff9999" label="Weak — 12mo+ / < 1×" />
      </div>
    </div>
  );
}

/* ── PERSONALIZED RECOMMENDATIONS ── */
function Recs({ engine, I }) {
  const { current, grid, beCpa1, beCpaLtv, ltvP } = engine;
  // Peak of net profit
  let pN = -Infinity, pSi = 0, pRi = 0;
  grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = grid[pSi][pRi];
  // LTV peak
  let lN = -Infinity, lk = null;
  grid.forEach(r => r.forEach(c => { if (c.ltvAdjustedNet > lN) { lN = c.ltvAdjustedNet; lk = c; } }));

  const recs = [];

  // 1. Current summary
  const status = current.netProfit > 0 ? "profitable" : current.ltvAdjustedNet > 0 ? "break-even long-term" : "losing money";
  const statusColor = current.netProfit > 0 ? "#78dca0" : current.ltvAdjustedNet > 0 ? "#ffbe50" : "#ff9999";
  recs.push({
    i: "📍", tone: "info",
    title: "Where you are now",
    t: <>At <b>{fmt(current.spend)}/mo</b> spend and <b>{fmtX(current.roas)}</b> blended ROAS, you're <b style={{ color: statusColor }}>{status}</b>. Net profit <b>{fmtFull(current.netProfit)}</b>, NC-CPA <b>{fmt(current.ncCpa)}</b>, MER <b>{fmtX(current.mer)}</b>, payback <b>{current.paybackMonths <= 0 ? "instant" : !isFinite(current.paybackMonths) ? "never" : `${current.paybackMonths.toFixed(1)}mo`}</b>.</>
  });

  // 2. Distance to peak
  const peakDelta = pN - current.netProfit;
  if (peakDelta > 100 && pk) {
    const spendShift = pk.spend - current.spend;
    const roasShift = pk.roas - current.roas;
    const direction = spendShift > 0 ? "scale up" : spendShift < 0 ? "pull back" : "hold spend";
    recs.push({
      i: "🎯", tone: "good",
      title: "Biggest opportunity on the table",
      t: <>Peak net is <b>{fmtFull(pN)}</b> at <b>{fmt(pk.spend)} @ {fmtX(pk.roas)}</b> — <b style={{ color: "#78dca0" }}>{fmtFull(peakDelta)}/mo more</b> than you're making now. To get there: {direction} {spendShift !== 0 && <b>{fmt(Math.abs(spendShift))}</b>} in monthly spend{roasShift > 0 ? <>, and lift ROAS by <b>{roasShift.toFixed(2)}x</b></> : roasShift < 0 ? <>, and accept ROAS dipping by <b>{Math.abs(roasShift).toFixed(2)}x</b></> : ""}.</>
    });
  } else if (peakDelta <= 100 && current.netProfit > 0) {
    recs.push({
      i: "✅", tone: "good",
      title: "You're already near the peak",
      t: <>Current net ({fmtFull(current.netProfit)}) is within {fmtFull(peakDelta)} of the modelled peak. Focus on defending CAC and LTV rather than chasing more scale.</>
    });
  }

  // 3. NC-CPA diagnosis
  if (current.ncCpa > beCpaLtv) {
    const over = current.ncCpa - beCpaLtv;
    recs.push({
      i: "🚨", tone: "bad",
      title: "Your NC-CPA is above LTV",
      t: <>You pay <b style={{ color: "#ff9999" }}>{fmt(current.ncCpa)}</b> per new customer, but full LTV breakeven is <b>{fmt(beCpaLtv)}</b>. That's <b>{fmt(over)} over</b> — even repeat revenue won't rescue these cohorts. Priority: raise AOV, repeat rate, or creative efficiency before adding spend.</>
    });
  } else if (current.ncCpa > beCpa1) {
    recs.push({
      i: "⏳", tone: "warn",
      title: "You're buying future profit",
      t: <>NC-CPA ({fmt(current.ncCpa)}) sits between 1st-order breakeven ({fmt(beCpa1)}) and LTV breakeven ({fmt(beCpaLtv)}). That's fine — but you need <b>{current.paybackMonths.toFixed(1)} months</b> of cash runway before these cohorts pay off.</>
    });
  } else {
    recs.push({
      i: "💪", tone: "good",
      title: "Your NC-CPA is comfortable",
      t: <>At <b>{fmt(current.ncCpa)}</b>, you're under 1st-order breakeven ({fmt(beCpa1)}). You have room to push spend harder before profitability becomes an issue.</>
    });
  }

  // 4. LTV:CAC commentary
  if (current.ltvCac < 1) {
    recs.push({
      i: "📉", tone: "bad",
      title: "LTV:CAC below 1×",
      t: <>For every $1 of acquisition cost, you only recover <b>{fmtX(current.ltvCac)}</b> in lifetime profit. This channel is structurally unprofitable at current inputs. Check repeat rate, AOV, or margin assumptions — small changes here move the whole model.</>
    });
  } else if (current.ltvCac < 3) {
    recs.push({
      i: "📊", tone: "warn",
      title: "LTV:CAC in the viable zone",
      t: <>Current LTV:CAC is <b>{fmtX(current.ltvCac)}</b>. Healthy DTC brands target ≥3×. Improving repeat rate from {I.repeatRate}% to {(I.repeatRate + 10)}% or lifting retention AOV a few dollars pushes you into safer territory.</>
    });
  } else {
    recs.push({
      i: "🏆", tone: "good",
      title: "Strong LTV:CAC",
      t: <>LTV:CAC of <b>{fmtX(current.ltvCac)}</b> is above the 3× benchmark. You're extracting real value per acquired customer. You can afford to spend more aggressively if creative can hold efficiency.</>
    });
  }

  // 5. Scale suggestion
  if (current.netProfit > 0 && pk && pk.spend > current.spend) {
    const nextStep = Math.round((current.spend + pk.spend) / 2 / 1000) * 1000;
    recs.push({
      i: "🚀", tone: "info",
      title: "Next test to run",
      t: <>Don't jump straight to peak. Test <b>{fmt(nextStep)}/mo</b> (halfway to peak spend) for 30 days. Watch NC-CPA — if it stays under <b>{fmt(beCpaLtv)}</b> you have confidence to keep climbing.</>
    });
  }

  // 6. Cash warning
  const cashBurn = current.paidNewOrders * Math.max(0, current.ncCpa - beCpa1);
  if (cashBurn > 0 && current.paybackMonths > 0 && isFinite(current.paybackMonths)) {
    const tied = cashBurn * current.paybackMonths;
    if (tied > 10000) {
      recs.push({
        i: "💸", tone: "warn",
        title: "Working capital needed",
        t: <>You're fronting ~<b>{fmt(cashBurn)}/mo</b> above 1st-order breakeven. Over {current.paybackMonths.toFixed(1)}mo of payback, that's ~<b>{fmt(tied)}</b> of cash tied up in customer acquisition. Make sure your cash runway (or financing) can cover it before scaling.</>
      });
    }
  }

  const toneColor = (t) => t === "good" ? { bg: "rgba(120,220,160,0.05)", border: "rgba(120,220,160,0.25)", ic: "#78dca0" }
    : t === "bad" ? { bg: "rgba(200,60,60,0.06)", border: "rgba(200,60,60,0.3)", ic: "#ff9999" }
    : t === "warn" ? { bg: "rgba(255,190,80,0.05)", border: "rgba(255,190,80,0.25)", ic: "#ffbe50" }
    : { bg: "rgba(120,170,237,0.05)", border: "rgba(120,170,237,0.22)", ic: "#9ec4f5" };

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>🤖 AI Recommendations For You</h3>
        <span style={{ fontSize: 12, color: "#8a8fa8" }}>Based on your current {fmt(current.spend)} @ {fmtX(current.roas)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {recs.map((r, i) => {
          const col = toneColor(r.tone);
          return (
            <div key={i} style={{ padding: "13px 15px", borderRadius: 9, background: col.bg, border: `1.5px solid ${col.border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: "22px", flexShrink: 0 }}>{r.i}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: col.ic, marginBottom: 4 }}>{r.title}</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#e8eaf2" }}>{r.t}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── GENERAL INSIGHTS ── */
function Ins({ engine, I, roasVals, spendVals }) {
  const { grid, beCpa1, beCpaLtv, oContrib } = engine;
  const items = [];
  let pN = -Infinity, pSi = 0, pRi = 0;
  grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = grid[pSi][pRi];
  let lN = -Infinity, lSi = 0, lRi = 0;
  grid.forEach((r, si) => r.forEach((c, ri) => { if (c.ltvAdjustedNet > lN) { lN = c.ltvAdjustedNet; lSi = si; lRi = ri; } }));
  const lk = grid[lSi][lRi];

  items.push({ i: "💰", t: `Peak monthly net is ${fmtFull(pN)} at ${fmt(pk.spend)} spend / ${fmtX(pk.roas)} ROAS — ${fmt(pk.totalRev)} total revenue, ${fmtX(pk.mer)} MER, ${fmt(pk.ncCpa)} NC-CPA.` });

  if (lSi !== pSi || lRi !== pRi) {
    items.push({ i: "📈", t: `LTV-adjusted peak shifts to ${fmt(lk.spend)} @ ${fmtX(lk.roas)} — ${fmtFull(lN)} of LTV net, ${fmtFull(lN - pN)} more than the single-month view. Payback ${lk.paybackMonths.toFixed(1)}mo. Lean in only if cash flow can absorb the gap.` });
  }

  if (I.monthlyOrganicRevenue > 0) {
    items.push({ i: "🌱", t: `Organic (${fmt(I.monthlyOrganicRevenue)}/mo) contributes ${fmt(oContrib)} in margin — subsidizing paid acquisition. At peak it's ${(I.monthlyOrganicRevenue / pk.totalRev * 100).toFixed(0)}% of total revenue.` });
  }

  items.push({ i: "🎯", t: `Breakeven NC-CPA: ${fmt(beCpa1)} on order 1, ${fmt(beCpaLtv)} on full LTV. The zone between the two is where you're buying future profit.` });

  return (
    <div style={{ background: "rgba(255,190,80,0.05)", border: "1.5px solid rgba(255,190,80,0.22)", borderRadius: 9, padding: "16px 18px", marginBottom: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#ffbe50", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--m)" }}>
        <span style={{ fontSize: 16 }}>💡</span> CFO Insights
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 10, marginBottom: i < items.length - 1 ? 11 : 0, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16, lineHeight: "22px", flexShrink: 0 }}>{item.i}</span>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "#e8eaf2" }}>{item.t}</p>
        </div>
      ))}
    </div>
  );
}

/* ── MAIN APP ── */
export default function App() {
  const [I, setI] = useState(DEFAULTS);
  const [os, setOs] = useState({ current: true, unit: false, mix: false, organic: false, ltv: false, fixed: false, axis: false });
  const [view, setView] = useState("all");
  const s = useCallback((k, v) => setI(p => ({ ...p, [k]: v })), []);
  const tg = (k) => setOs(p => ({ ...p, [k]: !p[k] }));

  const rV = useMemo(() => { const v = []; for (let r = I.roasMin; r <= I.roasMax + 0.001; r += I.roasStep) v.push(Math.round(r * 100) / 100); return v; }, [I.roasMin, I.roasMax, I.roasStep]);
  const sV = useMemo(() => { const v = [], st = (I.spendMax - I.spendMin) / I.spendSteps; for (let i = 0; i <= I.spendSteps; i++) v.push(Math.round(I.spendMin + i * st)); return v; }, [I.spendMin, I.spendMax, I.spendSteps]);
  const eng = useMemo(() => compute(I, rV, sV), [I, rV, sV]);

  let pN = -Infinity, pSi = 0, pRi = 0;
  eng.grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = eng.grid[pSi][pRi];
  const cur = eng.current;

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: "#0c0e16", color: "#e8eaf2", fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.4}`}</style>

      {/* HEADER */}
      <div style={{ padding: "20px 26px 18px", borderBottom: "1.5px solid rgba(255,255,255,0.08)", background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 40, height: 40, borderRadius: 9, background: "linear-gradient(135deg, rgba(120,220,160,0.2), rgba(120,180,240,0.2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, border: "1.5px solid rgba(120,220,160,0.25)" }}>📊</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#ffffff" }}>E-Commerce Profit Matrix</h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#b8bcd0" }}>Plot your current spend × ROAS and see where you could go</p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}>
        {/* LEFT — INPUTS */}
        <div style={{ borderRight: "1.5px solid rgba(255,255,255,0.08)", padding: "16px 16px", overflowY: "auto", maxHeight: "calc(100vh - 78px)", background: "rgba(255,255,255,0.01)" }}>

          <Sec label="Your Current Performance" sub="Where you are right now" badge="YOU" accent="you" open={os.current} onToggle={() => tg("current")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Current Monthly Spend" pre="$" value={I.currentSpend} onChange={v => s("currentSpend", v)} step={1000} help="What you spend today" />
              <Inp label="Current Blended ROAS" suf="x" value={I.currentRoas} onChange={v => s("currentRoas", v)} step={0.1} help="Paid rev ÷ spend" />
            </div>
            <p style={{ fontSize: 11.5, color: "#8a8fa8", margin: "10px 0 0", lineHeight: 1.5 }}>Your position is plotted on each grid as <b style={{ color: "#ffbe50" }}>● YOU</b>. Recommendations below update live.</p>
          </Sec>

          <Sec label="Unit Economics" sub="AOV, margin, variable costs" open={os.unit} onToggle={() => tg("unit")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="New AOV" pre="$" value={I.newAov} onChange={v => s("newAov", v)} step={1} help="1st-order basket" />
              <Inp label="Return AOV" pre="$" value={I.retAov} onChange={v => s("retAov", v)} step={1} help="Repeat-order basket" />
              <Inp label="Gross Margin" suf="%" value={I.grossMarginPct} onChange={v => s("grossMarginPct", v)} step={.5} help="After COGS" />
              <Inp label="Shipping / Order" pre="$" value={I.shippingPerOrder} onChange={v => s("shippingPerOrder", v)} step={.5} />
              <Inp label="Processing" suf="%" value={I.processingPct} onChange={v => s("processingPct", v)} step={.1} help="Stripe / card fees" />
              <Inp label="Other Var / Order" pre="$" value={I.otherVarPerOrder} onChange={v => s("otherVarPerOrder", v)} step={.5} />
              <Inp label="Var % of Rev" suf="%" value={I.otherVarPctRevenue} onChange={v => s("otherVarPctRevenue", v)} step={.1} help="Platform / rev share" />
            </div>
          </Sec>

          <Sec label="New vs Returning Mix" sub="Prospecting scales with spend" badge="SPLIT" open={os.mix} onToggle={() => tg("mix")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="New % at Low Spend" suf="%" value={I.newCustPctBase} onChange={v => s("newCustPctBase", v)} step={1} help="At min spend" />
              <Inp label="New % at High Spend" suf="%" value={I.newCustPctAtMaxSpend} onChange={v => s("newCustPctAtMaxSpend", v)} step={1} help="At max spend" />
            </div>
            <p style={{ fontSize: 11.5, color: "#8a8fa8", margin: "8px 0 0", lineHeight: 1.5 }}>Linear interpolation between the two. More spend → more prospecting → higher new-customer share.</p>
          </Sec>

          <Sec label="Organic / Non-Paid Revenue" sub="SEO, direct, email, referral" badge="BASELINE" open={os.organic} onToggle={() => tg("organic")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Monthly Organic" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} help="Non-paid revenue" />
              <Inp label="Organic New %" suf="%" value={I.organicNewPct} onChange={v => s("organicNewPct", v)} step={5} help="New-cust share" />
            </div>
          </Sec>

          <Sec label="LTV Assumptions" sub="Repeat rate, cycle, orders" badge="PAYBACK" open={os.ltv} onToggle={() => tg("ltv")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="Repeat Rate" suf="%" value={I.repeatRate} onChange={v => s("repeatRate", v)} step={1} help="% who reorder" />
              <Inp label="Orders / Repeater" value={I.avgOrdersPerRepeater} onChange={v => s("avgOrdersPerRepeater", v)} step={.1} help="Lifetime orders" />
              <Inp label="Repeat Cycle" suf="mo" value={I.avgRepeatCycleMonths} onChange={v => s("avgRepeatCycleMonths", v)} step={.5} help="Between orders" />
            </div>
          </Sec>

          <Sec label="Fixed Costs" sub="Overhead, payroll, SaaS" open={os.fixed} onToggle={() => tg("fixed")}>
            <Inp label="Monthly Fixed" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} help="Rent, salaries, tools" />
          </Sec>

          <Sec label="Axis Configuration" sub="Grid bounds" open={os.axis} onToggle={() => tg("axis")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Inp label="ROAS Min" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={.25} />
              <Inp label="ROAS Max" suf="x" value={I.roasMax} onChange={v => s("roasMax", v)} step={.25} />
              <Inp label="ROAS Step" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={.05} min={.1} />
              <Inp label="Spend Steps" value={I.spendSteps} onChange={v => s("spendSteps", v)} step={1} min={3} max={16} />
              <Inp label="Spend Min" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} />
              <Inp label="Spend Max" pre="$" value={I.spendMax} onChange={v => s("spendMax", v)} step={10000} />
            </div>
          </Sec>

          {/* Unit Econ Reference */}
          <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 9, background: "rgba(120,170,237,0.05)", border: "1.5px solid rgba(120,170,237,0.18)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ec4f5", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontFamily: "var(--m)" }}>Unit Econ Reference</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.85, fontFamily: "var(--m)", color: "#b8bcd0" }}>
              <div>New order profit: <b style={{ color: eng.nOP >= 0 ? "#78dca0" : "#ff9999" }}>{fmtFull(eng.nOP)}</b></div>
              <div>Repeat order profit: <b style={{ color: "#78dca0" }}>{fmtFull(eng.rOP)}</b></div>
              <div>Expected repeats: <b style={{ color: "#ffffff" }}>{eng.expRepeats.toFixed(1)}</b></div>
              <div>LTV (profit): <b style={{ color: "#78dca0" }}>{fmtFull(eng.ltvP)}</b></div>
              <div>LTV (revenue): <b style={{ color: "#ffffff" }}>{fmtFull(eng.ltvR)}</b></div>
              <div>Realized over: <b style={{ color: "#ffffff" }}>{eng.ltvMonths.toFixed(0)}mo</b></div>
              <div style={{ borderTop: "1.5px solid rgba(255,255,255,0.08)", marginTop: 6, paddingTop: 6 }}>
                BE NC-CPA (1st): <b style={{ color: "#ffbe50" }}>{fmtFull(eng.beCpa1)}</b>
              </div>
              <div>BE NC-CPA (LTV): <b style={{ color: "#78dca0" }}>{fmtFull(eng.beCpaLtv)}</b></div>
            </div>
          </div>
        </div>

        {/* RIGHT — OUTPUT */}
        <div style={{ padding: "18px 22px", overflowY: "auto", maxHeight: "calc(100vh - 78px)" }}>
          {/* Your current snapshot */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>Your Current Snapshot</h2>
            <span style={{ fontSize: 12, color: "#ffbe50", fontWeight: 700 }}>● {fmt(I.currentSpend)} @ {fmtX(I.currentRoas)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 18 }}>
            <MC label="Your Net Profit" value={fmtFull(cur.netProfit)} sub={`${fmt(cur.totalRev)} total rev`} color={cur.netProfit > 0 ? "#78dca0" : "#ff9999"} you />
            <MC label="Your NC-CPA" value={fmt(cur.ncCpa)} sub={cur.ncCpa <= eng.beCpa1 ? "Under 1st-order BE" : cur.ncCpa <= eng.beCpaLtv ? "Under LTV BE" : "Over LTV BE"} color={cur.ncCpa <= eng.beCpa1 ? "#78dca0" : cur.ncCpa <= eng.beCpaLtv ? "#ffbe50" : "#ff9999"} you />
            <MC label="Your MER" value={fmtX(cur.mer)} sub={`${Math.round(cur.paidOrders)} paid orders/mo`} color="#9ec4f5" you />
            <MC label="Your LTV:CAC" value={fmtX(cur.ltvCac)} sub={cur.ltvCac >= 3 ? "Strong ≥3×" : cur.ltvCac >= 1 ? "Viable" : "Weak <1×"} color={cur.ltvCac >= 3 ? "#78dca0" : cur.ltvCac >= 1 ? "#ffbe50" : "#ff9999"} you />
            <MC label="Your Payback" value={cur.paybackMonths <= 0 ? "Instant" : !isFinite(cur.paybackMonths) ? "Never" : `${cur.paybackMonths.toFixed(1)}mo`} sub="To recover NC-CPA" color={cur.paybackMonths <= 6 ? "#78dca0" : cur.paybackMonths <= 12 ? "#ffbe50" : "#ff9999"} you />
          </div>

          {/* Model peak headlines */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.015em" }}>Model Peak & Breakevens</h2>
            <span style={{ fontSize: 12, color: "#8a8fa8" }}>Best spot in the grid</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 20 }}>
            <MC label="Peak Net Profit" value={fmtFull(pN)} sub={`${fmt(pk.spend)} @ ${fmtX(pk.roas)}`} color={pN > 0 ? "#78dca0" : "#ff9999"} />
            <MC label="MER at Peak" value={fmtX(pk.mer)} sub={`${fmt(pk.totalRev)} total rev`} color="#9ec4f5" />
            <MC label="BE NC-CPA (1st)" value={fmt(eng.beCpa1)} sub="Break even on order 1" color="#ffbe50" />
            <MC label="BE NC-CPA (LTV)" value={fmt(eng.beCpaLtv)} sub={`Over ${eng.ltvMonths.toFixed(0)}mo lifetime`} color="#78dca0" />
            <MC label="Organic Contrib" value={fmt(eng.oContrib)} sub={`${fmt(eng.oR)} / mo rev`} color="#ffffff" />
          </div>

          <Recs engine={eng} I={I} />

          <Ins engine={eng} I={I} roasVals={rV} spendVals={sV} />

          {/* View Toggles */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#b8bcd0", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--m)" }}>Scenario view</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {[["all", "All Tables"], ["acq", "Acquisition"], ["contrib", "Contribution"], ["net", "Net Profit"], ["ltv", "LTV & Payback"]].map(([k, l]) =>
                <Pill key={k} a={view === k} onClick={() => setView(k)}>{l}</Pill>
              )}
            </div>
          </div>

          {(view === "all" || view === "acq") && <AcqT engine={eng} roasVals={rV} spendVals={sV} />}

          {(view === "all" || view === "contrib") && (
            <HT title="Total Contribution Margin"
              sub="Paid + Organic margin — before fixed costs"
              help="Revenue minus COGS, shipping, fees, and ad spend. What's left to cover overhead and profit."
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.totalContrib} cellFn={c => fmt(c.totalContrib)} maxMark
              youSi={eng.nearestSi} youRi={eng.nearestRi} />
          )}

          {(view === "all" || view === "net") && (
            <HT title="True Net Profit"
              sub={`After ${fmtFull(I.monthlyFixedCosts)} in monthly fixed costs`}
              help="Bottom line each month. Green = you keep money. Red = you burn cash. ● YOU shows your current spot, ★ PEAK shows the grid's best outcome."
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.netProfit} cellFn={c => fmt(c.netProfit)} maxMark
              youSi={eng.nearestSi} youRi={eng.nearestRi} />
          )}

          {(view === "all" || view === "ltv") && <LtvT engine={eng} roasVals={rV} spendVals={sV} />}

          {/* Methodology */}
          <div style={{ marginTop: 18, padding: "14px 18px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1.5px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#b8bcd0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, fontFamily: "var(--m)" }}>How to Read the Grid</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "#e8eaf2", marginBottom: 12 }}>
              <p style={{ margin: "0 0 6px" }}>Rows = <b style={{ color: "#78dca0" }}>monthly ad spend</b>. Columns = <b style={{ color: "#78dca0" }}>blended ROAS</b> (paid revenue ÷ spend). Each cell = that scenario's outcome.</p>
              <p style={{ margin: "0" }}>The <b style={{ color: "#ffbe50" }}>● YOU</b> marker plots your current spend × ROAS. The <b style={{ color: "#78dca0" }}>★ PEAK</b> marker shows where the metric is highest. Compare them to see the gap you can close.</p>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "#8a8fa8", fontFamily: "var(--m)", columns: 2, columnGap: 22, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
              <div><b style={{ color: "#b8bcd0" }}>Paid Rev</b> = Spend × ROAS</div>
              <div><b style={{ color: "#b8bcd0" }}>Total Rev</b> = Paid + Organic</div>
              <div><b style={{ color: "#b8bcd0" }}>MER</b> = Total Rev ÷ Spend</div>
              <div><b style={{ color: "#b8bcd0" }}>NC-CPA</b> = Spend ÷ New Paid Customers</div>
              <div><b style={{ color: "#b8bcd0" }}>NC-ROAS</b> = New Cust Rev ÷ Spend</div>
              <div><b style={{ color: "#b8bcd0" }}>CPA</b> = Spend ÷ Total Paid Orders</div>
              <div><b style={{ color: "#b8bcd0" }}>Contribution</b> = GP − Var Costs − Spend</div>
              <div><b style={{ color: "#b8bcd0" }}>LTV:CAC</b> = LTV Profit ÷ NC-CPA</div>
              <div><b style={{ color: "#b8bcd0" }}>Payback</b> = Deficit ÷ Monthly Repeat Profit</div>
              <div><b style={{ color: "#b8bcd0" }}>LTV Net</b> = Net + Future Repeat Profit</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

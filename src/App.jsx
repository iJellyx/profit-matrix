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
    return `rgba(${Math.round(180 + 60 * t)},${Math.round(70 - 30 * t)},${Math.round(70 - 30 * t)},${0.18 + 0.55 * t})`;
  }
  const t = Math.min(1, value / Math.max(1, max));
  return `rgba(${Math.round(40 + 20 * t)},${Math.round(110 + 120 * t)},${Math.round(70 + 40 * t)},${0.14 + 0.55 * t})`;
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
function Inp({ label, value, onChange, pre, suf, step, min, max, help }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 13, fontWeight: 700, color: "#d8dae8" }}>{label}</label>
      {help && <span style={{ fontSize: 12, color: "#8a8fa8", lineHeight: 1.4 }}>{help}</span>}
      <div style={{ display: "flex", alignItems: "center", background: "#1a1d2e", border: "1.5px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 10px", gap: 5 }}>
        {pre && <span style={{ color: "#8a8fa8", fontSize: 15, fontWeight: 600 }}>{pre}</span>}
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} step={step || 1} min={min} max={max}
          style={{ background: "transparent", border: "none", outline: "none", color: "#ffffff", fontSize: 16, fontWeight: 600, width: "100%", fontFamily: "var(--m)" }} />
        {suf && <span style={{ color: "#8a8fa8", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{suf}</span>}
      </div>
    </div>
  );
}

function Pill({ a, onClick, children }) {
  return <button onClick={onClick} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: "2px solid", borderColor: a ? "#78dca0" : "rgba(255,255,255,0.12)", background: a ? "rgba(120,220,160,0.18)" : "rgba(255,255,255,0.03)", color: a ? "#78dca0" : "#b8bcd0", transition: "all .2s" }}>{children}</button>;
}

function Sec({ label, open, onToggle, children, sub }) {
  return (
    <div style={{ marginBottom: 10, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", padding: "12px 14px", width: "100%", textAlign: "left" }}>
        <span style={{ fontSize: 13, color: "#78dca0", transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block", fontWeight: 700 }}>▶</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>{label}</div>
          {sub && <div style={{ fontSize: 12, color: "#8a8fa8", marginTop: 2 }}>{sub}</div>}
        </div>
      </button>
      {open && <div style={{ padding: "14px 16px 16px" }}>{children}</div>}
    </div>
  );
}

function MC({ label, value, sub, color, help }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1.5px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#b8bcd0", marginBottom: 6 }}>{label}</div>
      {help && <div style={{ fontSize: 12, color: "#8a8fa8", marginBottom: 8, lineHeight: 1.4 }}>{help}</div>}
      <div style={{ fontSize: 26, fontWeight: 800, color: color || "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#8a8fa8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LD({ color, label }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: color }} /><span style={{ fontSize: 13, color: "#b8bcd0", fontWeight: 500 }}>{label}</span></div>;
}

/* ── HEAT TABLE ── */
function HT({ title, sub, help, data, roasVals, spendVals, cellFn, valFn, maxMark }) {
  const all = data.flat().map(valFn);
  const mn = Math.min(...all), mx = Math.max(...all);
  let mV = -Infinity, mR = -1, mS = -1;
  if (maxMark) data.forEach((row, si) => row.forEach((c, ri) => { const v = valFn(c); if (v > mV) { mV = v; mR = ri; mS = si; } }));

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>{title}</h3>
        {sub && <p style={{ margin: "4px 0 0", fontSize: 14, color: "#b8bcd0" }}>{sub}</p>}
        {help && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8a8fa8", lineHeight: 1.5, maxWidth: 700 }}>{help}</p>}
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "12px 14px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 12, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "#8a8fa8", marginBottom: 2 }}>Ad Spend ↓</div>
              <div>Ad Return →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "12px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 14, fontWeight: 700, color: "#ffffff", textAlign: "center", whiteSpace: "nowrap" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "10px 14px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = data[si][ri]; const v = valFn(c); const isM = maxMark && ri === mR && si === mS;
                  return (
                    <td key={roas} style={{ padding: "10px 6px", textAlign: "center", background: hc(v, mn, mx), borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 14, fontWeight: isM ? 800 : 600, color: v < 0 ? "#ff9999" : "#ffffff", whiteSpace: "nowrap", outline: isM ? "3px solid #78dca0" : "none", outlineOffset: -3, position: "relative" }}>
                      {cellFn(c)}
                      {isM && <div style={{ position: "absolute", top: 2, right: 3, fontSize: 10, color: "#78dca0", fontWeight: 800 }}>★ BEST</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <LD color="rgba(200,60,60,0.6)" label="Losing money" />
        <LD color="rgba(100,100,120,0.2)" label="About even" />
        <LD color="rgba(60,180,90,0.6)" label="Making money" />
        {maxMark && mV > -Infinity && <span style={{ marginLeft: "auto", fontSize: 14, color: "#78dca0", fontWeight: 700 }}>★ Best spot: {fmtFull(mV)}</span>}
      </div>
    </div>
  );
}

/* ── ACQ METRICS TABLE ── */
function AcqT({ engine, roasVals, spendVals }) {
  const { grid, beCpa1, beCpaLtv } = engine;
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#ffffff" }}>Cost to Get Customers</h3>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#b8bcd0" }}>How much you pay to bring in each new person</p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8a8fa8", lineHeight: 1.5, maxWidth: 700 }}>
          Green means cheap and safe. Yellow means you pay more up front but earn it back later. Red means too expensive — you won't get the money back.
        </p>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "12px 14px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 12, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "#8a8fa8", marginBottom: 2 }}>Ad Spend ↓</div>
              <div>Ad Return →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "12px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 14, fontWeight: 700, color: "#ffffff", textAlign: "center" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "10px 14px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14, fontWeight: 700, color: "#ffffff" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const bad = c.ncCpa > beCpaLtv, warn = c.ncCpa > beCpa1 && !bad;
                  return (
                    <td key={roas} style={{ padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: bad ? "rgba(200,60,60,0.18)" : warn ? "rgba(255,190,80,0.14)" : "rgba(60,180,100,0.12)", fontSize: 12, lineHeight: 1.7, textAlign: "left" }}>
                      <div><span style={{ color: "#b8bcd0" }}>New customer: </span><span style={{ color: bad ? "#ff9999" : warn ? "#ffce70" : "#b8f0c8", fontWeight: 800 }}>{fmt(c.ncCpa)}</span></div>
                      <div><span style={{ color: "#b8bcd0" }}>Any order: </span><span style={{ color: "#ffffff", fontWeight: 700 }}>{fmt(c.cpa)}</span></div>
                      <div><span style={{ color: "#b8bcd0" }}>New return: </span><span style={{ color: "#ffffff", fontWeight: 700 }}>{fmtX(c.ncRoas)}</span></div>
                      <div><span style={{ color: "#b8bcd0" }}>Total return: </span><span style={{ color: "#9ec4f5", fontWeight: 700 }}>{fmtX(c.mer)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        <LD color="rgba(60,180,100,0.3)" label={`Cheap: pay ${fmt(beCpa1)} or less — profit right away`} />
        <LD color="rgba(255,190,80,0.3)" label={`OK: pay up to ${fmt(beCpaLtv)} — profit over time`} />
        <LD color="rgba(200,60,60,0.3)" label="Too much: you lose money even long-term" />
      </div>
    </div>
  );
}

/* ── LTV TABLE ── */
function LtvT({ engine, roasVals, spendVals }) {
  const { grid } = engine;
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#ffffff" }}>How Long to Make Your Money Back</h3>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: "#b8bcd0" }}>Customers buy more than once — this shows when they pay you back</p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8a8fa8", lineHeight: 1.5, maxWidth: 700 }}>
          Shorter payback time is better. A ratio of 3 or higher means every $1 you spend earns $3 or more over time.
        </p>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.08)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            <th style={{ position: "sticky", left: 0, zIndex: 3, padding: "12px 14px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 12, fontWeight: 700, color: "#b8bcd0", textAlign: "left", minWidth: 110 }}>
              <div style={{ fontSize: 11, color: "#8a8fa8", marginBottom: 2 }}>Ad Spend ↓</div>
              <div>Ad Return →</div>
            </th>
            {roasVals.map(r => <th key={r} style={{ padding: "12px 8px", background: "#181b2b", borderBottom: "2px solid rgba(255,255,255,0.1)", fontSize: 14, fontWeight: 700, color: "#ffffff", textAlign: "center" }}>{r.toFixed(2)}x</th>)}
          </tr></thead>
          <tbody>
            {spendVals.map((spend, si) => (
              <tr key={spend}>
                <td style={{ position: "sticky", left: 0, zIndex: 2, padding: "10px 14px", background: "#181b2b", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 14, fontWeight: 700, color: "#ffffff" }}>{fmt(spend)}</td>
                {roasVals.map((roas, ri) => {
                  const c = grid[si][ri];
                  const pbBad = c.paybackMonths > 12 || !isFinite(c.paybackMonths);
                  const pbWarn = c.paybackMonths > 6;
                  return (
                    <td key={roas} style={{ padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 12, lineHeight: 1.7, textAlign: "left", background: pbBad ? "rgba(200,60,60,0.12)" : pbWarn ? "rgba(255,190,80,0.08)" : "rgba(60,180,100,0.08)" }}>
                      <div><span style={{ color: "#b8bcd0" }}>Paid back in: </span><span style={{ color: c.paybackMonths <= 0 ? "#b8f0c8" : pbBad ? "#ff9999" : pbWarn ? "#ffce70" : "#b8f0c8", fontWeight: 800 }}>{c.paybackMonths <= 0 ? "Right away" : !isFinite(c.paybackMonths) ? "Never" : `${c.paybackMonths.toFixed(1)} months`}</span></div>
                      <div><span style={{ color: "#b8bcd0" }}>Long-term ratio: </span><span style={{ color: c.ltvCac >= 3 ? "#b8f0c8" : c.ltvCac >= 1 ? "#ffce70" : "#ff9999", fontWeight: 800 }}>{fmtX(c.ltvCac)}</span></div>
                      <div><span style={{ color: "#b8bcd0" }}>Long-term profit: </span><span style={{ color: c.ltvAdjustedNet < 0 ? "#ff9999" : "#9ec4f5", fontWeight: 700 }}>{fmt(c.ltvAdjustedNet)}</span></div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        <LD color="#b8f0c8" label="Great: pays back fast, ratio 3 or more" />
        <LD color="#ffce70" label="OK: 6 to 12 months, ratio 1 to 3" />
        <LD color="#ff9999" label="Bad: over 12 months, ratio below 1" />
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

  items.push({ i: "💰", t: `Your best spot right now: spend ${fmt(pk.spend)} on ads with a ${fmtX(pk.roas)} return. You would make ${fmtFull(pN)} in profit this month. That adds up to ${fmt(pk.totalRev)} in total sales.` });

  if (lSi !== pSi || lRi !== pRi) {
    items.push({ i: "📈", t: `If you can wait for the money, spend more: ${fmt(lk.spend)} at ${fmtX(lk.roas)} makes ${fmtFull(lN)} over time. That's ${fmtFull(lN - pN)} more than the short-term best. You get paid back in ${lk.paybackMonths.toFixed(1)} months.` });
  }

  if (I.monthlyOrganicRevenue > 0) {
    items.push({ i: "🌱", t: `You get ${fmt(I.monthlyOrganicRevenue)} every month without paying for ads (from Google, email, word-of-mouth). That gives you ${fmt(oContrib)} in extra profit each month to work with.` });
  }

  items.push({ i: "🎯", t: `Rule of thumb: pay no more than ${fmt(beCpa1)} for a new customer to break even right away. You can pay up to ${fmt(beCpaLtv)} if you're OK waiting — that's what they're worth long-term.` });

  const lo = grid[0][roasVals.length - 1];
  if (pN > lo.netProfit && (pSi > 0 || pRi < roasVals.length - 1)) {
    items.push({ i: "⚡", t: `Playing it safe costs you. Spending only ${fmt(spendVals[0])} at ${fmtX(roasVals[roasVals.length - 1])} makes ${fmtFull(lo.netProfit)}. That's ${fmtFull(pN - lo.netProfit)} less than your best option.` });
  }

  const cashBurn = pk.paidNewOrders * Math.max(0, pk.ncCpa - beCpa1);
  if (cashBurn > 0 && pk.paybackMonths > 0) {
    items.push({ i: "💸", t: `Heads up on cash: at the best spot, you front about ${fmt(cashBurn)} a month extra for new customers. Over ${pk.paybackMonths.toFixed(1)} months, that's about ${fmt(cashBurn * pk.paybackMonths)} in cash you need before customers pay you back.` });
  }

  return (
    <div style={{ background: "rgba(255,190,80,0.06)", border: "1.5px solid rgba(255,190,80,0.25)", borderRadius: 10, padding: "18px 20px", marginBottom: 26 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#ffbe50", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>💡</span> What This Means For You
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 12, marginBottom: i < items.length - 1 ? 14 : 0, alignItems: "flex-start" }}>
          <span style={{ fontSize: 20, lineHeight: "24px", flexShrink: 0 }}>{item.i}</span>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#e8eaf2" }}>{item.t}</p>
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

  let pN = -Infinity, pSi = 0, pRi = 0;
  eng.grid.forEach((r, si) => r.forEach((c, ri) => { if (c.netProfit > pN) { pN = c.netProfit; pSi = si; pRi = ri; } }));
  const pk = eng.grid[pSi][pRi];

  return (
    <div style={{ "--m": "'JetBrains Mono', monospace", "--h": "'Space Grotesk', system-ui, sans-serif", minHeight: "100vh", background: "#0c0e16", color: "#e8eaf2", fontFamily: "var(--h)" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:4px}input[type=number]::-webkit-inner-spin-button{opacity:.4}`}</style>

      {/* HEADER */}
      <div style={{ padding: "22px 28px 20px", borderBottom: "1.5px solid rgba(255,255,255,0.08)", background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg, rgba(120,220,160,0.2), rgba(120,180,240,0.2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: "1.5px solid rgba(120,220,160,0.25)" }}>📊</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "#ffffff" }}>Profit Planner</h1>
            <p style={{ margin: "3px 0 0", fontSize: 15, color: "#b8bcd0" }}>Find out how much to spend on ads to make the most money</p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr" }}>
        {/* LEFT — INPUTS */}
        <div style={{ borderRight: "1.5px solid rgba(255,255,255,0.08)", padding: "20px 18px", overflowY: "auto", maxHeight: "calc(100vh - 86px)", background: "rgba(255,255,255,0.01)" }}>

          <div style={{ padding: "12px 14px", background: "rgba(120,170,237,0.08)", border: "1.5px solid rgba(120,170,237,0.25)", borderRadius: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#9ec4f5", marginBottom: 4 }}>👋 Fill in your numbers</div>
            <div style={{ fontSize: 13, color: "#b8bcd0", lineHeight: 1.5 }}>Click each section to open it. Change the numbers to match your store.</div>
          </div>

          <Sec label="1. Your Order Basics" sub="What each order is worth and what it costs" open={os.unit} onToggle={() => tg("unit")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="New order size" pre="$" value={I.newAov} onChange={v => s("newAov", v)} step={1} help="How much a new buyer spends" />
              <Inp label="Repeat order size" pre="$" value={I.retAov} onChange={v => s("retAov", v)} step={1} help="How much repeat buyers spend" />
              <Inp label="Profit margin" suf="%" value={I.grossMarginPct} onChange={v => s("grossMarginPct", v)} step={.5} help="After making the product" />
              <Inp label="Shipping cost" pre="$" value={I.shippingPerOrder} onChange={v => s("shippingPerOrder", v)} step={.5} help="Per order" />
              <Inp label="Payment fees" suf="%" value={I.processingPct} onChange={v => s("processingPct", v)} step={.1} help="Like Stripe" />
              <Inp label="Other fees" pre="$" value={I.otherVarPerOrder} onChange={v => s("otherVarPerOrder", v)} step={.5} help="Per order" />
              <Inp label="Revenue fees" suf="%" value={I.otherVarPctRevenue} onChange={v => s("otherVarPctRevenue", v)} step={.1} help="Like Shopify" />
            </div>
          </Sec>

          <Sec label="2. New vs. Repeat Buyers" sub="More spending brings more new people" open={os.mix} onToggle={() => tg("mix")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="New buyers (low spend)" suf="%" value={I.newCustPctBase} onChange={v => s("newCustPctBase", v)} step={1} help="When ads are small" />
              <Inp label="New buyers (high spend)" suf="%" value={I.newCustPctAtMaxSpend} onChange={v => s("newCustPctAtMaxSpend", v)} step={1} help="When ads are big" />
            </div>
            <p style={{ fontSize: 13, color: "#8a8fa8", margin: "10px 0 0", lineHeight: 1.5 }}>When you spend more on ads, you reach more brand-new people.</p>
          </Sec>

          <Sec label="3. Free Sales (No Ads)" sub="Sales from Google, email, word-of-mouth" open={os.organic} onToggle={() => tg("organic")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="Free sales monthly" pre="$" value={I.monthlyOrganicRevenue} onChange={v => s("monthlyOrganicRevenue", v)} step={5000} help="Without ads" />
              <Inp label="New buyers here" suf="%" value={I.organicNewPct} onChange={v => s("organicNewPct", v)} step={5} help="First-time buyers" />
            </div>
          </Sec>

          <Sec label="4. Repeat Buying" sub="How often customers come back" open={os.ltv} onToggle={() => tg("ltv")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="Come back rate" suf="%" value={I.repeatRate} onChange={v => s("repeatRate", v)} step={1} help="Who buys again" />
              <Inp label="Orders each" value={I.avgOrdersPerRepeater} onChange={v => s("avgOrdersPerRepeater", v)} step={.1} help="How many times" />
              <Inp label="Time between" suf="mo" value={I.avgRepeatCycleMonths} onChange={v => s("avgRepeatCycleMonths", v)} step={.5} help="Months apart" />
            </div>
          </Sec>

          <Sec label="5. Fixed Monthly Costs" sub="Bills you pay no matter what" open={os.fixed} onToggle={() => tg("fixed")}>
            <Inp label="Fixed costs monthly" pre="$" value={I.monthlyFixedCosts} onChange={v => s("monthlyFixedCosts", v)} step={1000} help="Rent, staff, software" />
          </Sec>

          <Sec label="6. Chart Settings" sub="Change what the table shows" open={os.axis} onToggle={() => tg("axis")}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="Ad return low" suf="x" value={I.roasMin} onChange={v => s("roasMin", v)} step={.25} />
              <Inp label="Ad return high" suf="x" value={I.roasMax} onChange={v => s("roasMax", v)} step={.25} />
              <Inp label="Return step" suf="x" value={I.roasStep} onChange={v => s("roasStep", v)} step={.05} min={.1} />
              <Inp label="Spend rows" value={I.spendSteps} onChange={v => s("spendSteps", v)} step={1} min={3} max={16} />
              <Inp label="Spend low" pre="$" value={I.spendMin} onChange={v => s("spendMin", v)} step={5000} />
              <Inp label="Spend high" pre="$" value={I.spendMax} onChange={v => s("spendMax", v)} step={10000} />
            </div>
          </Sec>

          {/* Quick Summary */}
          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, background: "rgba(120,170,237,0.06)", border: "1.5px solid rgba(120,170,237,0.2)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#9ec4f5", marginBottom: 10 }}>📋 Quick Summary</div>
            <div style={{ fontSize: 14, lineHeight: 1.9, color: "#e8eaf2" }}>
              <div>Profit per new order: <b style={{ color: eng.nOP >= 0 ? "#78dca0" : "#ff9999" }}>{fmtFull(eng.nOP)}</b></div>
              <div>Profit per repeat order: <b style={{ color: "#78dca0" }}>{fmtFull(eng.rOP)}</b></div>
              <div>Avg repeat orders: <b style={{ color: "#ffffff" }}>{eng.expRepeats.toFixed(1)}</b></div>
              <div>Customer lifetime profit: <b style={{ color: "#78dca0" }}>{fmtFull(eng.ltvP)}</b></div>
              <div>Lifetime sales value: <b style={{ color: "#ffffff" }}>{fmtFull(eng.ltvR)}</b></div>
              <div>Over: <b style={{ color: "#ffffff" }}>{eng.ltvMonths.toFixed(0)} months</b></div>
              <div style={{ borderTop: "1.5px solid rgba(255,255,255,0.1)", marginTop: 8, paddingTop: 8 }}>
                Max pay today: <b style={{ color: "#ffbe50" }}>{fmtFull(eng.beCpa1)}</b>
              </div>
              <div>Max pay long-term: <b style={{ color: "#78dca0" }}>{fmtFull(eng.beCpaLtv)}</b></div>
            </div>
          </div>
        </div>

        {/* RIGHT — OUTPUT */}
        <div style={{ padding: "20px 26px", overflowY: "auto", maxHeight: "calc(100vh - 86px)" }}>
          {/* Key Numbers */}
          <h2 style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>Your Key Numbers</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
            <MC label="Max Pay Today" value={fmt(eng.beCpa1)} help="Most you can pay per new customer and still profit this month" color="#ffbe50" />
            <MC label="Max Pay Long-Term" value={fmt(eng.beCpaLtv)} help={`Most you can pay if they keep buying for ${eng.ltvMonths.toFixed(0)} months`} color="#78dca0" />
            <MC label="Best Profit" value={fmtFull(pN)} help={`When you spend ${fmt(pk.spend)} with ${fmtX(pk.roas)} return`} color={pN > 0 ? "#78dca0" : "#ff9999"} />
            <MC label="Sales per Ad $" value={fmtX(pk.mer)} help={`${fmt(pk.totalRev)} in total sales`} color="#9ec4f5" />
            <MC label="Cost per New Customer" value={fmt(pk.ncCpa)} help={`You get about ${Math.round(pk.paidNewOrders)} new people a month`} color={pk.ncCpa <= eng.beCpaLtv ? "#78dca0" : "#ff9999"} />
            <MC label="Free Sales Profit" value={fmt(eng.oContrib)} help={`From ${fmt(eng.oR)}/mo without ads`} color="#ffffff" />
          </div>

          <Ins engine={eng} I={I} roasVals={rV} spendVals={sV} />

          {/* View Toggles */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#b8bcd0", marginBottom: 8 }}>Pick what to see:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["all", "Show All"], ["acq", "Customer Costs"], ["contrib", "Money Made"], ["net", "Real Profit"], ["ltv", "Long-Term"]].map(([k, l]) =>
                <Pill key={k} a={view === k} onClick={() => setView(k)}>{l}</Pill>
              )}
            </div>
          </div>

          {(view === "all" || view === "acq") && <AcqT engine={eng} roasVals={rV} spendVals={sV} />}

          {(view === "all" || view === "contrib") && (
            <HT title="Money Made Before Bills"
              sub="Sales minus product and ad costs — before rent and staff"
              help="This is what's left after you pay for products, shipping, and ads. You still need to pay fixed bills from this."
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.totalContrib} cellFn={c => fmt(c.totalContrib)} maxMark />
          )}

          {(view === "all" || view === "net") && (
            <HT title="Real Profit in Your Pocket"
              sub={`After paying ${fmtFull(I.monthlyFixedCosts)} in monthly bills`}
              help="This is your actual take-home profit each month. Green cells make money. Red cells lose money."
              data={eng.grid} roasVals={rV} spendVals={sV}
              valFn={c => c.netProfit} cellFn={c => fmt(c.netProfit)} maxMark />
          )}

          {(view === "all" || view === "ltv") && <LtvT engine={eng} roasVals={rV} spendVals={sV} />}

          {/* How It Works */}
          <div style={{ marginTop: 20, padding: "18px 22px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1.5px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#ffffff", marginBottom: 12 }}>📖 How to Read This</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#e8eaf2" }}>
              <p style={{ margin: "0 0 10px" }}><b style={{ color: "#78dca0" }}>Ad Spend</b> is how much money you put into ads each month (rows going down).</p>
              <p style={{ margin: "0 0 10px" }}><b style={{ color: "#78dca0" }}>Ad Return</b> is how many dollars in sales you get for each dollar spent (columns going right). A 3x return means $3 in sales for every $1 in ads.</p>
              <p style={{ margin: "0 0 10px" }}><b style={{ color: "#78dca0" }}>Green cells</b> mean you make money. <b style={{ color: "#ff9999" }}>Red cells</b> mean you lose money.</p>
              <p style={{ margin: "0 0 10px" }}>The <b style={{ color: "#ffbe50" }}>★ Best</b> star shows the spot where you make the most profit.</p>
              <p style={{ margin: "0" }}>Change the numbers on the left to match your real store. The tables update right away.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use strict";
function AnalysisPage({ t, t0, sector = "Healthcare", geo = "India", pinFired = false, pinPulse = 0 }) {
  const headerIn = seg(t, t0 + 0.05, t0 + 0.6);
  const bannerIn = seg(t, t0 + 0.4, t0 + 1.1);
  const statsIn = [
    seg(t, t0 + 0.9, t0 + 1.4),
    seg(t, t0 + 1.05, t0 + 1.55),
    seg(t, t0 + 1.2, t0 + 1.7),
    seg(t, t0 + 1.35, t0 + 1.85)
  ];
  const chartIn = seg(t, t0 + 1.8, t0 + 2.7);
  const benchIn = seg(t, t0 + 2.6, t0 + 3.2);
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, background: "var(--bg-card)", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: {
    height: 64,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 36px",
    borderBottom: "1px solid rgba(60,44,14,0.06)",
    flexShrink: 0
  } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontWeight: 400, fontSize: 22, color: "var(--ink)" } }, "Premia", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--rust)", fontSize: "0.6em", verticalAlign: "super", marginLeft: 1 } }, "\xB7")), /* @__PURE__ */ React.createElement("div", { style: {
    padding: "8px 16px",
    background: pinFired ? "var(--green)" : "var(--bg-green)",
    color: pinFired ? "#2a1a0a" : "var(--green-deep)",
    borderRadius: 999,
    border: "1px solid rgba(108,138,31,0.35)",
    fontFamily: "var(--sans)",
    fontSize: 13,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 8,
    transform: `scale(${1 + pinPulse * 0.08})`,
    transition: "background 0.2s, color 0.2s, transform 0.2s"
  } }, pinFired ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("svg", { width: "12", height: "12", viewBox: "0 0 12 12", fill: "none" }, /* @__PURE__ */ React.createElement("path", { d: "M2 6 L5 9 L10 3", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" })), "Pinned") : "Pin to Pad")), /* @__PURE__ */ React.createElement("div", { style: { padding: "24px 50px 0 50px", flex: 1, overflow: "hidden", position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)", opacity: headerIn, transform: `translateY(${(1 - headerIn) * 8}px)` } }, "\u2190 Back to search"), /* @__PURE__ */ React.createElement("h1", { style: {
    fontFamily: "var(--serif)",
    fontWeight: 500,
    fontSize: 48,
    letterSpacing: "-0.01em",
    margin: "14px 0 4px 0",
    lineHeight: 1.05,
    opacity: headerIn,
    transform: `translateY(${(1 - headerIn) * 12}px)`
  } }, sector.toLowerCase(), " in ", geo.toLowerCase()), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--sans)", fontSize: 14, color: "var(--ink-mute)", opacity: headerIn } }, "Based on 29 items tracked \xB7 1 source \xB7 90 days"), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 18,
    background: "var(--bg-green)",
    border: "1px solid rgba(108,138,31,0.3)",
    borderRadius: 16,
    padding: "20px 24px",
    opacity: bannerIn,
    transform: `translateY(${(1 - bannerIn) * 14}px)`
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 9, height: 9, borderRadius: "50%", background: "var(--green)" } }), /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontFamily: "var(--serif)", fontWeight: 500, fontSize: 32, color: "var(--green-deep)", letterSpacing: "-0.01em" } }, "Early Signal")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, color: "var(--ink-2)", fontSize: 13.5, maxWidth: 640 } }, "Recent activity is outpacing media. The narrative hasn't formed yet \u2014 you're ahead of the page.")), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { padding: "6px 12px", background: "rgba(255,255,255,0.4)", border: "1px solid rgba(108,138,31,0.3)", borderRadius: 999, fontSize: 10, color: "var(--green-deep)" } }, "DENSE SIGNAL")), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 18,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    background: "rgba(255,255,255,0.35)",
    borderRadius: 10,
    border: "1px solid rgba(108,138,31,0.2)",
    overflow: "hidden"
  } }, /* @__PURE__ */ React.createElement(StatCell, { label: "DEALS \xB7 30D", value: "4", sub: "\u2191 68% vs prior", color: "var(--rust)", alpha: statsIn[0] }), /* @__PURE__ */ React.createElement(StatCell, { label: "DEALS \xB7 90D", value: "29", sub: "transactions tracked", alpha: statsIn[1] }), /* @__PURE__ */ React.createElement(StatCell, { label: "SOURCES", value: "1", sub: "unique outlets", alpha: statsIn[2] }), /* @__PURE__ */ React.createElement(StatCell, { label: "SIGNAL GAP", value: "+28", sub: "deals ahead of media", color: "var(--green)", alpha: statsIn[3] }))), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 16,
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 14,
    opacity: chartIn,
    transform: `translateY(${(1 - chartIn) * 14}px)`
  } }, /* @__PURE__ */ React.createElement(ActivityChart, { progress: chartIn }), /* @__PURE__ */ React.createElement(CoverageCard, { progress: chartIn })), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 14,
    opacity: benchIn,
    transform: `translateY(${(1 - benchIn) * 12}px)`,
    background: "var(--bg-inset)",
    borderRadius: 14,
    border: "1px solid var(--line-soft)",
    padding: "14px 18px",
    display: "grid",
    gridTemplateColumns: "auto repeat(4, 1fr)",
    gap: 18,
    alignItems: "center"
  } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5 } }, "MARKET CONTEXT"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 18, fontWeight: 500, marginTop: 2 } }, "Sector benchmarks")), /* @__PURE__ */ React.createElement(MiniMetric, { label: "MARKET SIZE", value: "$3.6bn", sub: "2025" }), /* @__PURE__ */ React.createElement(MiniMetric, { label: "CAGR", value: "20.9%", sub: "" }), /* @__PURE__ */ React.createElement(MiniMetric, { label: "EV / REV", value: "28.0\xD7", sub: "peers" }), /* @__PURE__ */ React.createElement(MiniMetric, { label: "EV / EBITDA", value: "31.0\xD7", sub: "peers" }))));
}
function StatCell({ label, value, sub, color = "var(--ink)", alpha = 1 }) {
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 16px", borderRight: "1px solid rgba(108,138,31,0.18)", opacity: alpha, transform: `translateY(${(1 - alpha) * 8}px)` } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5 } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 32, fontWeight: 500, marginTop: 2, color } }, value), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-mute)" } }, sub));
}
function MiniMetric({ label, value, sub }) {
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5 } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 22, fontWeight: 500, lineHeight: 1.1 } }, value), sub && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-mute)" } }, sub));
}
function ActivityChart({ progress }) {
  const points = [3, 3, 5, 4, 1, 5, 8, 9, 9, 11, 14, 1];
  const W = 480, H = 200;
  const pad = { l: 26, r: 14, t: 18, b: 30 };
  const ymax = 15;
  const xs = points.map((_, i) => pad.l + i / (points.length - 1) * (W - pad.l - pad.r));
  const ys = points.map((v) => pad.t + (1 - v / ymax) * (H - pad.t - pad.b));
  const cmds = [];
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) cmds.push(`M ${xs[i]} ${ys[i]}`);
    else {
      const cx = (xs[i - 1] + xs[i]) / 2;
      cmds.push(`Q ${cx} ${ys[i - 1]} ${cx} ${(ys[i - 1] + ys[i]) / 2}`);
      cmds.push(`Q ${cx} ${ys[i]} ${xs[i]} ${ys[i]}`);
    }
  }
  const path = cmds.join(" ");
  return /* @__PURE__ */ React.createElement("div", { className: "card", style: { padding: "14px 18px", background: "var(--bg-soft)" } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5 } }, "NEWS & DEAL ACTIVITY"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 20, fontWeight: 500, marginTop: 2 } }, "Past 12 Months"), /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, style: { width: "100%", height: 200, marginTop: 4 } }, [0, 4, 8, 11, 15].map((y) => {
    const yp = pad.t + (1 - y / ymax) * (H - pad.t - pad.b);
    return /* @__PURE__ */ React.createElement("g", { key: y }, /* @__PURE__ */ React.createElement("line", { x1: pad.l, x2: W - pad.r, y1: yp, y2: yp, stroke: "rgba(120,96,50,0.18)", strokeDasharray: "2 4" }), /* @__PURE__ */ React.createElement("text", { x: pad.l - 6, y: yp + 3, textAnchor: "end", fontFamily: "JetBrains Mono", fontSize: "9", fill: "var(--ink-faint)" }, y));
  }), /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("linearGradient", { id: "areaGrad", x1: "0", x2: "0", y1: "0", y2: "1" }, /* @__PURE__ */ React.createElement("stop", { offset: "0%", stopColor: "#E8892A", stopOpacity: "0.22" }), /* @__PURE__ */ React.createElement("stop", { offset: "100%", stopColor: "#E8892A", stopOpacity: "0" })), /* @__PURE__ */ React.createElement("clipPath", { id: "chartClip" }, /* @__PURE__ */ React.createElement("rect", { x: pad.l, y: 0, width: (W - pad.l - pad.r) * progress, height: H }))), /* @__PURE__ */ React.createElement("g", { clipPath: "url(#chartClip)" }, /* @__PURE__ */ React.createElement("path", { d: `${path} L ${xs[xs.length - 1]} ${H - pad.b} L ${xs[0]} ${H - pad.b} Z`, fill: "url(#areaGrad)" }), /* @__PURE__ */ React.createElement("path", { d: path, fill: "none", stroke: "var(--rust)", strokeWidth: "2", strokeLinejoin: "round", strokeLinecap: "round" }), xs.map((x, i) => /* @__PURE__ */ React.createElement("circle", { key: i, cx: x, cy: ys[i], r: "2.6", fill: "#fff", stroke: "var(--rust)", strokeWidth: "1.4" }))), ["Jun", "Aug", "Oct", "Dec", "Feb", "Apr", "May"].map((m, i) => {
    const idx = [0, 2, 4, 6, 8, 10, 11][i];
    return /* @__PURE__ */ React.createElement("text", { key: m, x: xs[idx], y: H - 10, textAnchor: "middle", fontFamily: "Inter", fontSize: "10", fill: "var(--ink-mute)" }, m);
  })));
}
function CoverageCard({ progress }) {
  const bars = [
    { label: "Data volume", value: 88, color: "#6FA01F" },
    { label: "Recency", value: 52, color: "#B68A2E" },
    { label: "Source breadth", value: 44, color: "#B68A2E" },
    { label: "Signal clarity", value: 10, color: "#E8892A" }
  ];
  return /* @__PURE__ */ React.createElement("div", { className: "card", style: { padding: "14px 16px", background: "var(--bg-soft)" } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5 } }, "SIGNAL COVERAGE"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 18, fontWeight: 500, color: "var(--green)", marginTop: 2 } }, "Dense signal"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 } }, "Broad dataset \u2014 well-documented theme."), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, display: "grid", gap: 8 } }, bars.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.label, style: { display: "grid", gridTemplateColumns: "1fr 60px 30px", alignItems: "center", gap: 6, fontSize: 11 } }, /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-2)" } }, b.label), /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: "rgba(120,96,50,0.15)", borderRadius: 4, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: `${b.value * Math.min(1, progress * 1.2)}%`, background: b.color, borderRadius: 4, transition: "width 0.6s ease-out" } })), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 9.5, color: b.color, textAlign: "right" } }, b.value, "%")))));
}
Object.assign(window, { AnalysisPage });

"use strict";
function PremiaTopBar() {
  return /* @__PURE__ */ React.createElement("div", { style: {
    position: "sticky",
    top: 0,
    left: 0,
    right: 0,
    height: 64,
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    padding: "0 32px",
    background: "#FAF8F3",
    zIndex: 5
  } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontWeight: 400, fontSize: 24, color: "var(--ink)" } }, "Premia", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--rust)", fontSize: "0.65em", verticalAlign: "super", marginLeft: 1 } }, "\xB7")), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 12, color: "var(--ink-mute)", textAlign: "center", letterSpacing: "0.18em" } }, "21 MAY"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement("span", { style: {
    padding: "8px 16px",
    borderRadius: 999,
    border: "1px solid var(--line)",
    fontFamily: "var(--sans)",
    fontSize: 13.5,
    color: "var(--ink)",
    background: "#FAF8F3"
  } }, "Sign in"), /* @__PURE__ */ React.createElement("span", { style: {
    padding: "8px 16px",
    borderRadius: 999,
    background: "var(--green)",
    fontFamily: "var(--sans)",
    fontSize: 13.5,
    fontWeight: 500,
    color: "var(--ink)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6
  } }, "News Brief of the Day! ", /* @__PURE__ */ React.createElement("span", null, "\u2192"))));
}
function Pushpin({ color, x, y }) {
  return /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: x,
    top: y,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: `radial-gradient(circle at 30% 30%, ${color === "red" ? "#E04A28" : "#D6A938"}, ${color === "red" ? "#8E2A0B" : "#8B6618"})`,
    boxShadow: "0 2px 3px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.1) inset, inset -1px -1px 2px rgba(0,0,0,0.3)",
    transform: "translate(-50%, -50%)",
    zIndex: 4
  } });
}
function SearchHero({ typedSector, typedGeo, sectorActive, geoActive, showCaretSector, showCaretGeo, pinnedSector, pinnedGeo }) {
  const sectorText = typedSector || "";
  const geoText = typedGeo || "";
  const analyseReady = sectorText.length > 0 && geoText.length > 0;
  const sectors = ["Climate Infrastructure", "Healthcare IT", "Fintech", "B2B SaaS", "Wealthtech", "Logistics", "Defence & Aerospace"];
  const geographies = ["India", "United States", "Southeast Asia", "United Kingdom", "Middle East", "Germany", "Brazil", "Japan", "Africa"];
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 28px 0 28px" } }, /* @__PURE__ */ React.createElement("div", { style: {
    position: "relative",
    background: "var(--bg-card)",
    borderRadius: 18,
    border: "1px solid var(--line)",
    padding: "34px 40px 28px 40px",
    boxShadow: "0 1px 0 rgba(255,255,255,0.6) inset, 0 1px 3px rgba(60,44,14,0.04)"
  } }, /* @__PURE__ */ React.createElement(Pushpin, { color: "red", x: 26, y: 26 }), /* @__PURE__ */ React.createElement(Pushpin, { color: "gold", x: "calc(100% - 26px)", y: 26 }), /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    top: 24,
    right: 60,
    padding: "7px 14px",
    borderRadius: 999,
    background: "#FAF8F3",
    border: "1px solid var(--line)",
    fontFamily: "var(--sans)",
    fontSize: 12.5,
    color: "var(--ink-2)",
    display: "flex",
    alignItems: "center",
    gap: 6
  } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 16 16", fill: "none" }, /* @__PURE__ */ React.createElement("path", { d: "M2 5h9l-2-2M14 11H5l2 2", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" })), "reshuffle"), /* @__PURE__ */ React.createElement("h1", { style: {
    fontFamily: "var(--serif)",
    fontWeight: 400,
    fontSize: 46,
    lineHeight: 1.1,
    letterSpacing: "-0.005em",
    margin: "0 220px 0 0",
    color: "var(--ink)"
  } }, "Is", " ", /* @__PURE__ */ React.createElement("span", { style: { fontStyle: "italic", color: "var(--green-deep)", borderBottom: "2px solid var(--green-deep)", paddingBottom: 1 } }, pinnedSector), " ", "in", " ", /* @__PURE__ */ React.createElement("span", { style: { fontStyle: "italic", color: "var(--rust)", borderBottom: "2px solid var(--rust)", paddingBottom: 1 } }, pinnedGeo), " ", "overcrowded or still early?"), /* @__PURE__ */ React.createElement("p", { style: { margin: "10px 0 24px 0", fontFamily: "var(--sans)", fontSize: 15, color: "var(--ink-mute)" } }, "Type a sector and country. Get an analysis in seconds."), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr auto 1fr auto", alignItems: "stretch", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: {
    background: "#FAF8F3",
    border: `1.5px solid ${sectorActive ? "var(--green-deep)" : "var(--line)"}`,
    borderRadius: 10,
    padding: "12px 18px",
    transition: "border-color 0.25s"
  } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10, color: "var(--ink-mute)" } }, "SECTOR"), /* @__PURE__ */ React.createElement("div", { style: {
    fontStyle: sectorText ? "normal" : "italic",
    fontSize: 20,
    color: sectorText ? "var(--ink)" : "var(--ink-faint)",
    marginTop: 4,
    minHeight: 28,
    lineHeight: 1.1,
    fontFamily: "var(--serif)"
  } }, sectorText || "type or pick\u2026", sectorActive && showCaretSector && /* @__PURE__ */ React.createElement("span", { className: "caret", style: { background: "var(--ink)" } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", fontStyle: "italic", color: "var(--ink-mute)", fontSize: 22, fontFamily: "var(--serif)" } }, "in"), /* @__PURE__ */ React.createElement("div", { style: {
    background: "#FAF8F3",
    border: `1.5px solid ${geoActive ? "var(--rust)" : "var(--line)"}`,
    borderRadius: 10,
    padding: "12px 18px",
    transition: "border-color 0.25s"
  } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10, color: "var(--ink-mute)" } }, "GEOGRAPHY"), /* @__PURE__ */ React.createElement("div", { style: {
    fontStyle: geoText ? "normal" : "italic",
    fontSize: 20,
    color: geoText ? "var(--ink)" : "var(--ink-faint)",
    marginTop: 4,
    minHeight: 28,
    lineHeight: 1.1,
    fontFamily: "var(--serif)"
  } }, geoText || "type or pick\u2026", geoActive && showCaretGeo && /* @__PURE__ */ React.createElement("span", { className: "caret", style: { background: "var(--ink)" } }))), /* @__PURE__ */ React.createElement("button", { style: {
    alignSelf: "stretch",
    border: "1px solid " + (analyseReady ? "var(--green-deep)" : "var(--line)"),
    padding: "0 22px",
    background: analyseReady ? "var(--green)" : "var(--bg-card)",
    color: analyseReady ? "var(--ink)" : "var(--ink-faint)",
    borderRadius: 10,
    fontFamily: "var(--sans)",
    fontSize: 14,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 8,
    transition: "all 0.25s"
  } }, "Analyse ", /* @__PURE__ */ React.createElement("span", null, "\u2192"))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { marginBottom: 10, fontSize: 10 } }, "SECTORS"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } }, sectors.map((s) => /* @__PURE__ */ React.createElement(DotPill, { key: s, label: s, dotColor: "var(--rust)", active: s === "Healthcare IT" && pinnedSector === "Healthcare" })))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { marginBottom: 10, fontSize: 10 } }, "GEOGRAPHIES"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } }, geographies.map((g) => /* @__PURE__ */ React.createElement(DotPill, { key: g, label: g, dotColor: "var(--green-deep)", active: g === pinnedGeo }))))), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 20,
    background: "#FAF8F3",
    border: "1px solid var(--line)",
    borderRadius: 12,
    padding: "14px 18px"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 11px",
    borderRadius: 999,
    background: "var(--bg-card)",
    border: "1px solid var(--line)",
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "var(--ink-mute)",
    marginBottom: 8
  } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "var(--green-deep)" } }), "\u2014 PICK ONE OF EACH \u2014"), /* @__PURE__ */ React.createElement("div", { style: { fontStyle: "italic", fontSize: 18, color: "var(--ink-faint)", fontFamily: "var(--serif)" } }, "Your verdict appears here once both are selected."))));
}
function DotPill({ label, dotColor, active }) {
  return /* @__PURE__ */ React.createElement("span", { style: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 12px",
    borderRadius: 999,
    background: active ? "rgba(163, 230, 53, 0.18)" : "#FAF8F3",
    border: `1px solid ${active ? "var(--green-deep)" : "var(--line)"}`,
    fontFamily: "var(--sans)",
    fontSize: 12.5,
    color: "var(--ink)"
  } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: dotColor } }), label);
}
function CornerPin({ position }) {
  const pad = 18;
  const pos = { tl: { left: pad, top: pad }, tr: { right: pad, top: pad }, bl: { left: pad, bottom: pad }, br: { right: pad, bottom: pad } }[position];
  return /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    ...pos,
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "radial-gradient(circle at 30% 30%, #E8C45A, #8B6618 70%, #5A4310)",
    boxShadow: "0 2px 3px rgba(0,0,0,0.6), inset -1px -1px 2px rgba(0,0,0,0.5)",
    zIndex: 3
  } });
}
function StickyNote({ x, y, sector, geo, stats, scale = 1, alpha = 1, isPinning, isDragging }) {
  return /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: x,
    top: y,
    width: 240,
    transform: `scale(${scale}) rotate(${isPinning ? -2.5 : isDragging ? 2 : -1.5}deg)`,
    transformOrigin: "top left",
    opacity: alpha,
    transition: isDragging ? "transform 0.08s" : "transform 0.3s"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    top: -8,
    left: 30,
    width: 90,
    height: 22,
    background: "var(--note-tape)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
    transform: "rotate(-3deg)"
  } }), /* @__PURE__ */ React.createElement("div", { style: {
    position: "relative",
    background: "var(--note-bg)",
    padding: "14px 16px",
    boxShadow: isDragging ? "0 18px 32px -8px rgba(0,0,0,0.5)" : "0 6px 16px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.6) inset"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10, letterSpacing: "0.12em", color: "var(--green-text)" } }, "EARLY SIGNAL"), /* @__PURE__ */ React.createElement("div", { style: { color: "var(--ink-mute)", fontSize: 14, lineHeight: 1 } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 18, fontWeight: 400, lineHeight: 1.2, color: "var(--ink)" } }, sector, " in ", geo), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-mute)", letterSpacing: "0.04em" } }, stats)));
}
function IdeasPad({ pinnedCard, draggedOffset }) {
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "36px 28px 30px 28px", position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 18,
    marginBottom: 18,
    padding: "0 14px"
  } }, /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "var(--line)" } }), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 11, letterSpacing: "0.22em", color: "var(--ink-mute)" } }, "YOUR IDEAS PAD"), /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "var(--line)" } })), /* @__PURE__ */ React.createElement("div", { style: {
    position: "relative",
    height: 320,
    background: "radial-gradient(circle at 10% 20%, rgba(255,255,255,0.04) 0%, transparent 50%), var(--cork)",
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 8px rgba(0,0,0,0.2)"
  } }, /* @__PURE__ */ React.createElement("svg", { width: "100%", height: "100%", style: { position: "absolute", inset: 0, opacity: 0.4 } }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("pattern", { id: "cork-tex", width: "6", height: "6", patternUnits: "userSpaceOnUse" }, /* @__PURE__ */ React.createElement("circle", { cx: "1", cy: "1", r: "0.6", fill: "rgba(255,210,150,0.18)" }), /* @__PURE__ */ React.createElement("circle", { cx: "4", cy: "3", r: "0.4", fill: "rgba(0,0,0,0.25)" }), /* @__PURE__ */ React.createElement("circle", { cx: "2", cy: "5", r: "0.5", fill: "rgba(255,210,150,0.12)" }))), /* @__PURE__ */ React.createElement("rect", { width: "100%", height: "100%", fill: "url(#cork-tex)" })), /* @__PURE__ */ React.createElement(CornerPin, { position: "tl" }), /* @__PURE__ */ React.createElement(CornerPin, { position: "tr" }), /* @__PURE__ */ React.createElement(CornerPin, { position: "bl" }), /* @__PURE__ */ React.createElement(CornerPin, { position: "br" }), /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    top: 18,
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: "var(--mono)",
    fontSize: 11.5,
    letterSpacing: "0.18em",
    color: "rgba(255, 245, 220, 0.65)"
  } }, "IDEAS PAD \xB7 drag freely"), pinnedCard > 0 && /* @__PURE__ */ React.createElement(
    StickyNote,
    {
      x: 56 + draggedOffset.x,
      y: 62 + draggedOffset.y,
      sector: "Healthcare",
      geo: "India",
      stats: "4d/30 \xB7 29d/90 \xB7 1mo",
      scale: lerp(0.7, 1, Math.min(1, pinnedCard * 1.4)),
      alpha: Math.min(1, pinnedCard * 2),
      isPinning: pinnedCard < 0.4,
      isDragging: draggedOffset.x !== 0 || draggedOffset.y !== 0
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)" } }, "Pinned theses live here. Drag them around, group them, or pluck them off."));
}
function WhatsMoving({ scrollOffset = 0, highlightIdx = -1 }) {
  const cards = [
    { rank: 1, sector: "Climate Infrastructure", deals: 20, delta: -13, velocity: 0.62 },
    { rank: 2, sector: "Healthcare IT", deals: 12, delta: -40, velocity: 0.34 },
    { rank: 3, sector: "B2B SaaS", deals: 12, delta: -14, velocity: 0.42 },
    { rank: 4, sector: "Fintech", deals: 18, delta: 8, velocity: 0.72 },
    { rank: 5, sector: "Wealthtech", deals: 9, delta: -5, velocity: 0.3 },
    { rank: 6, sector: "Defence & Aerospace", deals: 11, delta: 14, velocity: 0.55 }
  ];
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 28px 40px 28px" } }, /* @__PURE__ */ React.createElement("h2", { style: { fontFamily: "var(--serif)", fontWeight: 400, fontSize: 32, margin: "0 0 4px 0", letterSpacing: "-0.005em", color: "var(--ink)" } }, "What's moving right now"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: "var(--ink-mute)", marginBottom: 18, fontFamily: "var(--sans)" } }, "Live deal flow across tracked sectors."), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", overflow: "hidden", borderRadius: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: "16px", transform: `translateX(${-scrollOffset}px)`, transition: "transform 0s linear", willChange: "transform" } }, cards.map((c, i) => /* @__PURE__ */ React.createElement(MovingCard, { key: i, card: c, width: 360, highlight: highlightIdx === i })))));
}
function MovingCard({ card, width, highlight }) {
  const ticks = 11;
  const markerIdx = Math.round(card.velocity * (ticks - 1));
  const pos = card.delta > 0;
  return /* @__PURE__ */ React.createElement("div", { style: {
    width,
    flex: "0 0 auto",
    background: "var(--bg-card)",
    borderRadius: 14,
    padding: "20px 22px 18px 22px",
    position: "relative",
    border: `1px solid ${highlight ? "rgba(163,230,53,0.5)" : "transparent"}`,
    boxShadow: highlight ? "0 0 0 3px rgba(163, 230, 53, 0.15)" : "none"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    top: 14,
    left: "50%",
    width: 11,
    height: 11,
    borderRadius: "50%",
    background: "radial-gradient(circle at 30% 30%, #E04A28, #8E2A0B 70%)",
    boxShadow: "0 2px 3px rgba(0,0,0,0.35)",
    transform: "translateX(-50%)"
  } }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("span", { style: { padding: "4px 12px", borderRadius: 999, background: "rgba(60,47,47,0.08)", fontFamily: "var(--sans)", fontSize: 12 } }, "#", card.rank), /* @__PURE__ */ React.createElement("span", { style: { padding: "4px 11px", borderRadius: 999, background: pos ? "rgba(163,230,53,0.18)" : "rgba(184,58,28,0.10)", color: pos ? "var(--green-deep)" : "var(--rust)", fontFamily: "var(--sans)", fontSize: 12, fontWeight: 500 } }, pos ? "+" : "", card.delta, "%")), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--serif)", fontSize: 24, fontWeight: 400, color: "var(--ink)", lineHeight: 1.15, marginBottom: 8 } }, card.sector), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--serif)", fontSize: 48, fontWeight: 400, color: "var(--rust)", lineHeight: 1 } }, card.deals), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)" } }, "deals\xB730d")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 22, position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "var(--line)" } }), Array.from({ length: ticks }).map((_, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { position: "relative", width: 1, height: i === markerIdx ? 22 : 8, background: i === markerIdx ? pos ? "var(--green-deep)" : "var(--momentum)" : "var(--line)" } }))), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10, color: "var(--ink-mute)" } }, "velocity")));
}
Object.assign(window, { PremiaTopBar, SearchHero, IdeasPad, WhatsMoving });

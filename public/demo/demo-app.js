"use strict";
const DURATION = 23;
const STAGE_W = 1280;
const STAGE_H = 960;
function homeScrollAt(t) {
  const kfs = [[0, 0], [11.8, 0], [12.8, 540], [16, 540], [16.8, 980], [22.2, 980], [23, 980]];
  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0] = kfs[i], [t1, v1] = kfs[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, Easing.inOutCubic((t - t0) / (t1 - t0 || 1)));
  }
  return 0;
}
function carouselScrollAt(t) {
  const kfs = [[0, 0], [17, 0], [17.6, 0], [18.5, 376], [19, 376], [19.7, 752], [20.3, 752], [21, 1128], [22, 1128], [23, 1128]];
  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0] = kfs[i], [t1, v1] = kfs[i + 1];
    if (t >= t0 && t <= t1) return lerp(v0, v1, Easing.inOutCubic((t - t0) / (t1 - t0 || 1)));
  }
  return 0;
}
function dragOffsetAt(t) {
  const kfs = [[0, { x: 0, y: 0 }], [14, { x: 0, y: 0 }], [14.8, { x: 220, y: 40 }], [15.4, { x: 380, y: -8 }], [15.9, { x: 340, y: 70 }], [16.2, { x: 340, y: 70 }], [23, { x: 340, y: 70 }]];
  for (let i = 0; i < kfs.length - 1; i++) {
    const [t0, v0] = kfs[i], [t1, v1] = kfs[i + 1];
    if (t >= t0 && t <= t1) {
      const e = Easing.inOutCubic((t - t0) / (t1 - t0 || 1));
      return { x: lerp(v0.x, v1.x, e), y: lerp(v0.y, v1.y, e) };
    }
  }
  return { x: 0, y: 0 };
}
function pinnedCardProgressAt(t) {
  if (t < 12.6) return 0;
  return Math.min(1, (t - 12.6) / 0.55);
}
function makeCursorKeyframes() {
  return [
    { t: 0, x: 1300, y: 980, hide: true },
    { t: 0.6, x: 1300, y: 980, hide: false },
    { t: 1.2, x: 270, y: 332, easing: Easing.inOutCubic },
    { t: 1.35, x: 270, y: 332, click: true },
    { t: 2.9, x: 280, y: 332 },
    { t: 3.5, x: 700, y: 332 },
    { t: 3.62, x: 700, y: 332, click: true },
    { t: 4.8, x: 720, y: 332 },
    { t: 5.3, x: 1130, y: 332, easing: Easing.inOutCubic },
    { t: 5.45, x: 1130, y: 332, click: true },
    { t: 5.8, x: 1130, y: 332, hide: true },
    { t: 6.5, x: 100, y: 1e3, hide: true },
    { t: 6.7, x: 100, y: 1e3, hide: false },
    { t: 7.8, x: 640, y: 540 },
    { t: 9.5, x: 700, y: 480 },
    { t: 10.8, x: 1150, y: 36, easing: Easing.inOutCubic },
    { t: 10.95, x: 1150, y: 36, click: true },
    { t: 11.4, x: 1150, y: 36 },
    { t: 11.8, x: 1150, y: 36, hide: true },
    { t: 12.7, x: 1150, y: 36, hide: true },
    { t: 12.75, x: 220, y: 380, hide: false },
    { t: 14, x: 220, y: 380 },
    { t: 14.1, x: 220, y: 380, click: true },
    { t: 14.8, x: 440, y: 420 },
    { t: 15.4, x: 600, y: 372 },
    { t: 15.9, x: 560, y: 450 },
    { t: 16.15, x: 560, y: 450, click: true },
    { t: 16.8, x: 560, y: 540, easing: Easing.inOutCubic },
    { t: 17.4, x: 800, y: 540 },
    { t: 22, x: 800, y: 540 },
    { t: 22.6, x: 800, y: 540, hide: true },
    { t: 23, x: 1300, y: 980, hide: true }
  ];
}
function composeFrame(t) {
  let homeTranslate = 0, analysisTranslate = STAGE_W;
  const fwd = seg(t, 5.6, 6.15, Easing.inOutCubic);
  const back = seg(t, 11.55, 12.1, Easing.inOutCubic);
  if (t < 5.6) {
    homeTranslate = 0;
    analysisTranslate = STAGE_W;
  } else if (t < 6.15) {
    homeTranslate = -fwd * STAGE_W * 0.15;
    analysisTranslate = (1 - fwd) * STAGE_W;
  } else if (t < 11.55) {
    homeTranslate = -STAGE_W * 0.15;
    analysisTranslate = 0;
  } else if (t < 12.1) {
    homeTranslate = -STAGE_W * 0.15 * (1 - back);
    analysisTranslate = back * STAGE_W;
  } else {
    homeTranslate = 0;
    analysisTranslate = STAGE_W;
  }
  const typedSector = typed(t, 1.4, 2.7, "Healthcare");
  const typedGeo = typed(t, 3.7, 4.6, "India");
  const sectorActive = t >= 1.35 && t < 3.5;
  const geoActive = t >= 3.62 && t < 5.3;
  const headlineSector = typedSector.length >= 3 ? typedSector : "Healthcare";
  const headlineGeo = typedGeo.length >= 2 ? typedGeo : "India";
  const onAnalysis = t >= 5.85 && t < 11.85;
  const pinFired = t >= 10.95 && t < 11.85;
  const pinPulse = seg(t, 10.95, 11.25, Easing.outQuart) * (1 - seg(t, 11.1, 11.45, Easing.outQuart));
  const homeScroll = homeScrollAt(t);
  const wmScroll = carouselScrollAt(t);
  const pinnedProgress = pinnedCardProgressAt(t);
  const dragOff = dragOffsetAt(t);
  let highlightIdx = -1;
  if (t >= 17.4 && t < 18.4) highlightIdx = 0;
  else if (t >= 18.4 && t < 19.5) highlightIdx = 1;
  else if (t >= 19.5 && t < 20.4) highlightIdx = 2;
  else if (t >= 20.4 && t < 21.2) highlightIdx = 3;
  else if (t >= 21.2 && t < 22) highlightIdx = 4;
  const loopAlpha = t < 0.3 ? t / 0.3 : t > DURATION - 0.3 ? (DURATION - t) / 0.3 : 1;
  return {
    onAnalysis,
    homeTranslate,
    analysisTranslate,
    typedSector,
    typedGeo,
    sectorActive,
    geoActive,
    headlineSector,
    headlineGeo,
    pinFired,
    pinPulse,
    homeScroll,
    wmScroll,
    pinnedProgress,
    dragOff,
    highlightIdx,
    loopAlpha
  };
}
const SCENES = [
  { at: 0, label: "01 \xB7 Type a sector \xD7 geography" },
  { at: 5.6, label: "02 \xB7 Premia analyses" },
  { at: 10.9, label: "03 \xB7 Pin to Ideas Pad" },
  { at: 14, label: "04 \xB7 Drag theses on the board" },
  { at: 16.8, label: "05 \xB7 What's moving right now" }
];
function currentSceneLabel(t) {
  let cur = SCENES[0].label;
  for (const s of SCENES) if (s.at <= t) cur = s.label;
  return cur;
}
function HomePage({ frame }) {
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, background: "#FAF8F3", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(PremiaTopBar, null), /* @__PURE__ */ React.createElement("div", { style: { transform: `translateY(${-frame.homeScroll}px)`, transition: "transform 0s linear", willChange: "transform" } }, /* @__PURE__ */ React.createElement(
    SearchHero,
    {
      typedSector: frame.typedSector,
      typedGeo: frame.typedGeo,
      sectorActive: frame.sectorActive,
      geoActive: frame.geoActive,
      showCaretSector: true,
      showCaretGeo: true,
      pinnedSector: frame.headlineSector,
      pinnedGeo: frame.headlineGeo
    }
  ), /* @__PURE__ */ React.createElement(IdeasPad, { pinnedCard: frame.pinnedProgress, draggedOffset: frame.dragOff }), /* @__PURE__ */ React.createElement(WhatsMoving, { scrollOffset: frame.wmScroll, highlightIdx: frame.highlightIdx })));
}
function PremiaDemoApp() {
  const TWEAKS_DEFAULTS = { speed: 1, showProgress: true };
  const [tweaks, setTweak] = useTweaks(TWEAKS_DEFAULTS);
  const { t, setPlaying, jumpTo, setSpeed } = useTimeline(DURATION, { speed: tweaks.speed });
  useEffect(() => {
    setSpeed(tweaks.speed);
  }, [tweaks.speed, setSpeed]);
  const frame = useMemo(() => composeFrame(t), [t]);
  const cursorKfs = useMemo(() => makeCursorKeyframes(), []);
  const stageRef = useRef(null);
  const innerRef = useRef(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = stageRef.current, inner = innerRef.current;
      if (!el || !inner) return;
      const s = Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H);
      inner.style.transform = `translate(${(el.clientWidth - STAGE_W * s) / 2}px, ${(el.clientHeight - STAGE_H * s) / 2}px) scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  return /* @__PURE__ */ React.createElement("div", { className: "stage-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "stage", ref: stageRef }, /* @__PURE__ */ React.createElement("div", { className: "stage-inner", ref: innerRef, style: { width: STAGE_W + "px", height: STAGE_H + "px" } }, /* @__PURE__ */ React.createElement("div", { className: "scene", style: {
    transform: `translateX(${frame.homeTranslate}px)`,
    opacity: frame.onAnalysis ? 0.4 : 1,
    filter: frame.onAnalysis ? "blur(2px)" : "none",
    transition: "opacity 0.3s, filter 0.3s"
  } }, /* @__PURE__ */ React.createElement(HomePage, { frame })), /* @__PURE__ */ React.createElement("div", { className: "scene", style: { transform: `translateX(${frame.analysisTranslate}px)` } }, /* @__PURE__ */ React.createElement(AnalysisPage, { t, t0: 5.95, sector: frame.headlineSector, geo: frame.headlineGeo, pinFired: frame.pinFired, pinPulse: frame.pinPulse })), /* @__PURE__ */ React.createElement(Cursor, { t, keyframes: cursorKfs }), frame.pinFired && /* @__PURE__ */ React.createElement("div", { className: "toast", style: {
    right: 36,
    top: 86,
    opacity: seg(t, 10.95, 11.25) * (1 - seg(t, 11.45, 11.75)),
    transform: `translateY(${(1 - seg(t, 10.95, 11.25)) * 10}px)`
  } }, "\u2713 Pinned to Ideas Pad"), tweaks.showProgress && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: 28,
    bottom: 18,
    zIndex: 200,
    fontFamily: "var(--mono)",
    fontSize: 10.5,
    letterSpacing: "0.14em",
    color: "var(--ink-mute)",
    textTransform: "uppercase",
    background: "rgba(255,255,255,0.6)",
    backdropFilter: "blur(6px)",
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid rgba(60,44,14,0.08)"
  } }, currentSceneLabel(t)), /* @__PURE__ */ React.createElement("div", { className: "progress" }, /* @__PURE__ */ React.createElement("div", { className: "progress-fill", style: { width: `${t / DURATION * 100}%` } }))), frame.loopAlpha < 1 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, background: "#FAF8F3", opacity: 1 - frame.loopAlpha, pointerEvents: "none", zIndex: 1e3 } }))), /* @__PURE__ */ React.createElement(TweaksPanel, { title: "Tweaks" }, /* @__PURE__ */ React.createElement(TweakSection, { label: "Playback" }, /* @__PURE__ */ React.createElement(TweakRadio, { label: "Speed", value: String(tweaks.speed), options: ["0.5", "1", "1.5", "2"], onChange: (v) => setTweak("speed", Number(v)) }), /* @__PURE__ */ React.createElement(TweakToggle, { label: "Show progress + scene label", value: tweaks.showProgress, onChange: (v) => setTweak("showProgress", v) }))));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(/* @__PURE__ */ React.createElement(PremiaDemoApp, null));

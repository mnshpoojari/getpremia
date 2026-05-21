// Premia Demo — utilities, hooks, cursor system
const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } = React;

const Easing = {
  linear: (t) => t,
  inOut: (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2,
  out: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutCubic: (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2,
};

function seg(t, t0, t1, easing = Easing.inOutCubic) {
  if (t <= t0) return 0;
  if (t >= t1) return 1;
  return easing((t - t0) / (t1 - t0));
}

const lerp = (a, b, t) => a + (b - a) * t;

function useTimeline(durationSec, opts = {}) {
  const { speed = 1, playing: initPlaying = true } = opts;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(initPlaying);
  const [spd, setSpd] = useState(speed);
  const accRef = useRef(0);
  const lastRef = useRef(performance.now());

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      accRef.current += dt * spd;
      setT(accRef.current % durationSec);
    }, 1000 / 60);
    return () => clearInterval(interval);
  }, [playing, durationSec, spd]);

  const jumpTo = useCallback((newT) => {
    accRef.current = newT;
    setT(newT);
  }, []);

  return { t, playing, setPlaying, jumpTo, speed: spd, setSpeed: setSpd };
}

function Cursor({ t, keyframes, scale = 1 }) {
  const ringRef = useRef(null);
  const lastClickIdx = useRef(-1);

  const state = useMemo(() => {
    const kf = keyframes;
    if (!kf || kf.length === 0) return { x: 0, y: 0, hide: true };
    let i = 0;
    for (let k = 0; k < kf.length; k++) {
      if (kf[k].t <= t) i = k;
      else break;
    }
    const a = kf[i];
    const b = kf[i + 1];
    if (!b) return { x: a.x, y: a.y, hide: a.hide };
    const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const e = (a.easing || Easing.inOutCubic)(u);
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), hide: a.hide || b.hide };
  }, [t, keyframes]);

  useEffect(() => {
    const kf = keyframes;
    for (let k = 0; k < kf.length; k++) {
      if (kf[k].click && t >= kf[k].t && t <= kf[k].t + 0.08 && lastClickIdx.current !== k) {
        lastClickIdx.current = k;
        const r = ringRef.current;
        if (r) {
          r.style.left = kf[k].x + 'px';
          r.style.top = kf[k].y + 'px';
          r.classList.remove('fire');
          void r.offsetWidth;
          r.classList.add('fire');
        }
        break;
      }
      if (t < 0.1) lastClickIdx.current = -1;
    }
  }, [t, keyframes]);

  return (
    <React.Fragment>
      <div className="click-ring" ref={ringRef} />
      <div className="cursor" style={{
        left: state.x + 'px', top: state.y + 'px',
        opacity: state.hide ? 0 : 1,
        transform: `translate(-2px, -2px) scale(${scale})`,
      }}>
        <svg viewBox="0 0 22 28" fill="none">
          <path d="M2 2 L2 22 L7 17 L10.5 25 L13 24 L9.5 16 L17 16 Z"
            fill="#2a2418" stroke="#f4ecd6" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      </div>
    </React.Fragment>
  );
}

function typed(t, t0, t1, full) {
  const p = seg(t, t0, t1, Easing.linear);
  return full.slice(0, Math.round(p * full.length));
}

function FlashAt({ t, when, x, y, color = '#6c8a1f' }) {
  const u = seg(t, when, when + 0.5, Easing.outQuart);
  if (u <= 0 || u >= 1) return null;
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      width: 36, height: 36, borderRadius: '50%',
      border: `2px solid ${color}`,
      transform: `translate(-50%, -50%) scale(${0.4 + u * 1.0})`,
      opacity: 1 - u,
      pointerEvents: 'none', zIndex: 99,
    }} />
  );
}

Object.assign(window, { useTimeline, Cursor, seg, lerp, Easing, typed, FlashAt });

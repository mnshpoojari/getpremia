'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import s from './landing.module.css'

// ── Demo panel (iframe embed) ─────────────────────────────────────────────────

function DemoPanel() {
  return (
    <div className={s.demoPanel} aria-label="Premia product demo">
      <div className={s.productChrome}>
        <div className={s.productDots}><span /><span /><span /></div>
      </div>
      <div className={s.gifSlot}>
        <iframe
          src="/demo/index.html"
          className={s.demoFrame}
          scrolling="no"
          title="Premia product demo"
          aria-label="Interactive product demo"
        />
      </div>
    </div>
  )
}

// ── Scroll-driven flow animation ──────────────────────────────────────────────

function FlowSection() {
  const flowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const steps = Array.from(flow.querySelectorAll<HTMLElement>('[data-flow-step]'))
    const N = steps.length
    let ticking = false

    function update() {
      ticking = false
      const rect = flow!.getBoundingClientRect()
      const vh = window.innerHeight
      const total = rect.height + vh
      const traveled = vh - rect.top
      let p = Math.max(0, Math.min(1, traveled / total))
      const c = (p - 0.5) * 2
      const isStacked = window.innerWidth <= 860

      steps.forEach((el, i) => {
        const idx = i - (N - 1) / 2
        const driftX = isStacked ? 0 : idx * c * 14
        const bobY   = Math.sin((p * Math.PI) + (i * 0.6)) * (isStacked ? 6 : 10)
        const rot    = isStacked ? 0 : idx * c * 0.4
        el.style.transform = `translate3d(${driftX.toFixed(2)}px, ${bobY.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`
      })
    }

    function onScroll() { if (!ticking) { requestAnimationFrame(update); ticking = true } }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])

  return (
    <div className={s.flowWrap}>
      <div className={s.flow} ref={flowRef}>
        {[
          { n: '/01 Ingest',   t: '41+ curated deal sources',     d: 'PE, VC, and M&A flow from registries, filings, and primary trackers.' },
          { n: '/02 Classify', t: 'Deal classification',           d: 'Each transaction tagged by thesis, stage, and underlying mechanism.' },
          { n: '/03 Read',     t: 'Media coverage index',          d: 'Coverage volume, sentiment, and authority scored across publications.' },
          { n: '/04 Score',    t: 'Consensus scoring',             d: 'The gap between capital and narrative, normalised by sector and cycle.' },
        ].map(step => (
          <div key={step.n} className={s.flowStep} data-flow-step="">
            <span className={s.stepN}>{step.n}</span>
            <div className={s.stepT}>{step.t}</div>
            <div className={s.stepD}>{step.d}</div>
          </div>
        ))}
        <div className={`${s.flowStep} ${s.flowTerminal}`} data-flow-step="">
          <span className={s.stepN}>/05 Output</span>
          <div className={s.stepT}>Thesis verdict</div>
          <span className={s.verdictMini}>Early signal</span>
        </div>
      </div>
      <div className={s.trustRow}>
        {['41+ deal data sources', 'Updated every 24 hours', 'Built for deal professionals'].map(t => (
          <span key={t} className={s.chip}><span className={s.chipDot} />{t}</span>
        ))}
      </div>
    </div>
  )
}

// ── Fade-up hook ──────────────────────────────────────────────────────────────

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { el.classList.add(s.fadeIn); return }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { el.classList.add(s.fadeIn); io.disconnect() }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

function Fade({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useFadeIn()
  return (
    <div ref={ref} className={s.fade} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  // Redirect signed-in users straight to the analysis app
  useEffect(() => {
    if (!loading && user) router.replace('/app')
  }, [user, loading, router])

  // Show nothing while auth state resolves (prevents flash of landing page)
  if (loading || user) return null

  return (
    <div className={s.landing}>

      {/* NAV */}
      <nav className={s.nav}>
        <div className={`${s.container} ${s.navInner}`}>
          <Link href="/" className={s.wordmark} aria-label="Premia home">
            Premia<span className={s.wordmarkDot}>·</span>
          </Link>
          <div className={s.navLinks}>
            <a href="#signal">Signal</a>
            <a href="#output">Output</a>
            <a href="#how">Architecture</a>
            <Link href="/auth" className={s.navSignIn}>Sign in</Link>
            <Link href="/auth?mode=signup" className={s.navCta}>Sign up free</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className={s.hero}>
        <div className={`${s.container} ${s.heroGrid}`}>
          <div>
            <Fade><div className={s.eyebrow}>Capital intelligence · Issue 24</div></Fade>
            <Fade delay={60}>
              <h1 className={s.h1} style={{ marginTop: 22 }}>
                Track where capital moves{' '}
                <span className={s.heroEm}>before</span>{' '}
                narratives catch up.
              </h1>
            </Fade>
            <Fade delay={140}>
              <p className={s.sub}>
                No Preqin. No Bloomberg. Still know if your thesis is early, on time, or late.
              </p>
            </Fade>
            <Fade delay={200}>
              <div className={s.heroCtaRow}>
                <Link href="/app" className={`${s.btn} ${s.btnAccent}`}>
                  Analyse a thesis <span className={s.arrow}>→</span>
                </Link>
                <Link href="/auth?mode=signup" className={`${s.btn} ${s.btnGhost}`}>
                  Sign up free
                </Link>
              </div>
            </Fade>
            <Fade delay={260}>
              <div className={s.heroMeta}>
                <span>41+ deal sources</span>
                <span className={s.sep} />
                <span>Refreshed every 24h</span>
                <span className={s.sep} />
                <span>Free to use</span>
              </div>
            </Fade>
          </div>

          <Fade delay={160}>
            <DemoPanel />
          </Fade>
        </div>
      </section>

      {/* THE SIGNAL GAP */}
      <section id="signal" className={s.section}>
        <div className={s.container}>
          <div className={s.sectionHead}>
            <Fade><div className={s.eyebrow}>02 · What makes it different</div></Fade>
            <Fade delay={60}>
              <h2 className={s.h2}>
                The gap between <em style={{ fontStyle: 'italic' }}>where money goes</em>
                <br />and what the market is talking about.
              </h2>
            </Fade>
            <Fade delay={120}>
              <p className={s.lede}>
                Most directional signals are locked behind $40k data subscriptions. Premia surfaces the same gap — from public deal flow and media coverage — for free.
              </p>
            </Fade>
          </div>

          <Fade>
            <div className={s.signalWrap}>
              <div className={s.signalGrid}>
                {[
                  {
                    n: '/01', t: 'Signal Gaps',
                    d: 'Identifies sectors where deal activity is outpacing media coverage. That gap is where early signal lives.',
                    svg: (
                      <svg width="100%" height="44" viewBox="0 0 220 44" fill="none">
                        <path d="M0 32 Q40 30 70 22 T140 12 T220 4" stroke="#3B2F2F" strokeWidth="1.5" fill="none"/>
                        <path d="M0 38 Q40 36 70 34 T140 30 T220 24" stroke="#A3E635" strokeWidth="2.5" fill="none"/>
                        <circle cx="180" cy="8" r="3.5" fill="#3B2F2F"/>
                        <circle cx="180" cy="27" r="3.5" fill="#A3E635"/>
                      </svg>
                    ),
                  },
                  {
                    n: '/02', t: 'Thematic Clustering',
                    d: 'Groups deal flow by emerging thesis — not just sector tags — to surface patterns before they\'re named.',
                    svg: (
                      <svg width="100%" height="44" viewBox="0 0 220 44" fill="none">
                        <circle cx="40" cy="22" r="8" fill="#DDD5C6"/>
                        <circle cx="56" cy="14" r="5" fill="#DDD5C6"/>
                        <circle cx="56" cy="32" r="6" fill="#DDD5C6"/>
                        <circle cx="120" cy="22" r="9" fill="#A3E635"/>
                        <circle cx="138" cy="14" r="6" fill="#A3E635" opacity=".7"/>
                        <circle cx="138" cy="32" r="5" fill="#A3E635" opacity=".5"/>
                        <line x1="48" y1="22" x2="112" y2="22" stroke="#3B2F2F" strokeWidth="1" strokeDasharray="2 3"/>
                        <circle cx="200" cy="22" r="6" fill="#DDD5C6"/>
                      </svg>
                    ),
                  },
                  {
                    n: '/03', t: 'Narrative Lag Detection',
                    d: 'Tells you whether market consensus is behind or ahead of the capital. Large firms publish reports 6–18 months after the signal was visible.',
                    svg: (
                      <svg width="100%" height="44" viewBox="0 0 220 44" fill="none">
                        <rect x="10" y="20" width="40" height="10" fill="#A3E635" rx="2"/>
                        <text x="10" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#7A6A62">CAPITAL</text>
                        <rect x="120" y="20" width="60" height="10" fill="#3B2F2F" rx="2"/>
                        <text x="120" y="14" fontFamily="JetBrains Mono" fontSize="8" fill="#7A6A62">CONSENSUS</text>
                        <line x1="50" y1="25" x2="120" y2="25" stroke="#7A6A62" strokeWidth="1" strokeDasharray="3 3"/>
                        <text x="68" y="40" fontFamily="JetBrains Mono" fontSize="8" fill="#E8892A">+ 14 MO LAG</text>
                      </svg>
                    ),
                  },
                ].map(col => (
                  <div key={col.n} className={s.signalCol}>
                    <span className={s.num}>{col.n}</span>
                    <h3 className={s.signalH3}>{col.t}</h3>
                    <p>{col.d}</p>
                    <div className={s.glyph} aria-hidden="true">{col.svg}</div>
                  </div>
                ))}
              </div>
            </div>
          </Fade>
        </div>
      </section>

      {/* VERDICT CARDS */}
      <section id="output" className={s.section} style={{ paddingTop: 32 }}>
        <div className={s.container}>
          <div className={s.sectionHead}>
            <Fade><div className={s.eyebrow}>03 · The output</div></Fade>
            <Fade delay={60}>
              <h2 className={s.h2}>
                Every thesis returns one of four reads.
              </h2>
            </Fade>
            <Fade delay={120}>
              <p className={s.lede}>
                Not a research report. A fast, structured signal — so you know whether to go deeper or move on.
              </p>
            </Fade>
          </div>

          <div className={s.verdicts}>
            {[
              {
                cls: s.vEarly, label: 'Early signal',
                h: 'Deal activity high, media coverage low.',
                p: 'Capital is positioning before the narrative is formed. The window where mispricing is most likely — and where late capital has not yet arrived.',
                deal: 82, cov: 18, delay: 0,
              },
              {
                cls: s.vConsensus, label: 'Consensus',
                h: 'Both deal activity and coverage are elevated.',
                p: 'The thesis is broadly understood. Entry is still rational, but pricing has adjusted — alpha shifts from selection to execution.',
                deal: 78, cov: 71, delay: 80,
              },
              {
                cls: s.vHype, label: 'Hype',
                h: 'Media coverage high, deal activity low.',
                p: 'The narrative is ahead of the capital. Often a sign of late-cycle storytelling — exposure here is reputational, not financial.',
                deal: 22, cov: 88, delay: 160,
              },
              {
                cls: s.vQuiet, label: 'Quiet',
                h: "Both signals low. Theme hasn't activated yet.",
                p: "Inert at present. Premia keeps the thesis under watch and flags it the moment either signal moves above threshold.",
                deal: 14, cov: 11, delay: 240,
              },
            ].map(v => (
              <Fade key={v.label} delay={v.delay}>
                <article className={`${s.verdict} ${v.cls}`}>
                  <span className={s.stripe} />
                  <span className={s.verdictBadge}>
                    <span className={s.verdictInd} />{v.label}
                  </span>
                  <h3 className={s.verdictH3}>{v.h}</h3>
                  <p className={s.verdictP}>{v.p}</p>
                  <div className={s.meter}>
                    <div className={s.meterCell}>
                      <span className={s.lbl}>Deal flow</span>
                      <div className={s.meterBar}><div className={s.meterFill} style={{ width: `${v.deal}%` }} /></div>
                    </div>
                    <div className={s.meterCell}>
                      <span className={s.lbl}>Coverage</span>
                      <div className={s.meterBar}><div className={s.meterFill} style={{ width: `${v.cov}%` }} /></div>
                    </div>
                  </div>
                </article>
              </Fade>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className={s.section}>
        <div className={s.container}>
          <div className={s.sectionHead}>
            <Fade><div className={s.eyebrow}>04 · Architecture</div></Fade>
            <Fade delay={60}>
              <h2 className={s.h2}>
                A deterministic <em style={{ fontStyle: 'italic' }}>signal pipeline</em>.
              </h2>
            </Fade>
            <Fade delay={120}>
              <p className={s.lede}>
                A deterministic pipeline from raw deal flow to a tagged thesis verdict. No black box — every output is traceable to its sources.
              </p>
            </Fade>
          </div>
          <Fade>
            <FlowSection />
          </Fade>
        </div>
      </section>

      {/* FINAL CTA */}
      <div className={s.finalOuter}>
        <Fade>
          <div className={s.final}>
            <div className={s.eyebrow} style={{ justifyContent: 'center', display: 'inline-flex', marginBottom: 24 }}>
              Closing read
            </div>
            <h2 className={s.finalH2}>
              Don&apos;t pitch a thesis the market<br />
              already moved on<span className={s.punct}>.</span>
            </h2>
            <p className={s.finalSub}>
              Run your next sector idea through Premia before you spend weeks researching the wrong thesis.
            </p>
            <div className={s.finalCtaRow}>
              <Link href="/app" className={`${s.btn} ${s.btnAccent}`} style={{ padding: '16px 26px', fontSize: 16 }}>
                Test your thesis now <span className={s.arrow}>→</span>
              </Link>
              <Link href="/auth?mode=signup" className={`${s.btn} ${s.btnGhost}`} style={{ padding: '16px 26px', fontSize: 16 }}>
                Create free account
              </Link>
            </div>
          </div>
        </Fade>
      </div>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={`${s.container} ${s.footerInner}`}>
          <div className={s.footerLeft}>
            <span className={s.footerWm}>Premia<span className={s.footerAccent}>.</span></span>
            <span>Understanding where money is moving</span>
          </div>
          <div className={s.footerRight}>
            <a href="mailto:mnshpoojari@gmail.com">Contact</a>
            <Link href="/app">Open Premia</Link>
            <span>© 2026</span>
          </div>
        </div>
      </footer>

    </div>
  )
}

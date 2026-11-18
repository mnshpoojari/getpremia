'use client'

import type { MarketContextResult } from '@/lib/queries/marketContext'

interface Props {
  data: MarketContextResult
  isMobile: boolean
  prominent?: boolean
  fallbackGeography?: string
}

function SourceLink({ name, url }: { name: string | null; url: string | null }) {
  if (!name) return null
  if (!url) return <span style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.04em' }}>{name}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="results-source-link"
      style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.04em' }}
    >
      {name} ↗
    </a>
  )
}

function MetricCell({
  label,
  value,
  sub,
  sourceName,
  sourceUrl,
  missingReason,
}: {
  label: string
  value: string | null
  sub?: string | null
  sourceName: string | null
  sourceUrl: string | null
  missingReason?: string
}) {
  return (
    <div className="results-market-cell">
      <div style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', fontFamily: 'var(--font-mono, monospace)', marginBottom: 6 }}>{label}</div>
      {value != null ? (
        <>
          <div style={{ fontSize: 26, lineHeight: 1.05, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', marginBottom: 2 }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 6 }}>{sub}</div>}
          <SourceLink name={sourceName} url={sourceUrl} />
        </>
      ) : (
        <div title={missingReason ?? 'No sourced benchmark is available for this metric.'} style={{ fontSize: 24, color: 'var(--results-muted)', lineHeight: 1.05 }}>—</div>
      )}
    </div>
  )
}

export default function MarketContextPanel({ data, isMobile, prominent = false, fallbackGeography }: Props) {
  const hasValidMultiple = (value: number | null) => value != null && Number.isFinite(value) && value > 0
  const hasAnyMetric =
    data.cagr.value != null ||
    data.market_size.value != null ||
    hasValidMultiple(data.ev_revenue.value) ||
    hasValidMultiple(data.ev_ebitda.value)

  if (!hasAnyMetric && !data.key_insight) return null

  const cagrValue = data.cagr.value != null
    ? `${data.cagr.value.toFixed(1)}%`
    : null

  const geographyLabel = (scope?: string | null) => scope ?? (fallbackGeography && !['Other', 'Global (no geography specified)'].includes(fallbackGeography) ? `${fallbackGeography} · scope unverified` : 'Scope unverified')
  const cagrSub = data.cagr.value != null ? `CAGR · ${data.cagr.period ?? 'period unverified'} · ${geographyLabel(data.cagr.geography_scope)}` : null

  const sizeValue = data.market_size.value != null
    ? `$${data.market_size.value >= 1000
        ? `${(data.market_size.value / 1000).toFixed(1)}T`
        : `${data.market_size.value.toFixed(1)}bn`}`
    : null

  const sizeSub = data.market_size.value != null ? `market size · ${data.market_size.year ?? 'year unverified'} · ${geographyLabel(data.market_size.geography_scope)}` : null

  const evRevValue = hasValidMultiple(data.ev_revenue.value) ? `${data.ev_revenue.value!.toFixed(1)}x` : null
  const evEbitdaValue = hasValidMultiple(data.ev_ebitda.value) ? `${data.ev_ebitda.value!.toFixed(1)}x` : null

  const metrics = [
    { label: 'MARKET SIZE', value: sizeValue, sub: sizeSub, sourceName: data.market_size.source_name, sourceUrl: data.market_size.source_url },
    { label: 'CAGR', value: cagrValue, sub: cagrSub, sourceName: data.cagr.source_name, sourceUrl: data.cagr.source_url },
    ...(evRevValue ? [{ label: 'EV / REVENUE', value: evRevValue, sub: [data.ev_revenue.context, geographyLabel(data.ev_revenue.geography_scope)].filter(Boolean).join(' · '), sourceName: data.ev_revenue.source_name, sourceUrl: data.ev_revenue.source_url }] : []),
    ...(evEbitdaValue ? [{ label: 'EV / EBITDA', value: evEbitdaValue, sub: [data.ev_ebitda.context, geographyLabel(data.ev_ebitda.geography_scope)].filter(Boolean).join(' · '), sourceName: data.ev_ebitda.source_name, sourceUrl: data.ev_ebitda.source_url }] : []),
  ]
  const displayMetrics = prominent
    ? (['MARKET SIZE', 'CAGR', 'EV / EBITDA'] as const).map(label => metrics.find(metric => metric.label === label) ?? {
        label, value: null, sub: null, sourceName: null, sourceUrl: null,
      })
    : metrics

  return (
    <section className={`paper results-market-context${prominent ? ' results-market-context--prominent' : ''}`} style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: isMobile ? '14px 16px 10px' : '16px 20px 10px', borderBottom: '1px solid var(--results-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginBottom: 2 }}>MARKET CONTEXT</div>
          <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 400 }}>Sector benchmarks</div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>Geography scope is shown with each metric; global figures are labeled Global.</div>
        </div>
        <a
          href="/methodology"
          className="results-method-link"
          style={{ fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}
        >
          How we source this ↗
        </a>
      </div>

      {hasAnyMetric && (
        <div className="results-market-grid" style={{ borderBottom: data.key_insight ? '1px solid var(--results-line)' : 'none' }}>
          {displayMetrics.map(m => (
            <MetricCell
              key={m.label}
              label={m.label}
              value={m.value}
              sub={m.sub}
              sourceName={m.sourceName}
              sourceUrl={m.sourceUrl}
            />
          ))}
        </div>
      )}

      {data.key_insight && (
        <div style={{ padding: isMobile ? '14px 16px' : '16px 20px', background: 'var(--results-soft-gold)' }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--results-gold)', marginBottom: 5 }}>RESEARCH CONTEXT</div>
          <p style={{ margin: 0, color: 'var(--results-ink)', fontSize: 13, lineHeight: 1.6 }}>{data.key_insight}</p>
        </div>
      )}
    </section>
  )
}

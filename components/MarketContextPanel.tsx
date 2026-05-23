'use client'

import type { MarketContextResult } from '@/lib/queries/marketContext'

interface Props {
  data: MarketContextResult
  isMobile: boolean
}

function SourceLink({ name, url }: { name: string | null; url: string | null }) {
  if (!name) return null
  if (!url) return <span style={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.04em' }}>{name}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ fontSize: 10, color: 'var(--brass)', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '.04em', textDecoration: 'none', borderBottom: '1px dotted currentColor' }}
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
  borderRight,
}: {
  label: string
  value: string | null
  sub?: string | null
  sourceName: string | null
  sourceUrl: string | null
  borderRight?: boolean
}) {
  return (
    <div style={{
      padding: '14px 18px',
      borderRight: borderRight ? '1px dashed rgba(43,37,32,.14)' : 'none',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-mute)', fontFamily: 'var(--font-mono, monospace)', marginBottom: 6 }}>{label}</div>
      {value != null ? (
        <>
          <div style={{ fontSize: 26, lineHeight: 1.05, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', marginBottom: 2 }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 6 }}>{sub}</div>}
          <SourceLink name={sourceName} url={sourceUrl} />
        </>
      ) : (
        <div style={{ fontSize: 20, color: 'rgba(43,37,32,.18)', lineHeight: 1.05 }}>—</div>
      )}
    </div>
  )
}

export default function MarketContextPanel({ data, isMobile }: Props) {
  const hasAnyMetric =
    data.cagr.value != null ||
    data.market_size.value != null ||
    data.ev_revenue.value != null ||
    data.ev_ebitda.value != null

  if (!hasAnyMetric && !data.key_insight) return null

  const cagrValue = data.cagr.value != null
    ? `${data.cagr.value.toFixed(1)}%`
    : null

  const cagrSub = data.cagr.period ? `CAGR · ${data.cagr.period}` : data.cagr.value != null ? 'CAGR' : null

  const sizeValue = data.market_size.value != null
    ? `$${data.market_size.value >= 1000
        ? `${(data.market_size.value / 1000).toFixed(1)}T`
        : `${data.market_size.value.toFixed(1)}bn`}`
    : null

  const sizeSub = data.market_size.year ? `market size · ${data.market_size.year}` : data.market_size.value != null ? 'market size (USD)' : null

  const evRevValue = data.ev_revenue.value != null ? `${data.ev_revenue.value.toFixed(1)}×` : null
  const evEbitdaValue = data.ev_ebitda.value != null ? `${data.ev_ebitda.value.toFixed(1)}×` : null

  const metrics = [
    { label: 'MARKET SIZE', value: sizeValue, sub: sizeSub, sourceName: data.market_size.source_name, sourceUrl: data.market_size.source_url },
    { label: 'CAGR', value: cagrValue, sub: cagrSub, sourceName: data.cagr.source_name, sourceUrl: data.cagr.source_url },
    { label: 'EV / REVENUE', value: evRevValue, sub: data.ev_revenue.context, sourceName: data.ev_revenue.source_name, sourceUrl: data.ev_revenue.source_url },
    { label: 'EV / EBITDA', value: evEbitdaValue, sub: data.ev_ebitda.context, sourceName: data.ev_ebitda.source_name, sourceUrl: data.ev_ebitda.source_url },
  ]

  return (
    <section className="paper" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: isMobile ? '14px 16px 10px' : '16px 20px 10px', borderBottom: '1px solid rgba(43,37,32,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-mute)', marginBottom: 2 }}>MARKET CONTEXT</div>
          <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 400 }}>Sector benchmarks</div>
        </div>
        <a
          href="/methodology"
          style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono, monospace)', textDecoration: 'none', borderBottom: '1px dotted rgba(43,37,32,.3)', opacity: .7 }}
        >
          How we source this ↗
        </a>
      </div>

      {hasAnyMetric && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', borderBottom: data.key_insight ? '1px solid rgba(43,37,32,.08)' : 'none' }}>
          {metrics.map((m, i) => (
            <MetricCell
              key={m.label}
              label={m.label}
              value={m.value}
              sub={m.sub}
              sourceName={m.sourceName}
              sourceUrl={m.sourceUrl}
              borderRight={isMobile ? i % 2 === 0 : i < 3}
            />
          ))}
        </div>
      )}

    </section>
  )
}

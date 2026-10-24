// Display helpers for the collapsible Sources card. Pure, so they can be unit tested.
// Source numbers (n) are never changed: they must match the superscripts in the thesis text.

const MAX_TITLE = 90

export function groupLabelForType(type) {
  if (type === 'deal_fact' || type === 'headline_only') return 'Deals'
  if (typeof type === 'string' && type.startsWith('research_')) return 'Research'
  if (type === 'benchmark') return 'Benchmarks'
  return 'Research'
}

export function truncateTitle(title, max = MAX_TITLE) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).trimEnd() + '…'
}

// Pulls a short headline out of the evidence text without showing snippet text.
export function titleFromSourceText(type, text) {
  const t = String(text ?? '').trim()
  if (!t) return ''
  if (type === 'headline_only') return t.replace(/\s*\(headline only[^)]*\)\.?\s*$/i, '').trim()
  if (type === 'deal_fact') {
    const m = t.match(/Headline:\s*(.+?)\.?\s*$/i)
    return m ? m[1].trim() : ''
  }
  const colon = t.indexOf(': ')
  return colon > 0 && colon <= 140 ? t.slice(0, colon).trim() : ''
}

function publisherOf(s) {
  if (s.source) return s.source
  try {
    return s.url ? new URL(s.url).hostname.replace(/^www\./, '') : 'Source'
  } catch {
    return 'Source'
  }
}

/**
 * @param {Array<any>} sources
 * @returns {Array<{ label: string, items: Array<{ n: number, publisher: string, title: string, hasTitle: boolean, date: string | null, url: string | null, headlineOnly: boolean }> }>}
 */
export function sourceGroups(sources) {
  const order = ['Deals', 'Research', 'Benchmarks']
  /** @type {Record<string, any[]>} */
  const groups = { Deals: [], Research: [], Benchmarks: [] }
  for (const s of sources ?? []) {
    const publisher = publisherOf(s)
    const title = truncateTitle(titleFromSourceText(s.type, s.text))
    groups[groupLabelForType(s.type)].push({
      n: s.n,
      publisher,
      title: title || publisher,
      hasTitle: Boolean(title),
      date: s.date ?? null,
      url: s.url ?? null,
      headlineOnly: s.type === 'headline_only',
    })
  }
  return order.map(label => ({ label, items: groups[label] })).filter(g => g.items.length > 0)
}

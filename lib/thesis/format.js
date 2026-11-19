// Formatting repairs applied to model output before it is validated and rendered.

// Puts every "## " / "### " heading on its own line with a blank line before it, and turns inline "* " bullets
// ("* A reversal... * A decline...") into real line-separated bullets. Bold labels and citations are left alone.
const SUB_BLOCK_LABELS = [
  'The Reality', 'The Macro Context', 'The Execution Angle', 'Surprising Observation', 'Why This Matters',
  'What Most People Miss', 'Alternative Interpretation', 'What Data Would Change The View',
  'Investors', 'Founders', 'Corporates', 'Advisors',
]
const LABEL_GLUED_RE = new RegExp(`(\\S)[ \\t]*(\\*\\*(?:${SUB_BLOCK_LABELS.join('|')}):?\\*\\*:?)`, 'g')

export function normaliseThesisMarkdown(text) {
  if (typeof text !== 'string' || !text) return ''
  let out = text.replace(/\r\n/g, '\n')

  // A heading glued onto the end of a sentence or paragraph.
  out = out.replace(/([^\n#])[ \t]*(#{2,3}[ \t]+[A-Z])/g, '$1\n\n$2')

  // Bold sub-block labels start their own paragraph, even right after a citation such as [8].
  out = out
    .split('\n')
    .map(line => {
      if (/^\s*#{2,3}\s/.test(line)) return line
      const lead = line.match(/^\s*(?:[*-]\s+)?/)[0].length
      return line.slice(0, lead) + line.slice(lead).replace(LABEL_GLUED_RE, '$1\n\n$2')
    })
    .join('\n')

  // Inline bullets: " * Text" appearing after other text on the same line.
  out = out
    .split('\n')
    .map(line => {
      if (/^\s*#{2,3}\s/.test(line)) return line
      return line
        .replace(/([.!?:\]])[ \t]+\*[ \t]+(?=\S)(?!\*\*)/g, '$1\n* ')
        .replace(/(\S)[ \t]+\*[ \t]+(?=[A-Z"'(\[]|\*\*)/g, '$1\n* ')
    })
    .join('\n')

  // Exactly one blank line before every heading and after it.
  out = out.replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2')
  out = out.replace(/^(#{2,3}\s[^\n]*)\n(?!\n)/gm, '$1\n\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

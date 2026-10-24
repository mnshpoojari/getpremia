// Formatting repairs applied to model output before it is validated and rendered.

// Puts every "## " / "### " heading on its own line with a blank line before it, and turns inline "* " bullets
// ("* A reversal... * A decline...") into real line-separated bullets. Bold labels and citations are left alone.
export function normaliseThesisMarkdown(text) {
  if (typeof text !== 'string' || !text) return ''
  let out = text.replace(/\r\n/g, '\n')

  // A heading glued onto the end of a sentence or paragraph.
  out = out.replace(/([^\n#])[ \t]*(#{2,3}[ \t]+[A-Z])/g, '$1\n\n$2')

  // Inline bullets: " * Text" appearing after other text on the same line.
  out = out
    .split('\n')
    .map(line => {
      if (/^\s*#{2,3}\s/.test(line)) return line
      return line.replace(/(\S)[ \t]+\*[ \t]+(?=[A-Z"'(\[]|\*\*)/g, '$1\n* ')
    })
    .join('\n')

  // Exactly one blank line before every heading and after it.
  out = out.replace(/([^\n])\n(#{2,3}\s)/g, '$1\n\n$2')
  out = out.replace(/^(#{2,3}\s[^\n]*)\n(?!\n)/gm, '$1\n\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

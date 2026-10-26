const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Draws spaces as dots and tabs as arrows in highlighted HTML, leaving tags and entities alone.
 * Runs are wrapped in a span so the theme's whitespace colour can dim them.
 */
export function markInvisibles(html: string): string {
  return html.replace(/(<[^>]*>|&[#\w]+;)|([ \t]+)/g, (match, markup: string | undefined, run: string | undefined) => {
    if (markup !== undefined) {
      return markup;
    }
    const drawn = (run ?? match)
      .split('')
      .map((char) => (char === '\t' ? '<span class="commit-invisible-tab">→</span>' : '·'))
      .join('');
    return `<span class="commit-invisible">${drawn}</span>`;
  });
}

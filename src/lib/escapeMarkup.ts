/**
 * Escapes the 5 characters that matter for both HTML and SVG/XML text
 * content and attribute values — the same set works for either, so one
 * function covers the clickable HTML asset and the SVG poster composition.
 * Every piece of user-authored text (company name, headline, CTA, tagline)
 * goes through this before being concatenated into a markup string.
 */
export function escapeMarkup(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

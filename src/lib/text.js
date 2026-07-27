const TOKEN_RE = /《《([^》]+?)》》|[|｜]([^|｜《》]+?)《([^》]+?)》/g;

export function splitParagraphs(text) {
  if (text === '') return [];
  return text.split('\n');
}

export function joinParagraphs(paragraphs) {
  return paragraphs.join('\n');
}

export function parseAnnotations(line) {
  const tokens = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m.index > last) tokens.push({ type: 'text', value: line.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: 'emphasis', value: m[1] });
    else tokens.push({ type: 'ruby', base: m[2], ruby: m[3] });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ type: 'text', value: line.slice(last) });
  return tokens;
}

export function stripAnnotations(text) {
  return splitParagraphs(text)
    .map((line) =>
      parseAnnotations(line)
        .map((t) => (t.type === 'ruby' ? t.base : t.value))
        .join(''),
    )
    .join('\n');
}

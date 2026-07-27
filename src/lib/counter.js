import { splitParagraphs, stripAnnotations } from './text.js';

export function countChars(text) {
  return stripAnnotations(text).replace(/\n/g, '').length;
}

export function countLines(text, charsPerLine = 20) {
  return splitParagraphs(stripAnnotations(text)).reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)),
    0,
  );
}

export function countManuscriptPages(text, { charsPerLine = 20, linesPerPage = 20 } = {}) {
  if (text === '') return 0;
  return Math.round((countLines(text, charsPerLine) / linesPerPage) * 10) / 10;
}

export function defaultChoices(hunks) {
  const choices = {};
  hunks.forEach((h, i) => {
    if (h.type !== 'equal') choices[i] = 'b';
  });
  return choices;
}

export function mergeParagraphs(hunks, choices = {}) {
  const out = [];
  hunks.forEach((h, i) => {
    const choice = choices[i] ?? 'b';
    if (h.type === 'equal') {
      out.push(h.a);
      return;
    }
    if (h.type === 'change') {
      if (choice === 'a') out.push(h.a);
      else if (choice === 'both') out.push(h.a, h.b);
      else out.push(h.b);
      return;
    }
    if (h.type === 'remove') {
      if (choice === 'a' || choice === 'both') out.push(h.a);
      return;
    }
    if (choice === 'b' || choice === 'both') out.push(h.b);
  });
  return out;
}

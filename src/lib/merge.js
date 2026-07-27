export function defaultChoices(hunks) {
  const choices = {};
  hunks.forEach((h, i) => {
    if (h.type !== 'equal') choices[i] = 'b';
  });
  return choices;
}

const CHOICES = ['a', 'b', 'both'];

export function mergeParagraphs(hunks, choices = {}) {
  const out = [];
  hunks.forEach((h, i) => {
    // 想定外の値は既定の 'b' に倒す。add ハンクだけ黙って段落が消えるのを防ぐ。
    const choice = CHOICES.includes(choices[i]) ? choices[i] : 'b';
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

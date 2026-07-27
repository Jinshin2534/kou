function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', a: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', b: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'remove', a: a[i++] });
  while (j < m) ops.push({ type: 'add', b: b[j++] });
  return ops;
}

export function diffChars(a, b) {
  const out = [];
  for (const op of lcsOps([...a], [...b])) {
    const value = op.type === 'add' ? op.b : op.a;
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.value += value;
    else out.push({ type: op.type, value });
  }
  return out;
}

export function diffParagraphs(aParas, bParas) {
  const ops = lcsOps(aParas, bParas);
  const hunks = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      hunks.push({ type: 'equal', a: ops[i].a, b: ops[i].b });
      i++;
      continue;
    }
    const removes = [];
    while (i < ops.length && ops[i].type === 'remove') removes.push(ops[i++].a);
    const adds = [];
    while (i < ops.length && ops[i].type === 'add') adds.push(ops[i++].b);
    const pairs = Math.min(removes.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      hunks.push({
        type: 'change',
        a: removes[k],
        b: adds[k],
        inline: diffChars(removes[k], adds[k]),
      });
    }
    for (let k = pairs; k < removes.length; k++) hunks.push({ type: 'remove', a: removes[k] });
    for (let k = pairs; k < adds.length; k++) hunks.push({ type: 'add', b: adds[k] });
  }
  return hunks;
}

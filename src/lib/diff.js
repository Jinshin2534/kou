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

// LCS のテーブルは長さの積に比例して確保されるため、上限を設ける。
// これを超える書き換えは、文字単位の差分を諦めて段落まるごとの置換として返す。
const MAX_CELLS = 4_000_000;

// 似ていない段落どうしを「書き換え」として並べると比較画面が誤解を招くため、
// 一致した文字が長い方の 3 割に満たないペアは、削除と追加に分けて出す。
const PAIR_THRESHOLD = 0.3;

export function diffChars(a, b) {
  const ac = [...a];
  const bc = [...b];

  let head = 0;
  while (head < ac.length && head < bc.length && ac[head] === bc[head]) head++;

  let tail = 0;
  while (
    tail < ac.length - head &&
    tail < bc.length - head &&
    ac[ac.length - 1 - tail] === bc[bc.length - 1 - tail]
  ) {
    tail++;
  }

  const out = [];
  const push = (type, value) => {
    if (value === '') return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.value += value;
    else out.push({ type, value });
  };

  push('equal', ac.slice(0, head).join(''));

  const midA = ac.slice(head, ac.length - tail);
  const midB = bc.slice(head, bc.length - tail);

  if (midA.length * midB.length > MAX_CELLS) {
    push('remove', midA.join(''));
    push('add', midB.join(''));
  } else {
    for (const op of lcsOps(midA, midB)) {
      push(op.type, op.type === 'add' ? op.b : op.a);
    }
  }

  push('equal', ac.slice(ac.length - tail).join(''));
  return out;
}

function similarity(inline, a, b) {
  const longer = Math.max([...a].length, [...b].length);
  if (longer === 0) return 1;
  const equal = inline
    .filter((part) => part.type === 'equal')
    .reduce((sum, part) => sum + [...part.value].length, 0);
  return equal / longer;
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
    const changes = [];
    const restRemoves = [];
    const restAdds = [];

    for (let k = 0; k < pairs; k++) {
      const inline = diffChars(removes[k], adds[k]);
      if (similarity(inline, removes[k], adds[k]) >= PAIR_THRESHOLD) {
        changes.push({ type: 'change', a: removes[k], b: adds[k], inline });
      } else {
        restRemoves.push(removes[k]);
        restAdds.push(adds[k]);
      }
    }
    for (let k = pairs; k < removes.length; k++) restRemoves.push(removes[k]);
    for (let k = pairs; k < adds.length; k++) restAdds.push(adds[k]);

    hunks.push(
      ...changes,
      ...restRemoves.map((a) => ({ type: 'remove', a })),
      ...restAdds.map((b) => ({ type: 'add', b })),
    );
  }
  return hunks;
}

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
// これを超える書き換えは、文字単位の差分を諦めて丸ごとの置換として返す。
const MAX_CELLS = 4_000_000;

// 似ていない段落どうしを「書き換え」として並べると比較画面が誤解を招くため、
// 一致が薄いペアは、削除と追加に分けて出す。
// 短い方に対する一致率と、連続一致の長さの両方を見る。無関係な日本語の文章でも
// 助詞や句読点は 3 割前後たまたま一致するので、一致率だけでは選り分けられない。
const PAIR_MIN_RATIO = 0.4;
const PAIR_MIN_RUN = 3;

// 共通の先頭・末尾を削ってから LCS にかける。編集は普通どこか一箇所に固まるので、
// これだけで表の大きさが実用的な範囲に落ちる。
function trim(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  return { head, tail };
}

export function diffChars(a, b) {
  const ac = [...a];
  const bc = [...b];
  const { head, tail } = trim(ac, bc);

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

  if (midA.length === 0 || midB.length === 0 || midA.length * midB.length > MAX_CELLS) {
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

function isSimilar(inline, a, b) {
  const shorter = Math.min([...a].length, [...b].length);
  if (shorter === 0) return false;

  let equal = 0;
  let longestRun = 0;
  for (const part of inline) {
    if (part.type !== 'equal') continue;
    const length = [...part.value].length;
    equal += length;
    if (length > longestRun) longestRun = length;
  }

  // 短い段落ほど、まとまった一致は構造上取りにくい。「空が青い」→「空は青い」のような
  // 助詞ひとつの直しを弾かないよう、短い側に応じて必要な連続長を緩める。
  const requiredRun = Math.min(PAIR_MIN_RUN, Math.ceil(shorter / 2));
  return equal / shorter >= PAIR_MIN_RATIO && longestRun >= requiredRun;
}

// ペアにするか判断するのに使う、実際に組まれる表の大きさ。
// diffChars は共通の先頭・末尾を削ってから表を組むので、削る前の長さで見積もると
// 「長いがほぼ同じ段落」を高コストと誤判定してしまう。
function trimmedCost(a, b) {
  const ac = [...a];
  const bc = [...b];
  const { head, tail } = trim(ac, bc);
  return (ac.length - head - tail) * (bc.length - head - tail);
}

export function diffParagraphs(aParas, bParas) {
  const { head, tail } = trim(aParas, bParas);
  const hunks = [];

  for (let k = 0; k < head; k++) {
    hunks.push({ type: 'equal', a: aParas[k], b: bParas[k] });
  }

  const middle = diffMiddle(
    aParas.slice(head, aParas.length - tail),
    bParas.slice(head, bParas.length - tail),
  );
  for (const hunk of middle) hunks.push(hunk);

  for (let k = tail; k > 0; k--) {
    hunks.push({ type: 'equal', a: aParas[aParas.length - k], b: bParas[bParas.length - k] });
  }

  return hunks;
}

function diffMiddle(aParas, bParas) {
  // 先頭も末尾も直された長い原稿では削りが効かない。段落側の表にも上限を設ける。
  if (aParas.length * bParas.length > MAX_CELLS) {
    return aParas
      .map((a) => ({ type: 'remove', a }))
      .concat(bParas.map((b) => ({ type: 'add', b })));
  }

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

    // ペアにするか判断するには文字差分が要るが、似ていないペアではその計算が丸ごと無駄になる。
    // 1 つの塊で使える総量を決めておく。高すぎるペアは飛ばすだけで残額は減らさないので、
    // 後ろに来る安いペアが巻き添えで判定を落とされることはない。
    let budget = MAX_CELLS * 2;
    const pairs = Math.min(removes.length, adds.length);

    // k の順に出す。change を先にまとめると、削除と書き換えが混ざったときに
    // 前後が入れ替わり、ハンクを並べても元の段落列に戻らなくなる。
    for (let k = 0; k < pairs; k++) {
      const cost = trimmedCost(removes[k], adds[k]);
      let inline = null;
      if (cost <= budget) {
        budget -= cost;
        inline = diffChars(removes[k], adds[k]);
      }

      if (inline && isSimilar(inline, removes[k], adds[k])) {
        hunks.push({ type: 'change', a: removes[k], b: adds[k], inline });
      } else {
        hunks.push({ type: 'remove', a: removes[k] });
        hunks.push({ type: 'add', b: adds[k] });
      }
    }

    for (let k = pairs; k < removes.length; k++) hunks.push({ type: 'remove', a: removes[k] });
    for (let k = pairs; k < adds.length; k++) hunks.push({ type: 'add', b: adds[k] });
  }

  return hunks;
}

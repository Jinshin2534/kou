import { diffParagraphs } from '../lib/diff.js';
import { defaultChoices, mergeParagraphs } from '../lib/merge.js';
import { splitParagraphs, joinParagraphs } from '../lib/text.js';
import { chaptersAt } from '../lib/history.js';

const SOURCES = [
  ['drafts', '異稿 ↔ 異稿'],
  ['commits', 'コミット ↔ コミット'],
  ['versions', '版 ↔ 版'],
];

function options({ state, data }) {
  if (state.compare.source === 'commits') {
    return [...data.commits]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({ id: c.id, name: `${c.message}（${new Date(c.createdAt).toLocaleDateString('ja-JP')}）` }));
  }
  if (state.compare.source === 'versions') {
    return data.versions.map((v) => ({ id: v.id, name: v.name }));
  }
  return data.drafts.map((d) => ({ id: d.id, name: d.name }));
}

function resolve(id, { state, data }) {
  if (state.compare.source === 'commits') {
    const chapter = chaptersAt(data.commits, id)[state.chapterId];
    const commit = data.commits.find((c) => c.id === id);
    return { text: chapter ? chapter.text : '', name: commit ? commit.message : '' };
  }
  const draft = data.drafts.find((d) => d.id === id);
  return { text: draft ? draft.text : '', name: draft ? draft.name : '' };
}

export function renderCompare({ state, data, actions }) {
  const ctx = { state, data };
  const root = document.createElement('div');
  root.className = 'compare';

  const bar = document.createElement('div');
  bar.className = 'compare__bar';

  bar.append(
    pick(
      SOURCES.map(([id, name]) => ({ id, name })),
      state.compare.source,
      (source) => actions.setCompareSource(source),
    ),
  );

  const sideOptions = options(ctx);
  bar.append(
    pick(sideOptions, state.compare.leftId, (id) =>
      state.compare.source === 'versions'
        ? actions.setCompareVersionSide('left', id)
        : actions.setCompare({ leftId: id, choices: {} }),
    ),
    text('→'),
    pick(sideOptions, state.compare.rightId, (id) =>
      state.compare.source === 'versions'
        ? actions.setCompareVersionSide('right', id)
        : actions.setCompare({ rightId: id, choices: {} }),
    ),
  );

  const back = document.createElement('button');
  back.className = 'compare__back';
  back.textContent = '執筆に戻る';
  back.addEventListener('click', () => actions.setScreen('write'));
  bar.append(back);

  root.append(bar);

  if (state.compare.source === 'versions') {
    const { node, changed, total } = renderVersionsBody({ state, data, actions });
    const count = document.createElement('span');
    count.className = 'compare__count';
    count.textContent = total === 0 ? '章なし' : changed === 0 ? '差分なし' : `${changed}/${total}章 差分あり`;
    bar.append(count);
    root.append(node);
    return root;
  }

  const left = resolve(state.compare.leftId, ctx);
  const right = resolve(state.compare.rightId, ctx);

  const hunks = diffParagraphs(splitParagraphs(left.text), splitParagraphs(right.text));

  if (Object.keys(state.compare.choices).length === 0) {
    Object.assign(state.compare.choices, defaultChoices(hunks));
  }

  const changed = hunks.filter((h) => h.type !== 'equal').length;
  const count = document.createElement('span');
  count.className = 'compare__count';
  count.textContent = changed === 0 ? '差分なし' : `${changed}段落 変更`;
  bar.append(count);

  const list = document.createElement('div');
  list.className = 'compare__list';

  hunks.forEach((hunk, index) => {
    list.append(
      renderHunk(hunk, index, state.compare.choices, (i, value) => {
        state.compare.choices[i] = value;
        actions.setCompare({});
      }),
    );
  });

  const apply = document.createElement('button');
  apply.className = 'compare__apply';
  apply.textContent =
    state.compare.source === 'commits'
      ? '選んだ内容を新しい異稿にする'
      : `選んだ内容を「${right.name}」に取り込む`;
  apply.disabled = changed === 0;
  apply.addEventListener('click', () => {
    apply.disabled = true; // 二度押しで異稿が二重にできるのを防ぐ
    const merged = mergeParagraphs(hunks, state.compare.choices);
    actions.applyMerge(joinParagraphs(merged));
  });

  root.append(list, apply);
  return root;
}

// 版 ↔ 版 比較。章は版ごとに複製され id が変わる（store.createVersion）ため id では
// 対応が取れない。order で対応させ、行に両側のタイトルを出すことで対応のズレ
// （章の増減・並べ替え）を見えるようにする。どちらかの版に無い order は
// 欠けている側を「（この版に章なし）」として出す ―― 黙って読み飛ばさない。
function renderVersionsBody({ state, data, actions }) {
  const wrap = document.createElement('div');
  wrap.className = 'compare__versions';

  const cache = data.compareVersions;
  if (!cache || cache.leftId !== state.compare.leftId || cache.rightId !== state.compare.rightId) {
    const loading = document.createElement('div');
    loading.className = 'compare__loading';
    loading.textContent = '読み込み中…';
    wrap.append(loading);
    return { node: wrap, changed: 0, total: 0 };
  }

  const leftByOrder = new Map(cache.leftChapters.map((c) => [c.order, c]));
  const rightByOrder = new Map(cache.rightChapters.map((c) => [c.order, c]));
  const orders = [...new Set([...leftByOrder.keys(), ...rightByOrder.keys()])].sort((a, b) => a - b);
  const rightVersion = data.versions.find((v) => v.id === state.compare.rightId);

  let changedChapters = 0;

  orders.forEach((order) => {
    const left = leftByOrder.get(order) ?? null;
    const right = rightByOrder.get(order) ?? null;
    const hunks = diffParagraphs(splitParagraphs(left?.text ?? ''), splitParagraphs(right?.text ?? ''));
    const changed = hunks.filter((h) => h.type !== 'equal').length;
    if (changed > 0) changedChapters++;

    if (!state.compare.choices[order]) {
      state.compare.choices[order] = defaultChoices(hunks);
    }

    wrap.append(renderChapterRow({ order, left, right, hunks, changed, rightVersion, state, actions }));
  });

  return { node: wrap, changed: changedChapters, total: orders.length };
}

function renderChapterRow({ order, left, right, hunks, changed, rightVersion, state, actions }) {
  const row = document.createElement('div');
  row.className = 'compare__chapter';

  const header = document.createElement('div');
  header.className = 'compare__chapter-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'compare__chapter-title';
  const leftTitle = left ? left.title : '（この版に章なし）';
  const rightTitle = right ? right.title : '（この版に章なし）';
  titleSpan.textContent = leftTitle === rightTitle ? leftTitle : `${leftTitle} → ${rightTitle}`;
  header.append(titleSpan);

  if (changed === 0) {
    header.className = 'compare__chapter-header compare__chapter-header--nodiff';
    const nodiff = document.createElement('span');
    nodiff.className = 'compare__nodiff';
    nodiff.textContent = '差分なし';
    header.append(nodiff);
    row.append(header);
    return row;
  }

  const count = document.createElement('span');
  count.className = 'compare__count';
  count.textContent = `${changed}段落 変更`;
  header.append(count);
  row.append(header);

  const list = document.createElement('div');
  list.className = 'compare__list';
  const rowChoices = state.compare.choices[order];
  hunks.forEach((hunk, index) => {
    list.append(
      renderHunk(hunk, index, rowChoices, (i, value) => {
        rowChoices[i] = value;
        actions.setCompare({});
      }),
    );
  });
  row.append(list);

  const apply = document.createElement('button');
  apply.className = 'compare__apply compare__chapter-apply';
  if (!right) {
    apply.textContent = '右の版にこの章がないため取り込めません';
    apply.disabled = true;
  } else {
    apply.textContent = `「${rightVersion ? rightVersion.name : right.title}」の「${right.title}」に新しい異稿として取り込む（上書きしません）`;
    apply.addEventListener('click', () => {
      apply.disabled = true; // 二度押しで異稿が二重にできるのを防ぐ
      apply.textContent = '取り込みました';
      const merged = mergeParagraphs(hunks, rowChoices);
      actions.applyVersionMerge(right.id, joinParagraphs(merged));
    });
  }
  row.append(apply);

  return row;
}

function renderHunk(hunk, index, choices, onChoose) {
  const row = document.createElement('div');
  row.className = `hunk hunk--${hunk.type}`;

  const body = document.createElement('div');
  body.className = 'hunk__body';

  if (hunk.type === 'equal') {
    body.textContent = hunk.a === '' ? '​' : hunk.a;
  } else if (hunk.type === 'change') {
    for (const part of hunk.inline) {
      const span = document.createElement('span');
      span.className = `inline inline--${part.type}`;
      span.textContent = part.value;
      body.append(span);
    }
  } else {
    body.textContent = (hunk.type === 'remove' ? hunk.a : hunk.b) || '​';
  }

  row.append(body);

  if (hunk.type !== 'equal') {
    const tools = document.createElement('div');
    tools.className = 'hunk__tools';
    for (const [value, label] of [['a', '左を採用'], ['b', '右を採用'], ['both', '両方残す']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = choices[index] === value ? 'is-current' : '';
      b.addEventListener('click', () => onChoose(index, value));
      tools.append(b);
    }
    row.append(tools);
  }

  return row;
}

function pick(items, currentId, onChange) {
  const select = document.createElement('select');
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === currentId;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function text(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

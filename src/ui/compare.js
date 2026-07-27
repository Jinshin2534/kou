import { diffParagraphs } from '../lib/diff.js';
import { defaultChoices, mergeParagraphs } from '../lib/merge.js';
import { splitParagraphs, joinParagraphs } from '../lib/text.js';
import { chaptersAt } from '../lib/history.js';

function options({ state, data }) {
  if (state.compare.source === 'commits') {
    return [...data.commits]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => ({ id: c.id, name: `${c.message}（${new Date(c.createdAt).toLocaleDateString('ja-JP')}）` }));
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
  const left = resolve(state.compare.leftId, ctx);
  const right = resolve(state.compare.rightId, ctx);
  const choices = options(ctx);

  const root = document.createElement('div');
  root.className = 'compare';

  const bar = document.createElement('div');
  bar.className = 'compare__bar';
  bar.append(
    pick(choices, state.compare.leftId, (id) => actions.setCompare({ leftId: id, choices: {} })),
    text('→'),
    pick(choices, state.compare.rightId, (id) => actions.setCompare({ rightId: id, choices: {} })),
  );

  const back = document.createElement('button');
  back.className = 'compare__back';
  back.textContent = '執筆に戻る';
  back.addEventListener('click', () => actions.setScreen('write'));
  bar.append(back);

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
    list.append(renderHunk(hunk, index, state, actions));
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

  root.append(bar, list, apply);
  return root;
}

function renderHunk(hunk, index, state, actions) {
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
      b.className = state.compare.choices[index] === value ? 'is-current' : '';
      b.addEventListener('click', () => {
        state.compare.choices[index] = value;
        actions.setCompare({});
      });
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

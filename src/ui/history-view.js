import { buildGraph } from '../lib/history.js';
import { icon } from './icons.js';

const ROW_HEIGHT = 44;
const LANE_WIDTH = 18;

export function renderHistory({ state, data, actions }) {
  const root = document.createElement('div');
  root.className = 'history';

  const bar = document.createElement('div');
  bar.className = 'history__bar';
  const back = document.createElement('button');
  back.textContent = '執筆に戻る';
  back.addEventListener('click', () => actions.setScreen('write'));
  bar.append(back);
  root.append(bar);

  const { nodes, laneCount } = buildGraph(data.commits);
  if (nodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'history__empty';
    empty.textContent = 'まだコミットがありません。執筆画面で「記録する」を押すと、ここに残ります。';
    root.append(empty);
    return root;
  }

  const versionName = Object.fromEntries(data.versions.map((v) => [v.id, v.name]));
  const rowById = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const graph = document.createElement('div');
  graph.className = 'history__graph';
  graph.style.setProperty('--lanes', String(laneCount));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'history__lines');
  svg.setAttribute('width', String(laneCount * LANE_WIDTH));
  svg.setAttribute('height', String(nodes.length * ROW_HEIGHT));

  for (const node of nodes) {
    const parent = node.parentId ? rowById[node.parentId] : null;
    if (!parent) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const x1 = node.lane * LANE_WIDTH + LANE_WIDTH / 2;
    const y1 = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
    const x2 = parent.lane * LANE_WIDTH + LANE_WIDTH / 2;
    const y2 = parent.row * ROW_HEIGHT + ROW_HEIGHT / 2;
    line.setAttribute('d', `M${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`);
    line.setAttribute('class', 'history__line');
    svg.append(line);
  }
  graph.append(svg);

  const list = document.createElement('ul');
  list.className = 'history__list';
  for (const node of nodes) {
    const li = document.createElement('li');
    li.className = 'history__item';
    li.style.height = `${ROW_HEIGHT}px`;
    li.style.setProperty('--lane', String(node.lane));

    const dot = document.createElement('span');
    dot.className = 'history__dot';
    dot.append(icon('git-commit', 14));

    const label = document.createElement('span');
    label.className = 'history__message';
    label.textContent = node.message;

    const version = document.createElement('span');
    version.className = 'history__version';
    version.append(icon('git-branch', 12));
    version.append(document.createTextNode(versionName[node.versionId] ?? node.versionId));

    const isFrom = state.compare.source === 'commits' && state.compare.leftId === node.id;

    const from = document.createElement('button');
    from.className = 'history__restore' + (isFrom ? ' is-current' : '');
    from.textContent = isFrom ? '比較元に選択中' : '比較元にする';
    from.addEventListener('click', () =>
      actions.setCompare({ source: 'commits', leftId: node.id, choices: {} }),
    );

    const to = document.createElement('button');
    to.className = 'history__restore';
    to.textContent = 'ここまでの差分を見る';
    to.addEventListener('click', () => {
      if (state.compare.source !== 'commits' || !state.compare.leftId) {
        alert('先に「比較元にする」を押してください');
        return;
      }
      actions.compareCommits(state.compare.leftId, node.id);
    });

    const restore = document.createElement('button');
    restore.className = 'history__restore';
    restore.textContent = 'この時点を異稿として復元';
    restore.addEventListener('click', () => {
      if (confirm('この時点の各章を、新しい異稿として復元します（今の本文は消えません）')) {
        actions.restore(node.id);
      }
    });

    const branch = document.createElement('button');
    branch.className = 'history__restore';
    branch.textContent = 'ここを起点に版を切る';
    branch.addEventListener('click', () => {
      // 版の中身は「今の内容」の複製で、この地点まで巻き戻したものではない。
      // baseCommitId は分岐点の記録としてだけ持つ。
      const name = prompt('この地点を分岐点として記録し、今の内容から新しい版を作ります。\n版の名前（例: 主人公が死ぬ版）');
      if (name) actions.createVersion(name, node.id);
    });

    li.append(dot, label, version, from, to, restore, branch);
    list.append(li);
  }

  graph.append(list);
  root.append(graph);
  return root;
}

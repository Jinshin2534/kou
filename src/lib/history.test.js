import { describe, it, expect } from 'vitest';
import { ancestry, chaptersAt, buildGraph } from './history.js';

const commits = [
  { id: 'c1', versionId: 'main', message: '初稿', parentId: null, createdAt: 100, chapters: { ch1: { title: '第一章', text: '最初の本文' } } },
  { id: 'c2', versionId: 'main', message: '第一章を推敲', parentId: 'c1', createdAt: 200, chapters: { ch1: { title: '第一章', text: '直した本文' } } },
  { id: 'c3', versionId: 'main', message: '第二章を追加', parentId: 'c2', createdAt: 300, chapters: { ch2: { title: '第二章', text: '第二章の本文' } } },
  { id: 'c4', versionId: 'alt', message: '別展開を試す', parentId: 'c2', createdAt: 400, chapters: { ch1: { title: '第一章', text: '別展開の本文' } } },
];

describe('ancestry', () => {
  it('head から根まで順に返す', () => {
    expect(ancestry(commits, 'c3').map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('分岐した枝は分岐点を経由して根に至る', () => {
    expect(ancestry(commits, 'c4').map((c) => c.id)).toEqual(['c4', 'c2', 'c1']);
  });

  it('存在しない id は空配列', () => {
    expect(ancestry(commits, 'zzz')).toEqual([]);
  });
});

describe('chaptersAt', () => {
  it('祖先を根から順に適用した状態を返す', () => {
    expect(chaptersAt(commits, 'c3')).toEqual({
      ch1: { title: '第一章', text: '直した本文' },
      ch2: { title: '第二章', text: '第二章の本文' },
    });
  });

  it('分岐した枝では分岐後の変更だけが乗る', () => {
    expect(chaptersAt(commits, 'c4')).toEqual({
      ch1: { title: '第一章', text: '別展開の本文' },
    });
  });

  it('最初のコミットではその内容だけ', () => {
    expect(chaptersAt(commits, 'c1')).toEqual({
      ch1: { title: '第一章', text: '最初の本文' },
    });
  });
});

describe('buildGraph', () => {
  it('新しい順に row を振る', () => {
    const { nodes } = buildGraph(commits);
    expect(nodes.map((n) => n.id)).toEqual(['c4', 'c3', 'c2', 'c1']);
    expect(nodes.map((n) => n.row)).toEqual([0, 1, 2, 3]);
  });

  it('版ごとに lane を分ける', () => {
    const { nodes, laneCount } = buildGraph(commits);
    expect(laneCount).toBe(2);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.lane]));
    expect(byId.c4).not.toBe(byId.c3);
    expect(byId.c3).toBe(byId.c2);
  });

  it('コミットが無ければ空', () => {
    expect(buildGraph([])).toEqual({ nodes: [], laneCount: 0 });
  });
});

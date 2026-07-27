import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalStore } from './local.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

let store;
let seq;

beforeEach(() => {
  seq = 0;
  store = createLocalStore({
    storage: memoryStorage(),
    now: () => 1000 + seq,
    uid: () => `id${++seq}`,
  });
});

describe('createWork', () => {
  it('作品と main 版と第一章と初稿を同時に作る', async () => {
    const work = await store.createWork('雨の駅');
    expect(work.title).toBe('雨の駅');

    const versions = await store.listVersions(work.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].name).toBe('main');
    expect(work.currentVersionId).toBe(versions[0].id);

    const chapters = await store.listChapters(work.id, versions[0].id);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('第一章');

    const drafts = await store.listDrafts(work.id, chapters[0].id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe('初稿');
    expect(chapters[0].primaryDraftId).toBe(drafts[0].id);
  });

  it('既定の設定が入る', async () => {
    const work = await store.createWork('雨の駅');
    expect(work.settings.orientation).toBe('vertical');
    expect(work.settings.charsPerLine).toBe(20);
  });
});

describe('章と異稿', () => {
  it('章を追加すると order が増える', async () => {
    const work = await store.createWork('雨の駅');
    await store.createChapter(work.id, work.currentVersionId, '第二章');
    const chapters = await store.listChapters(work.id, work.currentVersionId);
    expect(chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(chapters.map((c) => c.order)).toEqual([0, 1]);
  });

  it('並べ替えができる', async () => {
    const work = await store.createWork('雨の駅');
    const second = await store.createChapter(work.id, work.currentVersionId, '第二章');
    const chapters = await store.listChapters(work.id, work.currentVersionId);
    await store.reorderChapters(work.id, [second.id, chapters[0].id]);
    const after = await store.listChapters(work.id, work.currentVersionId);
    expect(after.map((c) => c.title)).toEqual(['第二章', '第一章']);
  });

  it('本文を保存して読み出せる', async () => {
    const work = await store.createWork('雨の駅');
    const [chapter] = await store.listChapters(work.id, work.currentVersionId);
    await store.updateDraft(work.id, chapter.primaryDraftId, { text: '改札を抜けると' });
    const drafts = await store.listDrafts(work.id, chapter.id);
    expect(drafts[0].text).toBe('改札を抜けると');
  });

  it('異稿を追加できる', async () => {
    const work = await store.createWork('雨の駅');
    const [chapter] = await store.listChapters(work.id, work.currentVersionId);
    await store.createDraft(work.id, chapter.id, { name: 'B 雨に変更', text: '雨だった' });
    const drafts = await store.listDrafts(work.id, chapter.id);
    expect(drafts.map((d) => d.name)).toEqual(['初稿', 'B 雨に変更']);
  });
});

describe('版', () => {
  it('版を切ると章と primary 異稿が複製される', async () => {
    const work = await store.createWork('雨の駅');
    const [chapter] = await store.listChapters(work.id, work.currentVersionId);
    await store.updateDraft(work.id, chapter.primaryDraftId, { text: '元の本文' });

    const alt = await store.createVersion(work.id, {
      fromVersionId: work.currentVersionId,
      name: '主人公が死ぬ版',
      baseCommitId: null,
    });

    const altChapters = await store.listChapters(work.id, alt.id);
    expect(altChapters).toHaveLength(1);
    expect(altChapters[0].id).not.toBe(chapter.id);
    expect(altChapters[0].title).toBe('第一章');

    const altDrafts = await store.listDrafts(work.id, altChapters[0].id);
    expect(altDrafts).toHaveLength(1);
    expect(altDrafts[0].text).toBe('元の本文');
  });

  it('複製後に片方を編集しても他方に影響しない', async () => {
    const work = await store.createWork('雨の駅');
    const [chapter] = await store.listChapters(work.id, work.currentVersionId);
    const alt = await store.createVersion(work.id, {
      fromVersionId: work.currentVersionId,
      name: '別版',
      baseCommitId: null,
    });
    const [altChapter] = await store.listChapters(work.id, alt.id);
    await store.updateDraft(work.id, altChapter.primaryDraftId, { text: '別版の本文' });

    const drafts = await store.listDrafts(work.id, chapter.id);
    expect(drafts[0].text).toBe('');
  });
});

describe('コミット', () => {
  it('コミットを作って一覧できる', async () => {
    const work = await store.createWork('雨の駅');
    const commit = await store.createCommit(work.id, {
      versionId: work.currentVersionId,
      message: '初稿',
      parentId: null,
      chapters: { ch1: { title: '第一章', text: '本文' } },
    });
    const commits = await store.listCommits(work.id);
    expect(commits).toHaveLength(1);
    expect(commits[0].id).toBe(commit.id);
    expect(commits[0].message).toBe('初稿');
  });
});

describe('永続化', () => {
  it('別のストアから同じ storage を読むと復元される', async () => {
    const storage = memoryStorage();
    let n = 0;
    const a = createLocalStore({ storage, now: () => 1, uid: () => `x${++n}` });
    await a.createWork('雨の駅');

    const b = createLocalStore({ storage, now: () => 1, uid: () => `y${++n}` });
    const works = await b.listWorks();
    expect(works.map((w) => w.title)).toEqual(['雨の駅']);
  });

  it('dump と load で往復できる', async () => {
    await store.createWork('雨の駅');
    const dumped = await store.dump();

    const other = createLocalStore({ storage: memoryStorage(), now: () => 1, uid: () => 'z' });
    await other.load(dumped);
    const works = await other.listWorks();
    expect(works.map((w) => w.title)).toEqual(['雨の駅']);
  });
});

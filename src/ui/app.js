import { renderWrite } from './write.js';
import { renderCompare } from './compare.js';
import { renderHistory } from './history-view.js';
import { renderSettings, applySettings } from './settings.js';
import { renderShelf } from './shelf.js';
import { chaptersAt } from '../lib/history.js';

const SCREENS = {
  shelf: renderShelf,
  write: renderWrite,
  compare: renderCompare,
  history: renderHistory,
  settings: renderSettings,
};
const SAVE_DELAY = 600;

export function createApp(store) {
  let saveTimer = null;
  let pending = null;

  const state = {
    screen: 'write',
    workId: null,
    versionId: null,
    chapterId: null,
    draftId: null,
    focusMode: true,
    typewriter: true,
    saveState: 'saved',
    compare: { source: 'drafts', leftId: null, rightId: null, choices: {} },
  };

  let root = null;
  let data = { works: [], work: null, versions: [], chapters: [], drafts: [], commits: [] };

  async function reload() {
    data.works = await store.listWorks();
    if (!state.workId) return;
    data.work = await store.getWork(state.workId);
    data.versions = await store.listVersions(state.workId);
    state.versionId = state.versionId ?? data.work.currentVersionId;
    data.chapters = await store.listChapters(state.workId, state.versionId);
    if (!data.chapters.some((c) => c.id === state.chapterId)) {
      state.chapterId = data.chapters[0]?.id ?? null;
      state.draftId = null;
    }
    data.drafts = state.chapterId ? await store.listDrafts(state.workId, state.chapterId) : [];
    if (!data.drafts.some((d) => d.id === state.draftId)) {
      const chapter = data.chapters.find((c) => c.id === state.chapterId);
      state.draftId = chapter?.primaryDraftId ?? data.drafts[0]?.id ?? null;
    }
    data.commits = await store.listCommits(state.workId);
    if (data.work) applySettings(data.work.settings);
  }

  // data.commits は store から返ってきた挿入順(=作成順)のまま保持される。createdAt は
  // ミリ秒精度しかなく、同一 ms に複数コミットが作られると createdAt だけでの並べ替えは
  // 逆転しうる（Array#sort は安定ソートなので、同着なら元の並び=作成順が保たれる）。
  // そのため「最新」を作成順(配列の末尾)で判定し、誤った親を拾わないようにする。
  function headCommitId() {
    const ours = data.commits.filter((c) => c.versionId === state.versionId);
    return ours.length ? ours[ours.length - 1].id : null;
  }

  let saveListeners = [];

  function render() {
    if (!root) return;
    saveListeners = [];
    const screen = state.workId ? state.screen : 'shelf';
    root.replaceChildren(SCREENS[screen]({ state, data, actions }));
  }

  function notifySaveState() {
    for (const listener of saveListeners) listener(state.saveState);
  }

  // 保存先の id は「書いた時点」のものを握る。書き終えるまでに章や異稿を切り替えられても、
  // 前の章の本文が今の章に書き込まれることがないようにする。
  async function writeText({ workId, chapterId, draftId, text }) {
    if (!draftId) return;
    try {
      state.saveState = 'saving';
      notifySaveState();
      await store.updateDraft(workId, draftId, { text });
      if (chapterId === state.chapterId) {
        const draft = data.drafts.find((d) => d.id === draftId);
        if (draft) draft.text = text;
      }
      state.saveState = 'saved';
    } catch (error) {
      state.saveState = 'failed';
      console.error('保存に失敗しました', error);
    }
    notifySaveState();
  }

  async function flushSave() {
    if (!pending) return;
    const job = pending;
    pending = null;
    clearTimeout(saveTimer);
    saveTimer = null;
    await writeText(job);
  }

  const actions = {
    async newWork(title) {
      await flushSave();
      const work = await store.createWork(title);
      await actions.openWork(work.id);
      state.screen = 'write';
      render();
    },
    async removeWork(workId) {
      await flushSave();
      await store.deleteWork(workId);
      if (state.workId === workId) {
        state.workId = null;
        state.versionId = null;
        state.chapterId = null;
        state.draftId = null;
      }
      await reload();
      render();
    },
    async exportAll() {
      const dumped = await store.dump();
      const blob = new Blob([JSON.stringify(dumped, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kou-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    async importAll(file) {
      await flushSave();
      const text = await file.text();
      await store.load(JSON.parse(text));
      state.workId = null;
      state.versionId = null;
      state.chapterId = null;
      state.draftId = null;
      state.screen = 'shelf';
      await reload();
      render();
    },
    download(filename, content, type = 'text/plain') {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    async exportChaptersMarkdown() {
      // 書架は作品が一つも無いときにも表示されるため、開いている作品が無ければ何もしない。
      if (!state.workId || !data.work) return;
      const parts = [];
      for (const chapter of data.chapters) {
        const drafts = await store.listDrafts(state.workId, chapter.id);
        const primary = drafts.find((d) => d.id === chapter.primaryDraftId);
        parts.push(`# ${chapter.title}\n\n${primary ? primary.text : ''}`);
      }
      actions.download(`${data.work.title}.md`, parts.join('\n\n'), 'text/markdown');
    },
    async importChapterMarkdown(file) {
      await flushSave();
      const raw = (await file.text()).replace(/\r\n/g, '\n');
      const lines = raw.split('\n');
      const title = lines[0].startsWith('# ') ? lines[0].slice(2).trim() : file.name.replace(/\.md$/, '');
      const body = (lines[0].startsWith('# ') ? lines.slice(1) : lines).join('\n').replace(/^\n+/, '');
      const chapter = await store.createChapter(state.workId, state.versionId, title);
      await store.updateDraft(state.workId, chapter.primaryDraftId, { text: body });
      state.chapterId = chapter.id;
      state.draftId = null;
      await reload();
      render();
    },
    async openWork(workId) {
      await flushSave();
      state.workId = workId;
      state.versionId = null;
      state.chapterId = null;
      await reload();
      render();
    },
    async selectChapter(chapterId) {
      await flushSave();
      state.chapterId = chapterId;
      state.draftId = null;
      await reload();
      render();
    },
    async selectDraft(draftId) {
      await flushSave();
      state.draftId = draftId;
      render();
    },
    // 打鍵のたびに呼ばれる。保存先を握ってから遅延させる。
    queueText(text) {
      pending = {
        workId: state.workId,
        chapterId: state.chapterId,
        draftId: state.draftId,
        text,
      };
      state.saveState = 'dirty';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => flushSave(), SAVE_DELAY);
    },
    // 即座に書く。待機中の自動保存は捨てて、渡された内容で上書きする。
    async setText(text) {
      pending = null;
      clearTimeout(saveTimer);
      saveTimer = null;
      await writeText({
        workId: state.workId,
        chapterId: state.chapterId,
        draftId: state.draftId,
        text,
      });
    },
    flushSave,
    onSaveState(listener) {
      saveListeners.push(listener);
    },
    async setScreen(screen) {
      await flushSave();
      if (screen === 'compare') {
        const others = data.drafts.filter((d) => d.id !== state.draftId);
        state.compare = {
          source: 'drafts',
          leftId: others[0]?.id ?? state.draftId,
          rightId: state.draftId,
          choices: {},
        };
      }
      state.screen = screen;
      render();
    },
    setCompare(patch) {
      Object.assign(state.compare, patch);
      render();
    },
    async applyMerge(text) {
      await flushSave();
      if (state.compare.source === 'commits') {
        const draft = await store.createDraft(state.workId, state.chapterId, {
          name: `マージ ${new Date().toLocaleString('ja-JP')}`,
          text,
        });
        state.draftId = draft.id;
      } else {
        const target = state.compare.rightId;
        if (!target) return;
        const current = data.drafts.find((d) => d.id === target);
        // 上書きする前の本文を異稿として残す。取り込みを取り消せる操作にしておく。
        if (current && current.text !== text) {
          await store.createDraft(state.workId, state.chapterId, {
            name: `取り込み前 ${new Date().toLocaleString('ja-JP')}`,
            text: current.text,
          });
        }
        await store.updateDraft(state.workId, target, { text });
        state.draftId = target;
      }
      state.screen = 'write';
      await reload();
      render();
    },
    async compareCommits(leftId, rightId) {
      await flushSave();
      state.compare = { source: 'commits', leftId, rightId, choices: {} };
      state.screen = 'compare';
      render();
    },
    toggleFocus() {
      state.focusMode = !state.focusMode;
      render();
    },
    toggleTypewriter() {
      state.typewriter = !state.typewriter;
      render();
    },
    reload: async () => {
      await reload();
      render();
    },
    // reload() は store から章・異稿を読み直す。直前の入力がまだ保存タイマー待ちのまま
    // reload すると、その未保存分が古いテキストで上書き表示されてしまう。
    // だからここでも flushSave() を最初に呼ぶ（章 id を変えない moveChapter/updateChapter でも同様）。
    async addChapter(title) {
      await flushSave();
      const chapter = await store.createChapter(state.workId, state.versionId, title);
      state.chapterId = chapter.id;
      state.draftId = null;
      await reload();
      render();
    },
    async updateChapter(chapterId, patch) {
      await flushSave();
      await store.updateChapter(state.workId, chapterId, patch);
      await reload();
      render();
    },
    async deleteChapter(chapterId) {
      await flushSave();
      if (data.chapters.length <= 1) return;
      await store.deleteChapter(state.workId, chapterId);
      if (state.chapterId === chapterId) state.chapterId = null;
      await reload();
      render();
    },
    async moveChapter(chapterId, delta) {
      await flushSave();
      const ids = data.chapters.map((c) => c.id);
      const from = ids.indexOf(chapterId);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await store.reorderChapters(state.workId, ids);
      await reload();
      render();
    },
    // 異稿 (draft) の操作。ここも章操作と同じ理由で flushSave() を最初に呼ぶ:
    // reload() が data.drafts を store から読み直すため、保存タイマー待ちの
    // 未保存キー入力があるとそれが古いテキストで上書きされてしまう。
    // 特に addDraft は「今の異稿の text」をコピー元にするので、flush 前だと
    // コピーされる内容が最新のキー入力を欠いた古いものになる。
    async addDraft(name, { copyFromCurrent = true } = {}) {
      await flushSave();
      const current = data.drafts.find((d) => d.id === state.draftId);
      const draft = await store.createDraft(state.workId, state.chapterId, {
        name,
        text: copyFromCurrent && current ? current.text : '',
      });
      state.draftId = draft.id;
      await reload();
      render();
    },
    async renameDraft(draftId, name) {
      await flushSave();
      await store.updateDraft(state.workId, draftId, { name });
      await reload();
      render();
    },
    async deleteDraft(draftId) {
      await flushSave();
      if (data.drafts.length <= 1) return;
      const chapter = data.chapters.find((c) => c.id === state.chapterId);
      if (chapter.primaryDraftId === draftId) {
        const next = data.drafts.find((d) => d.id !== draftId);
        await store.updateChapter(state.workId, chapter.id, { primaryDraftId: next.id });
      }
      await store.deleteDraft(state.workId, draftId);
      if (state.draftId === draftId) state.draftId = null;
      await reload();
      render();
    },
    async setPrimaryDraft(draftId) {
      await flushSave();
      await store.updateChapter(state.workId, state.chapterId, { primaryDraftId: draftId });
      await reload();
      render();
    },
    async commit(message) {
      const head = headCommitId();
      const previous = head ? chaptersAt(data.commits, head) : {};
      const chapters = {};
      for (const chapter of data.chapters) {
        const draft = (await store.listDrafts(state.workId, chapter.id)).find(
          (d) => d.id === chapter.primaryDraftId,
        );
        const snapshot = { title: chapter.title, text: draft ? draft.text : '' };
        const before = previous[chapter.id];
        if (!before || before.title !== snapshot.title || before.text !== snapshot.text) {
          chapters[chapter.id] = snapshot;
        }
      }
      // 結果は state.saveState に載せる。render() で画面が作り直されるため、
      // 呼び出し側が握っている DOM 要素に書いても表示されない。
      if (Object.keys(chapters).length === 0) {
        state.saveState = 'unchanged';
        render();
        return null;
      }
      const commit = await store.createCommit(state.workId, {
        versionId: state.versionId,
        message,
        parentId: head,
        chapters,
      });
      state.saveState = 'committed';
      await reload();
      render();
      return commit;
    },
    async switchVersion(versionId) {
      await flushSave();
      state.versionId = versionId;
      state.chapterId = null;
      state.draftId = null;
      await store.updateWork(state.workId, { currentVersionId: versionId });
      await reload();
      render();
    },
    async createVersion(name, baseCommitId = null) {
      await flushSave();
      const version = await store.createVersion(state.workId, {
        fromVersionId: state.versionId,
        name,
        baseCommitId,
      });
      await actions.switchVersion(version.id);
      return version;
    },
    async updateSettings(patch) {
      await flushSave();
      const settings = { ...data.work.settings, ...patch };
      await store.updateWork(state.workId, { settings });
      await reload();
      render();
    },
    async restore(commitId) {
      await flushSave();
      const snapshot = chaptersAt(data.commits, commitId);
      for (const [chapterId, chapter] of Object.entries(snapshot)) {
        if (!data.chapters.some((c) => c.id === chapterId)) continue;
        await store.createDraft(state.workId, chapterId, {
          name: `復元 ${new Date().toLocaleString('ja-JP')}`,
          text: chapter.text,
        });
      }
      state.screen = 'write';
      await reload();
      render();
    },
  };

  return {
    state,
    data,
    actions,
    store,
    async mount(el) {
      root = el;
      const works = await store.listWorks();
      if (works.length === 0) {
        state.screen = 'shelf';
        await reload();
        render();
        return;
      }
      await actions.openWork(works[0].id);
    },
  };
}

import { renderWrite } from './write.js';
import { renderCompare } from './compare.js';

const SCREENS = { write: renderWrite, compare: renderCompare };
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
  let data = { work: null, versions: [], chapters: [], drafts: [], commits: [] };

  async function reload() {
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
  }

  let saveListeners = [];

  function render() {
    if (!root) return;
    saveListeners = [];
    root.replaceChildren(SCREENS[state.screen]({ state, data, actions }));
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
      if (state.compare.source === 'commits') {
        const draft = await store.createDraft(state.workId, state.chapterId, {
          name: `マージ ${new Date().toLocaleString('ja-JP')}`,
          text,
        });
        state.draftId = draft.id;
      } else {
        await store.updateDraft(state.workId, state.compare.rightId, { text });
        state.draftId = state.compare.rightId;
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
  };

  return {
    state,
    data,
    actions,
    store,
    async mount(el) {
      root = el;
      const works = await store.listWorks();
      const work = works[0] ?? (await store.createWork('無題'));
      await actions.openWork(work.id);
    },
  };
}

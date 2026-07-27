import { renderWrite } from './write.js';

const SCREENS = { write: renderWrite };
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
  };

  let root = null;
  let data = { work: null, versions: [], chapters: [], drafts: [] };

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
      state.screen = screen;
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

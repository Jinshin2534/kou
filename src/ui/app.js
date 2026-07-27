import { renderWrite } from './write.js';

const SCREENS = { write: renderWrite };

export function createApp(store) {
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

  function render() {
    if (!root) return;
    root.replaceChildren(SCREENS[state.screen]({ state, data, actions }));
  }

  const actions = {
    async openWork(workId) {
      state.workId = workId;
      state.versionId = null;
      state.chapterId = null;
      await reload();
      render();
    },
    async selectChapter(chapterId) {
      state.chapterId = chapterId;
      state.draftId = null;
      await reload();
      render();
    },
    async selectDraft(draftId) {
      state.draftId = draftId;
      render();
    },
    async setText(text) {
      state.saveState = 'saving';
      await store.updateDraft(state.workId, state.draftId, { text });
      const draft = data.drafts.find((d) => d.id === state.draftId);
      if (draft) draft.text = text;
      state.saveState = 'saved';
    },
    setScreen(screen) {
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

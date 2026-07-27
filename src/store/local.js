const KEY = 'kou:db';

export const DEFAULT_SETTINGS = {
  orientation: 'vertical',
  fontFamily: 'mincho',
  fontSize: 16,
  lineHeight: 2,
  letterSpacing: 0.05,
  charsPerLine: 20,
  theme: 'light',
};

const EMPTY = { works: [], versions: [], chapters: [], drafts: [], commits: [] };

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function createLocalStore({
  storage = globalThis.localStorage,
  now = Date.now,
  uid = randomId,
} = {}) {
  function read() {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...JSON.parse(raw) };
  }

  function write(db) {
    storage.setItem(KEY, JSON.stringify(db));
  }

  function mutate(fn) {
    const db = read();
    const result = fn(db);
    write(db);
    return result;
  }

  return {
    async listWorks() {
      return read().works.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async getWork(workId) {
      return read().works.find((w) => w.id === workId) ?? null;
    },

    async createWork(title) {
      return mutate((db) => {
        const work = {
          id: uid(),
          title,
          createdAt: now(),
          updatedAt: now(),
          currentVersionId: null,
          settings: { ...DEFAULT_SETTINGS },
        };
        const version = {
          id: uid(),
          workId: work.id,
          name: 'main',
          parentVersionId: null,
          baseCommitId: null,
          createdAt: now(),
        };
        work.currentVersionId = version.id;
        const chapter = {
          id: uid(),
          workId: work.id,
          versionId: version.id,
          title: '第一章',
          order: 0,
          summary: '',
          memo: '',
          primaryDraftId: null,
        };
        const draft = {
          id: uid(),
          workId: work.id,
          chapterId: chapter.id,
          name: '初稿',
          text: '',
          updatedAt: now(),
        };
        chapter.primaryDraftId = draft.id;
        db.works.push(work);
        db.versions.push(version);
        db.chapters.push(chapter);
        db.drafts.push(draft);
        return work;
      });
    },

    async updateWork(workId, patch) {
      return mutate((db) => {
        const work = db.works.find((w) => w.id === workId);
        Object.assign(work, patch, { updatedAt: now() });
        return work;
      });
    },

    async deleteWork(workId) {
      mutate((db) => {
        db.works = db.works.filter((w) => w.id !== workId);
        db.versions = db.versions.filter((v) => v.workId !== workId);
        db.chapters = db.chapters.filter((c) => c.workId !== workId);
        db.drafts = db.drafts.filter((d) => d.workId !== workId);
        db.commits = db.commits.filter((c) => c.workId !== workId);
      });
    },

    async listVersions(workId) {
      return read().versions.filter((v) => v.workId === workId);
    },

    async createVersion(workId, { fromVersionId, name, baseCommitId = null }) {
      return mutate((db) => {
        const version = {
          id: uid(),
          workId,
          name,
          parentVersionId: fromVersionId,
          baseCommitId,
          createdAt: now(),
        };
        db.versions.push(version);

        const source = db.chapters
          .filter((c) => c.workId === workId && c.versionId === fromVersionId)
          .sort((a, b) => a.order - b.order);

        for (const chapter of source) {
          const primary = db.drafts.find((d) => d.id === chapter.primaryDraftId);
          const newChapter = { ...chapter, id: uid(), versionId: version.id, primaryDraftId: null };
          const newDraft = {
            id: uid(),
            workId,
            chapterId: newChapter.id,
            name: primary ? primary.name : '初稿',
            text: primary ? primary.text : '',
            updatedAt: now(),
          };
          newChapter.primaryDraftId = newDraft.id;
          db.chapters.push(newChapter);
          db.drafts.push(newDraft);
        }
        return version;
      });
    },

    async listChapters(workId, versionId) {
      return read()
        .chapters.filter((c) => c.workId === workId && c.versionId === versionId)
        .sort((a, b) => a.order - b.order);
    },

    async createChapter(workId, versionId, title) {
      return mutate((db) => {
        const siblings = db.chapters.filter((c) => c.workId === workId && c.versionId === versionId);
        const chapter = {
          id: uid(),
          workId,
          versionId,
          title,
          order: siblings.length,
          summary: '',
          memo: '',
          primaryDraftId: null,
        };
        const draft = {
          id: uid(),
          workId,
          chapterId: chapter.id,
          name: '初稿',
          text: '',
          updatedAt: now(),
        };
        chapter.primaryDraftId = draft.id;
        db.chapters.push(chapter);
        db.drafts.push(draft);
        return chapter;
      });
    },

    async updateChapter(workId, chapterId, patch) {
      return mutate((db) => {
        const chapter = db.chapters.find((c) => c.id === chapterId);
        Object.assign(chapter, patch);
        return chapter;
      });
    },

    async deleteChapter(workId, chapterId) {
      mutate((db) => {
        db.chapters = db.chapters.filter((c) => c.id !== chapterId);
        db.drafts = db.drafts.filter((d) => d.chapterId !== chapterId);
      });
    },

    async reorderChapters(workId, orderedIds) {
      mutate((db) => {
        orderedIds.forEach((id, index) => {
          const chapter = db.chapters.find((c) => c.id === id);
          if (chapter) chapter.order = index;
        });
      });
    },

    async listDrafts(workId, chapterId) {
      return read().drafts.filter((d) => d.chapterId === chapterId);
    },

    async createDraft(workId, chapterId, { name, text = '' }) {
      return mutate((db) => {
        const draft = { id: uid(), workId, chapterId, name, text, updatedAt: now() };
        db.drafts.push(draft);
        return draft;
      });
    },

    async updateDraft(workId, draftId, patch) {
      return mutate((db) => {
        const draft = db.drafts.find((d) => d.id === draftId);
        Object.assign(draft, patch, { updatedAt: now() });
        return draft;
      });
    },

    async deleteDraft(workId, draftId) {
      mutate((db) => {
        db.drafts = db.drafts.filter((d) => d.id !== draftId);
      });
    },

    async listCommits(workId) {
      return read().commits.filter((c) => c.workId === workId);
    },

    async createCommit(workId, { versionId, message, parentId = null, chapters }) {
      return mutate((db) => {
        const commit = {
          id: uid(),
          workId,
          versionId,
          message,
          parentId,
          createdAt: now(),
          chapters,
        };
        db.commits.push(commit);
        return commit;
      });
    },

    async dump() {
      return read();
    },

    async load(data) {
      write({ ...structuredClone(EMPTY), ...data });
    },
  };
}

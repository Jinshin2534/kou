import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { DEFAULT_SETTINGS } from './local.js';

export function createFirestoreStore(db, uid) {
  const base = ['users', uid];
  const col = (name) => collection(db, ...base, name);
  const ref = (name, id) => doc(db, ...base, name, id);
  const newId = () => doc(col('works')).id;

  async function all(name, ...conditions) {
    const snap = await getDocs(conditions.length ? query(col(name), ...conditions) : col(name));
    return snap.docs.map((d) => d.data());
  }

  return {
    async listWorks() {
      return (await all('works')).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async getWork(workId) {
      const snap = await getDoc(ref('works', workId));
      return snap.exists() ? snap.data() : null;
    },

    async createWork(title) {
      const now = Date.now();
      const work = {
        id: newId(),
        title,
        createdAt: now,
        updatedAt: now,
        currentVersionId: null,
        settings: { ...DEFAULT_SETTINGS },
      };
      const version = {
        id: newId(),
        workId: work.id,
        name: 'main',
        parentVersionId: null,
        baseCommitId: null,
        createdAt: now,
      };
      work.currentVersionId = version.id;
      const chapter = {
        id: newId(),
        workId: work.id,
        versionId: version.id,
        title: '第一章',
        order: 0,
        summary: '',
        memo: '',
        primaryDraftId: null,
      };
      const draft = {
        id: newId(),
        workId: work.id,
        chapterId: chapter.id,
        name: '初稿',
        text: '',
        updatedAt: now,
      };
      chapter.primaryDraftId = draft.id;

      const batch = writeBatch(db);
      batch.set(ref('works', work.id), work);
      batch.set(ref('versions', version.id), version);
      batch.set(ref('chapters', chapter.id), chapter);
      batch.set(ref('drafts', draft.id), draft);
      await batch.commit();
      return work;
    },

    async updateWork(workId, patch) {
      await updateDoc(ref('works', workId), { ...patch, updatedAt: Date.now() });
      return this.getWork(workId);
    },

    async deleteWork(workId) {
      const batch = writeBatch(db);
      batch.delete(ref('works', workId));
      for (const name of ['versions', 'chapters', 'drafts', 'commits']) {
        for (const item of await all(name, where('workId', '==', workId))) {
          batch.delete(ref(name, item.id));
        }
      }
      await batch.commit();
    },

    async listVersions(workId) {
      return all('versions', where('workId', '==', workId));
    },

    async createVersion(workId, { fromVersionId, name, baseCommitId = null }) {
      const now = Date.now();
      const version = {
        id: newId(),
        workId,
        name,
        parentVersionId: fromVersionId,
        baseCommitId,
        createdAt: now,
      };
      const batch = writeBatch(db);
      batch.set(ref('versions', version.id), version);

      const chapters = (
        await all('chapters', where('workId', '==', workId), where('versionId', '==', fromVersionId))
      ).sort((a, b) => a.order - b.order);

      for (const chapter of chapters) {
        const primarySnap = await getDoc(ref('drafts', chapter.primaryDraftId));
        const primary = primarySnap.exists() ? primarySnap.data() : { name: '初稿', text: '' };
        const newChapter = { ...chapter, id: newId(), versionId: version.id, primaryDraftId: null };
        const newDraft = {
          id: newId(),
          workId,
          chapterId: newChapter.id,
          name: primary.name,
          text: primary.text,
          updatedAt: now,
        };
        newChapter.primaryDraftId = newDraft.id;
        batch.set(ref('chapters', newChapter.id), newChapter);
        batch.set(ref('drafts', newDraft.id), newDraft);
      }
      await batch.commit();
      return version;
    },

    async listChapters(workId, versionId) {
      return (
        await all('chapters', where('workId', '==', workId), where('versionId', '==', versionId))
      ).sort((a, b) => a.order - b.order);
    },

    async createChapter(workId, versionId, title) {
      const now = Date.now();
      const siblings = await this.listChapters(workId, versionId);
      const chapter = {
        id: newId(),
        workId,
        versionId,
        title,
        order: siblings.length,
        summary: '',
        memo: '',
        primaryDraftId: null,
      };
      const draft = {
        id: newId(),
        workId,
        chapterId: chapter.id,
        name: '初稿',
        text: '',
        updatedAt: now,
      };
      chapter.primaryDraftId = draft.id;
      const batch = writeBatch(db);
      batch.set(ref('chapters', chapter.id), chapter);
      batch.set(ref('drafts', draft.id), draft);
      await batch.commit();
      return chapter;
    },

    async updateChapter(workId, chapterId, patch) {
      await updateDoc(ref('chapters', chapterId), patch);
      return (await getDoc(ref('chapters', chapterId))).data();
    },

    async deleteChapter(workId, chapterId) {
      const batch = writeBatch(db);
      batch.delete(ref('chapters', chapterId));
      for (const draft of await all('drafts', where('chapterId', '==', chapterId))) {
        batch.delete(ref('drafts', draft.id));
      }
      await batch.commit();
    },

    async reorderChapters(workId, orderedIds) {
      const batch = writeBatch(db);
      orderedIds.forEach((id, order) => batch.update(ref('chapters', id), { order }));
      await batch.commit();
    },

    async listDrafts(workId, chapterId) {
      return all('drafts', where('chapterId', '==', chapterId));
    },

    async createDraft(workId, chapterId, { name, text = '' }) {
      const draft = { id: newId(), workId, chapterId, name, text, updatedAt: Date.now() };
      await setDoc(ref('drafts', draft.id), draft);
      return draft;
    },

    async updateDraft(workId, draftId, patch) {
      await updateDoc(ref('drafts', draftId), { ...patch, updatedAt: Date.now() });
      return (await getDoc(ref('drafts', draftId))).data();
    },

    async deleteDraft(workId, draftId) {
      await deleteDoc(ref('drafts', draftId));
    },

    // ローカル実装は commits を配列に push するだけなので、listCommits は常に
    // 作成順 = createdAt 昇順で返る。app.js の headCommitId() はこの順序に依存して
    // 「最新コミット」を配列末尾として判定している。Firestore の getDocs には
    // orderBy を付けない限り順序保証が無いため、ここで createdAt 昇順に並べ替えて
    // ローカル実装と同じ観測結果にする（brief 原文にはこの sort が無く、そのままでは
    // 版のコミット親子関係が壊れうるバグだったため追加した）。
    async listCommits(workId) {
      return (await all('commits', where('workId', '==', workId))).sort((a, b) => a.createdAt - b.createdAt);
    },

    async createCommit(workId, { versionId, message, parentId = null, chapters }) {
      const commit = {
        id: newId(),
        workId,
        versionId,
        message,
        parentId,
        createdAt: Date.now(),
        chapters,
      };
      await setDoc(ref('commits', commit.id), commit);
      return commit;
    },

    async dump() {
      return {
        works: await all('works'),
        versions: await all('versions'),
        chapters: await all('chapters'),
        drafts: await all('drafts'),
        commits: await all('commits'),
      };
    },

    async load(data) {
      const batch = writeBatch(db);
      for (const name of ['works', 'versions', 'chapters', 'drafts', 'commits']) {
        for (const item of data[name] ?? []) batch.set(ref(name, item.id), item);
      }
      await batch.commit();
    },
  };
}

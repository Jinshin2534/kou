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

const COLLECTIONS = ['works', 'versions', 'chapters', 'drafts', 'commits'];

// Firestore の 1 バッチは 500 書き込みまで。長編ではコミットだけで簡単に超える。
const BATCH_LIMIT = 450;

export function createFirestoreStore(db, uid) {
  const base = ['users', uid];
  const col = (name) => collection(db, ...base, name);
  const ref = (name, id) => doc(db, ...base, name, id);
  const newId = () => doc(col('works')).id;

  // 上限を超える書き込みを分割して流す。分割した時点で全体としては不可分ではないので、
  // 途中で失敗すると一部だけ適用された状態が残る。
  async function runBatched(operations) {
    for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const apply of operations.slice(i, i + BATCH_LIMIT)) apply(batch);
      await batch.commit();
    }
  }

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
      const operations = [(batch) => batch.delete(ref('works', workId))];
      for (const name of ['versions', 'chapters', 'drafts', 'commits']) {
        for (const item of await all(name, where('workId', '==', workId))) {
          operations.push((batch) => batch.delete(ref(name, item.id)));
        }
      }
      await runBatched(operations);
    },

    async listVersions(workId) {
      // Firestore は orderBy が無いと文書 ID 順（＝ランダム）で返る。
      // local 実装は作成順なので、そちらに揃える。
      return (await all('versions', where('workId', '==', workId))).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
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
      // local 実装と同じ規則にする。渡されなかった章を後ろに詰め直し、
      // 知らない id は黙って無視する（batch.update は存在しない文書でバッチ全体を落とす）。
      const chapters = await all('chapters', where('workId', '==', workId));
      const byId = new Map(chapters.map((c) => [c.id, c]));
      const listed = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      const versionIds = new Set(listed.map((c) => c.versionId));
      const rest = chapters
        .filter((c) => versionIds.has(c.versionId) && !listed.includes(c))
        .sort((a, b) => a.order - b.order);

      const operations = [...listed, ...rest].map(
        (chapter, order) => (batch) => batch.update(ref('chapters', chapter.id), { order }),
      );
      await runBatched(operations);
    },

    async listDrafts(workId, chapterId) {
      return (await all('drafts', where('chapterId', '==', chapterId))).sort(
        (a, b) => a.updatedAt - b.updatedAt,
      );
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
    // いたが、構造的な判定（誰の parentId でもないコミットを HEAD とする）に直したため
    // 順序への依存は無くなった。それでも Firestore の getDocs には orderBy を付けない
    // 限り順序保証が無いため、他の一覧メソッドと同様にここでも並べ替えておく。
    async listCommits(workId) {
      return (await all('commits', where('workId', '==', workId))).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
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
      // local 実装は「置き換え」。合体させると、復元したはずの作品に
      // 復元後に消したものが混ざり、order が衝突して章順が壊れる。
      const current = await this.dump();
      const operations = [];
      for (const name of COLLECTIONS) {
        for (const item of current[name] ?? []) {
          operations.push((batch) => batch.delete(ref(name, item.id)));
        }
      }
      for (const name of COLLECTIONS) {
        for (const item of data[name] ?? []) {
          operations.push((batch) => batch.set(ref(name, item.id), item));
        }
      }
      await runBatched(operations);
    },
  };
}

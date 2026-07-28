import { DEFAULT_SETTINGS } from './defaults.js';

// Supabase 実装。local.js と firestore.js の両方を踏まえて書いた三つ目の実装だが、
// firestore.js は削除されたのでこれが local.js の唯一の相方になる。インターフェースは
// local.js と完全に同一（順序・フィルタ条件・置き換え/合体のセマンティクスまで）に
// 揃える必要がある。camelCase ⇔ snake_case の変換はこのファイルの中だけで完結させ、
// 呼び出し側（src/ui/app.js など）には一切漏らさない。

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// テーブルごとの camelCase(JS 側) ⇔ snake_case(DB 側) 対応表。
// "order" は予約語だが、SQL 上で二重引用符が要るのはマイグレーション側の話であって、
// PostgREST 経由のクエリではただのカラム名として渡せば良い。
const WORK_MAP = {
  id: 'id',
  title: 'title',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  currentVersionId: 'current_version_id',
  settings: 'settings',
};
const VERSION_MAP = {
  id: 'id',
  workId: 'work_id',
  name: 'name',
  parentVersionId: 'parent_version_id',
  baseCommitId: 'base_commit_id',
  createdAt: 'created_at',
};
const CHAPTER_MAP = {
  id: 'id',
  workId: 'work_id',
  versionId: 'version_id',
  title: 'title',
  order: 'order',
  summary: 'summary',
  memo: 'memo',
  primaryDraftId: 'primary_draft_id',
};
const DRAFT_MAP = {
  id: 'id',
  workId: 'work_id',
  chapterId: 'chapter_id',
  name: 'name',
  text: 'text',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};
const COMMIT_MAP = {
  id: 'id',
  workId: 'work_id',
  versionId: 'version_id',
  message: 'message',
  parentId: 'parent_id',
  createdAt: 'created_at',
  chapters: 'chapters',
};

const TABLES = [
  ['works', WORK_MAP],
  ['versions', VERSION_MAP],
  ['chapters', CHAPTER_MAP],
  ['drafts', DRAFT_MAP],
  ['commits', COMMIT_MAP],
];

function fromRow(row, map) {
  const obj = {};
  for (const [camel, snake] of Object.entries(map)) obj[camel] = row[snake];
  return obj;
}

// obj の中で undefined でないキーだけを row に写す（insert 用。全フィールド必須）。
function toRow(obj, map, userId) {
  const row = { user_id: userId };
  for (const [camel, snake] of Object.entries(map)) {
    if (obj[camel] !== undefined) row[snake] = obj[camel];
  }
  return row;
}

// patch の中で渡されたキーだけを row に写す（update 用。渡されなかった列は触らない）。
function patchRow(patch, map) {
  const row = {};
  for (const [camel, snake] of Object.entries(map)) {
    if (patch[camel] !== undefined) row[snake] = patch[camel];
  }
  return row;
}

function check(error) {
  if (error) throw error;
}

export function createSupabaseStore(client, userId, { now = Date.now, uid = randomId } = {}) {
  async function selectAll(table, map, extra) {
    let q = client.from(table).select('*').eq('user_id', userId);
    if (extra) q = extra(q);
    const { data, error } = await q;
    check(error);
    return data.map((row) => fromRow(row, map));
  }

  async function insertOne(table, map, obj) {
    const { data, error } = await client
      .from(table)
      .insert(toRow(obj, map, userId))
      .select()
      .single();
    check(error);
    return fromRow(data, map);
  }

  async function insertMany(table, map, objs) {
    if (objs.length === 0) return [];
    const { data, error } = await client
      .from(table)
      .insert(objs.map((obj) => toRow(obj, map, userId)))
      .select();
    check(error);
    return data.map((row) => fromRow(row, map));
  }

  async function updateOne(table, map, id, patch) {
    const { data, error } = await client
      .from(table)
      .update(patchRow(patch, map))
      .eq('user_id', userId)
      .eq('id', id)
      .select()
      .single();
    check(error);
    return fromRow(data, map);
  }

  async function deleteWhere(table, column, value) {
    const { error } = await client.from(table).delete().eq('user_id', userId).eq(column, value);
    check(error);
  }

  return {
    async listWorks() {
      return selectAll('works', WORK_MAP, (q) => q.order('updated_at', { ascending: false }));
    },

    async getWork(workId) {
      const { data, error } = await client
        .from('works')
        .select('*')
        .eq('user_id', userId)
        .eq('id', workId)
        .maybeSingle();
      check(error);
      return data ? fromRow(data, WORK_MAP) : null;
    },

    async createWork(title) {
      const workId = uid();
      const versionId = uid();
      const chapterId = uid();
      const draftId = uid();
      const t = now();

      const draft = {
        id: draftId,
        workId,
        chapterId,
        name: '初稿',
        text: '',
        createdAt: t,
        updatedAt: t,
      };
      await insertOne('drafts', DRAFT_MAP, draft);

      const chapter = {
        id: chapterId,
        workId,
        versionId,
        title: '第一章',
        order: 0,
        summary: '',
        memo: '',
        primaryDraftId: draftId,
      };
      await insertOne('chapters', CHAPTER_MAP, chapter);

      const version = {
        id: versionId,
        workId,
        name: 'main',
        parentVersionId: null,
        baseCommitId: null,
        createdAt: t,
      };
      await insertOne('versions', VERSION_MAP, version);

      const work = {
        id: workId,
        title,
        createdAt: t,
        updatedAt: t,
        currentVersionId: versionId,
        settings: { ...DEFAULT_SETTINGS },
      };
      return insertOne('works', WORK_MAP, work);
    },

    async updateWork(workId, patch) {
      return updateOne('works', WORK_MAP, workId, { ...patch, updatedAt: now() });
    },

    async deleteWork(workId) {
      await deleteWhere('commits', 'work_id', workId);
      await deleteWhere('drafts', 'work_id', workId);
      await deleteWhere('chapters', 'work_id', workId);
      await deleteWhere('versions', 'work_id', workId);
      await deleteWhere('works', 'id', workId);
    },

    async listVersions(workId) {
      return selectAll('versions', VERSION_MAP, (q) =>
        q.eq('work_id', workId).order('created_at', { ascending: true }),
      );
    },

    async createVersion(workId, { fromVersionId, name, baseCommitId = null }) {
      const version = {
        id: uid(),
        workId,
        name,
        parentVersionId: fromVersionId,
        baseCommitId,
        createdAt: now(),
      };
      const created = await insertOne('versions', VERSION_MAP, version);

      const sourceChapters = await selectAll('chapters', CHAPTER_MAP, (q) =>
        q.eq('work_id', workId).eq('version_id', fromVersionId).order('order', { ascending: true }),
      );

      if (sourceChapters.length > 0) {
        const draftIds = sourceChapters.map((c) => c.primaryDraftId).filter(Boolean);
        const primaries =
          draftIds.length > 0
            ? await selectAll('drafts', DRAFT_MAP, (q) => q.in('id', draftIds))
            : [];
        const primaryById = new Map(primaries.map((d) => [d.id, d]));

        const t = now();
        const newChapters = [];
        const newDrafts = [];
        for (const chapter of sourceChapters) {
          const primary = primaryById.get(chapter.primaryDraftId);
          const newDraftId = uid();
          const newChapterId = uid();
          newDrafts.push({
            id: newDraftId,
            workId,
            chapterId: newChapterId,
            name: primary ? primary.name : '初稿',
            text: primary ? primary.text : '',
            createdAt: t,
            updatedAt: t,
          });
          newChapters.push({
            ...chapter,
            id: newChapterId,
            versionId: created.id,
            primaryDraftId: newDraftId,
          });
        }
        await insertMany('drafts', DRAFT_MAP, newDrafts);
        await insertMany('chapters', CHAPTER_MAP, newChapters);
      }

      return created;
    },

    async listChapters(workId, versionId) {
      return selectAll('chapters', CHAPTER_MAP, (q) =>
        q.eq('work_id', workId).eq('version_id', versionId).order('order', { ascending: true }),
      );
    },

    async createChapter(workId, versionId, title) {
      const siblings = await this.listChapters(workId, versionId);
      const chapterId = uid();
      const draftId = uid();
      const t = now();

      await insertOne('drafts', DRAFT_MAP, {
        id: draftId,
        workId,
        chapterId,
        name: '初稿',
        text: '',
        createdAt: t,
        updatedAt: t,
      });

      return insertOne('chapters', CHAPTER_MAP, {
        id: chapterId,
        workId,
        versionId,
        title,
        order: siblings.length,
        summary: '',
        memo: '',
        primaryDraftId: draftId,
      });
    },

    async updateChapter(workId, chapterId, patch) {
      return updateOne('chapters', CHAPTER_MAP, chapterId, patch);
    },

    async deleteChapter(workId, chapterId) {
      await deleteWhere('drafts', 'chapter_id', chapterId);
      await deleteWhere('chapters', 'id', chapterId);
    },

    async reorderChapters(workId, orderedIds) {
      const chapters = await selectAll('chapters', CHAPTER_MAP, (q) => q.eq('work_id', workId));
      const byId = new Map(chapters.map((c) => [c.id, c]));
      const listed = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      const versionIds = new Set(listed.map((c) => c.versionId));
      const rest = chapters
        .filter((c) => versionIds.has(c.versionId) && !listed.includes(c))
        .sort((a, b) => a.order - b.order);
      const ordered = [...listed, ...rest];
      for (let index = 0; index < ordered.length; index += 1) {
        const chapter = ordered[index];
        if (chapter.order === index) continue;
        const { error } = await client
          .from('chapters')
          .update({ order: index })
          .eq('user_id', userId)
          .eq('id', chapter.id);
        check(error);
      }
    },

    async listDrafts(workId, chapterId) {
      return selectAll('drafts', DRAFT_MAP, (q) =>
        q.eq('chapter_id', chapterId).order('created_at', { ascending: true }),
      );
    },

    async createDraft(workId, chapterId, { name, text = '' }) {
      const t = now();
      return insertOne('drafts', DRAFT_MAP, {
        id: uid(),
        workId,
        chapterId,
        name,
        text,
        createdAt: t,
        updatedAt: t,
      });
    },

    async updateDraft(workId, draftId, patch) {
      return updateOne('drafts', DRAFT_MAP, draftId, { ...patch, updatedAt: now() });
    },

    async deleteDraft(workId, draftId) {
      await deleteWhere('drafts', 'id', draftId);
    },

    async listCommits(workId) {
      return selectAll('commits', COMMIT_MAP, (q) =>
        q.eq('work_id', workId).order('created_at', { ascending: true }),
      );
    },

    async createCommit(workId, { versionId, message, parentId = null, chapters }) {
      return insertOne('commits', COMMIT_MAP, {
        id: uid(),
        workId,
        versionId,
        message,
        parentId,
        createdAt: now(),
        chapters,
      });
    },

    async dump() {
      const [works, versions, chapters, drafts, commits] = await Promise.all([
        selectAll('works', WORK_MAP),
        selectAll('versions', VERSION_MAP),
        selectAll('chapters', CHAPTER_MAP),
        selectAll('drafts', DRAFT_MAP),
        selectAll('commits', COMMIT_MAP),
      ]);
      versions.sort((a, b) => a.createdAt - b.createdAt);
      drafts.sort((a, b) => a.createdAt - b.createdAt);
      return { works, versions, chapters, drafts, commits };
    },

    // local 実装と同じく「置き換え」。合体させると、復元したはずの作品に復元後に
    // 消したものが混ざり、order が衝突して章順が壊れる。
    async load(data) {
      for (const [table] of TABLES) {
        const { error } = await client.from(table).delete().eq('user_id', userId);
        check(error);
      }
      for (const [table, map] of TABLES) {
        const rows = data[table] ?? [];
        if (rows.length === 0) continue;
        const { error } = await client
          .from(table)
          .insert(rows.map((item) => toRow(item, map, userId)));
        check(error);
      }
    },
  };
}

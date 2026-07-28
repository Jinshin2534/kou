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

// store.dump() が返す形の最低限の検証。稿の書き出しでない JSON（別アプリのファイル、
// 空オブジェクト、壊れた構造など）を store.load() にそのまま渡すと、EMPTY とマージされて
// 既存データが黙って空collectionで上書きされる。5つのcollectionが揃って配列であることだけ
// 先に確かめ、それ以外は import 側の警告に任せる。
function isKouDump(data) {
  if (!data || typeof data !== 'object') return false;
  return ['works', 'versions', 'chapters', 'drafts', 'commits'].every((key) => Array.isArray(data[key]));
}

export function createApp(store) {
  let saveTimer = null;
  let pending = null;
  let destroyed = false;
  // 書き込みの発行順に単調増加する連番。updateDraft の Promise は
  // Firestore ではサーバー確認が返るまで解決しない（オフラインでは解決しない）ため、
  // 呼び出し順に解決するとは限らない。古い書き込みが後から解決しても
  // state.saveState / data.drafts を巻き戻さないよう、この連番で
  // 「自分が最後に発行した書き込みか」を判定する。
  let writeSeq = 0;

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

  // data.commits の並び順は store の実装(local=挿入順 / firestore=createdAt順)に
  // よって変わりうるので、それに頼らず構造的に HEAD を決める: この版のコミットのうち
  // 誰の parentId にもなっていないものが HEAD。
  function headCommitId() {
    const ours = data.commits.filter((c) => c.versionId === state.versionId);
    if (!ours.length) return null;
    const parentIds = new Set(ours.map((c) => c.parentId));
    // 誰の parentId でもないコミット（＝葉）が複数あり得る: 同じ head から
    // 2台の端末がそれぞれコミットすると、両方が葉になる（フォーク）。
    // その場合は一番新しいものを HEAD とする。
    const leaves = ours.filter((c) => !parentIds.has(c.id));
    const candidates = leaves.length ? leaves : ours;
    return candidates.reduce((newest, c) => (c.createdAt > newest.createdAt ? c : newest)).id;
  }

  let saveListeners = [];
  let onlineListeners = [];

  function render() {
    if (!root) return;
    saveListeners = [];
    onlineListeners = [];
    const screen = state.workId ? state.screen : 'shelf';
    root.replaceChildren(SCREENS[screen]({ state, data, actions }));
  }

  function notifySaveState() {
    for (const listener of saveListeners) listener(state.saveState);
  }

  // online/offline はページに一つだけ存在すればよいイベントなので、renderWrite の
  // 中で毎レンダー登録する（Task 17 のバグ）のではなく、ここで一度だけ登録し、
  // その時点の購読者リストに配る。destroy() で必ず外す。
  function notifyOnline() {
    for (const listener of onlineListeners) listener(navigator.onLine);
  }
  window.addEventListener('online', notifyOnline);
  window.addEventListener('offline', notifyOnline);

  // 保存先の id は「書いた時点」のものを握る。書き終えるまでに章や異稿を切り替えられても、
  // 前の章の本文が今の章に書き込まれることがないようにする。
  //
  // store.updateDraft の Promise は決して await/control-flow のために使わない
  // （updateDoc はサーバー確認が返るまで解決せず、オフラインでは解決しない —
  // 直列に await すると最初のオフライン書き込みで永遠に詰まり、以降の入力は
  // 揮発性の JS 変数の中に留まったままタブを閉じると消える）。
  // 書き込みは発行した瞬間に data.drafts を同期的に書き換えてしまい、
  // store への反映は完全に投げっぱなしにする。
  function writeText({ workId, chapterId, draftId, text }) {
    if (!draftId) return;
    state.saveState = 'saving';
    notifySaveState();
    if (chapterId === state.chapterId) {
      const draft = data.drafts.find((d) => d.id === draftId);
      if (draft) draft.text = text;
    }
    const seq = ++writeSeq;
    store.updateDraft(workId, draftId, { text }).then(
      () => {
        // 自分より後に発行された書き込みが既にあるなら、遅れて届いたこの結果で
        // saveState を巻き戻さない。
        if (seq !== writeSeq) return;
        state.saveState = 'saved';
        notifySaveState();
      },
      (error) => {
        console.error('保存に失敗しました', error);
        if (seq !== writeSeq) return;
        state.saveState = 'failed';
        notifySaveState();
      },
    );
  }

  // 同期関数。store への書き込みは投げるだけで、完了を待たない。
  // これにより、オフラインで前の保存がサーバー確認待ちのまま詰まっていても、
  // 章の切り替えなどの操作系アクション（先頭で flushSave() を呼ぶ）が
  // ブロックされない。
  function flushSave() {
    if (!pending || destroyed) return;
    const job = pending;
    pending = null;
    clearTimeout(saveTimer);
    saveTimer = null;
    writeText(job);
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
      await flushSave();
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

      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        alert('読み込めませんでした。JSON として壊れています。今のデータはそのままです。');
        return;
      }
      if (!isKouDump(data)) {
        alert('稿の書き出しファイルではないようです。今のデータはそのままです。');
        return;
      }

      // 置き換えに失敗したら元に戻せるよう、直前の状態を控えておく。
      // メモリ上に持っているだけでは、タブを閉じる／クラッシュするとこの控えごと消える。
      // load() 自体は成功したが内容が期待外れだった、というケースでも手動で戻せるよう、
      // 破壊的な置き換えの前にファイルとしても書き出しておく。
      const backup = await store.dump();
      actions.download(
        `kou-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
      );
      state.workId = null;
      state.versionId = null;
      state.chapterId = null;
      state.draftId = null;
      state.screen = 'shelf';
      try {
        await store.load(data);
        await reload();
      } catch (error) {
        await store.load(backup);
        await reload();
        console.error('読み込みに失敗しました', error);
        alert('読み込みに失敗したため、元のデータに戻しました。');
      }
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
      await flushSave();
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
      // Windows(\r\n) と旧 Mac(\r) の改行を落とす。残ると段落末尾に見えない文字が付き、
      // 差分と文字数が狂う。
      const raw = (await file.text()).replace(/\r\n?/g, '\n');
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
    // writeText は同期的に data.drafts を書き換えるので、この関数が返った時点で
    // 呼び出し側は最新のテキストを data.drafts から読める（store への反映は待たない）。
    async setText(text) {
      pending = null;
      clearTimeout(saveTimer);
      saveTimer = null;
      writeText({
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
    onOnline(listener) {
      onlineListeners.push(listener);
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
        // 今開いている章は、直前の書き込みが store にまだ届いていないかもしれない
        // （writeText は投げっぱなしで、完了を待たない）。data.drafts はその書き込みで
        // 既に同期的に書き換わっているので、store から読み直すのではなくそちらを使う。
        // 他の章は data.drafts の入れ物がその章のものではないので、従来通り store から読む。
        const draft =
          chapter.id === state.chapterId
            ? data.drafts.find((d) => d.id === chapter.primaryDraftId)
            : (await store.listDrafts(state.workId, chapter.id)).find(
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
    // ログアウトなど、この app インスタンスを捨てるときに呼ぶ。保留中の自動保存タイマーを
    // 止め、失効したトークンに対して書き込みが飛ばないようにする。window の
    // online/offline リスナーもここで外す（次のログインで新しい app インスタンスが
    // 自分のリスナーを登録するため、外さないと二重に増え続ける）。
    destroy() {
      destroyed = true;
      pending = null;
      clearTimeout(saveTimer);
      saveTimer = null;
      root = null;
      window.removeEventListener('online', notifyOnline);
      window.removeEventListener('offline', notifyOnline);
    },
  };
}

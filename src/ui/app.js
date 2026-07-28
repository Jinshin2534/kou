import { renderWrite } from './write.js';
import { renderCompare } from './compare.js';
import { renderHistory } from './history-view.js';
import { renderSettings, applySettings } from './settings.js';
import { renderShelf } from './shelf.js';
import { renderPreview } from './preview.js';
import { chaptersAt } from '../lib/history.js';
import { detectConflict } from '../lib/conflict.js';
import { countChars } from '../lib/counter.js';

// 保存に失敗した本文の最終退避先。store とは別に、この1件だけを持つ
// （kou:db という別のキーを使うローカル store の保存領域とは衝突しない）。
const RESCUE_KEY = 'kou:rescue';

const SCREENS = {
  shelf: renderShelf,
  write: renderWrite,
  compare: renderCompare,
  history: renderHistory,
  settings: renderSettings,
  preview: renderPreview,
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
  // 異稿ごとに「このセッションで一度、競合チェック（リモート読み取り）をやったか」を
  // 覚えておく。打鍵のたびの自動保存すべてでリモートを読みに行くと、キー入力のたびに
  // Firestore へ読み取りが飛んで自動保存のたびに待たされる（オンライン時）。同じ異稿を
  // 開いたまま書き続ける限り、直前の書き込みが自分自身の履歴になるので毎回確かめる意味が
  // 薄い。reload() で異稿一覧を読み直すたび（章・異稿の切り替えなど）にリセットし、
  // 「この異稿を開いてから最初の保存」でだけ確かめる。
  let conflictCheckedDraftId = null;
  // saveState が 'failed' のまま新たに失敗が続く間、alert() を連発しない。
  let failedAlerted = false;
  // 異稿 id → このクライアントが最後に実際に見た内容（reload() での読み取り、または
  // 自分の書き込みが成功した結果）。競合判定はこれを基準にする。
  //
  // 現在時刻 Date.now() を基準にしてはいけない: 現在時刻は常にリモートの updatedAt
  // 以降なので、detectConflict(local={now}, remote) の結果は必ず「ローカルが新しい」
  // 側に倒れ、`keep: 'remote'` の分岐が構造的に到達不能になる。その状態で判定条件を
  // `verdict.conflicted` まで広げると、リモートと文面が違うだけの通常の自動保存
  // （章を開いて最初の一打鍵など）が毎回「競合」と誤判定され、単独執筆でも
  // 「退避 …」異稿が溜まり続けるバグになる（このパスの修正理由）。
  const baselines = new Map();

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
  let data = {
    works: [],
    work: null,
    versions: [],
    chapters: [],
    drafts: [],
    commits: [],
    // 版 ↔ 版 比較（compare.source === 'versions'）専用のキャッシュ。
    // 章・異稿は state.chapterId に紐づく現在の版のものしか data に読み込まれていないため、
    // 比較対象の2つの版それぞれの章＋主異稿本文をここに読み込んでおく。
    // どの2版分の内容かを leftId/rightId で覚えておき、compare.js は
    // state.compare.leftId/rightId と一致する場合だけこれを使う（一致しなければ読み込み中扱い）。
    compareVersions: null,
  };

  // I6: 書架の各作品行に「総字数」「現在の版」を出すための集計。書架に並ぶ全作品それぞれの
  // 現在の版・各章・その本文異稿を読む必要があるため store 呼び出しが多いが、著者個人の
  // 作品数の規模では許容範囲と判断した。
  async function shelfSummary(work) {
    const versions = await store.listVersions(work.id);
    const currentVersion = versions.find((v) => v.id === work.currentVersionId) ?? null;
    const chapters = currentVersion ? await store.listChapters(work.id, currentVersion.id) : [];
    let totalChars = 0;
    for (const chapter of chapters) {
      const drafts = await store.listDrafts(work.id, chapter.id);
      const primary = drafts.find((d) => d.id === chapter.primaryDraftId);
      if (primary) totalChars += countChars(primary.text);
    }
    return { ...work, totalChars, versionName: currentVersion?.name ?? '' };
  }

  async function reload() {
    const works = await store.listWorks();
    data.works = await Promise.all(works.map((work) => shelfSummary(work)));
    if (!state.workId) return;
    data.work = await store.getWork(state.workId);
    // I7: 別タブでの削除・読み込みなどで、開いていた作品自体が既に無いことがある。
    // ここで書架へフォールバックせずに data.work.currentVersionId を読むと例外になる。
    if (!data.work) {
      state.workId = null;
      state.versionId = null;
      state.chapterId = null;
      state.draftId = null;
      data.versions = [];
      data.chapters = [];
      data.drafts = [];
      data.commits = [];
      return;
    }
    data.versions = await store.listVersions(state.workId);
    state.versionId = state.versionId ?? data.work.currentVersionId;
    data.chapters = await store.listChapters(state.workId, state.versionId);
    if (!data.chapters.some((c) => c.id === state.chapterId)) {
      state.chapterId = data.chapters[0]?.id ?? null;
      state.draftId = null;
    }
    conflictCheckedDraftId = null;
    data.drafts = state.chapterId ? await store.listDrafts(state.workId, state.chapterId) : [];
    // ここで読んだ内容を「最後に見た状態」として基準を更新する。以降の competing 判定は
    // 現在時刻ではなく、この基準と比べる。
    for (const draft of data.drafts) {
      baselines.set(draft.id, { text: draft.text, updatedAt: draft.updatedAt });
    }
    if (!data.drafts.some((d) => d.id === state.draftId)) {
      const chapter = data.chapters.find((c) => c.id === state.chapterId);
      state.draftId = chapter?.primaryDraftId ?? data.drafts[0]?.id ?? null;
    }
    data.commits = await store.listCommits(state.workId);
    applySettings(data.work.settings);
    // I5: フォーカスモード・タイプライターモードは work.settings に永続化される。
    // reload() のたびにここから読み直すことで、設定画面での切り替えとリロード後の
    // 復元の両方をこの一箇所でまかなう。
    state.focusMode = data.work.settings.focusMode ?? true;
    state.typewriter = data.work.settings.typewriter ?? true;
  }

  // 版 ↔ 版 比較用: 指定した版の章一覧を、各章の主異稿の本文つきで読む。
  // 章は order で対応させる（版をまたぐと章 id は複製で変わるため）ので order も持たせる。
  async function resolveVersionChapters(versionId) {
    if (!versionId) return [];
    const chapters = await store.listChapters(state.workId, versionId);
    const result = [];
    for (const chapter of chapters) {
      const drafts = await store.listDrafts(state.workId, chapter.id);
      const primary = drafts.find((d) => d.id === chapter.primaryDraftId);
      result.push({
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        text: primary ? primary.text : '',
      });
    }
    return result;
  }

  async function loadCompareVersions() {
    const { leftId, rightId } = state.compare;
    const [leftChapters, rightChapters] = await Promise.all([
      resolveVersionChapters(leftId),
      resolveVersionChapters(rightId),
    ]);
    data.compareVersions = { leftId, rightId, leftChapters, rightChapters };
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
  // C2: 600ms のデバウンスの間に ⌘W / ⌘R / ラップトップを閉じるなどでタブが閉じられると、
  // それまでの pending な自動保存が飛ばされないまま最後の一文が消える。pagehide は
  // beforeunload と違って BFCache を妨げず、モバイルでも確実に発火する。
  // flushSave() は同期関数（store への書き込みは投げっぱなし）なので、ここで
  // await せずに呼んでも呼び出し元をブロックしない。
  function handlePageHide() {
    flushSave();
  }
  window.addEventListener('pagehide', handlePageHide);

  // 保存先の id は「書いた時点」のものを握る。書き終えるまでに章や異稿を切り替えられても、
  // 前の章の本文が今の章に書き込まれることがないようにする。
  //
  // store.updateDraft の Promise は決して await/control-flow のために使わない
  // （updateDoc はサーバー確認が返るまで解決せず、オフラインでは解決しない —
  // 直列に await すると最初のオフライン書き込みで永遠に詰まり、以降の入力は
  // 揮発性の JS 変数の中に留まったままタブを閉じると消える）。
  // 書き込みは発行した瞬間に data.drafts を同期的に書き換えてしまい、
  // store への反映は完全に投げっぱなしにする。
  // 競合チェック（リモートを読んで、他端末が先に書いていないか確かめる）をしてから
  // 実際の書き込みを投げる。read は Firestore のローカルキャッシュから返るのでオフラインでも
  // すぐ解決する（サーバー確認を待つ write とは違う）ため、await してもここが詰まることはない。
  // この関数自体を await する側は無い（fire-and-forget）ので、conflictCheck に多少
  // 時間がかかっても flushSave() / 呼び出し元をブロックしない。
  // I2: 退避スロットは以前 1 件しか持てなかった（unconditional setItem）ため、2 回目の
  // 失敗が 1 回目の退避を消してしまっていた。draftId をキーにした配列にして、
  // 複数の異稿・複数の失敗をそれぞれ保持する。
  function readRescueList() {
    try {
      const raw = JSON.parse(localStorage.getItem(RESCUE_KEY) ?? 'null');
      if (!raw) return [];
      // 旧形式（単一オブジェクト）が残っていても読めるようにしておく。
      return Array.isArray(raw) ? raw : [raw];
    } catch {
      // 壊れた JSON が入っていた場合はそのまま放置しても実害はない
      // （次回起動時にも同様に無視され、[] 扱いになるだけ）。
      return [];
    }
  }

  function writeRescueList(list) {
    if (list.length === 0) {
      localStorage.removeItem(RESCUE_KEY);
    } else {
      localStorage.setItem(RESCUE_KEY, JSON.stringify(list));
    }
  }

  function clearRescueIfMatches(draftId) {
    try {
      const list = readRescueList();
      const next = list.filter((r) => r.draftId !== draftId);
      if (next.length !== list.length) writeRescueList(next);
    } catch {
      // ここで消せなくても実害はない（残っていれば次回の checkRescue でまた尋ねる）。
    }
  }

  // 保存できなかった本文をこの端末に逃がす。versionId を必ず含める:
  // checkRescue() が復元先の章がまだ存在するか確かめるのに
  // store.listChapters(workId, versionId) が要るため。
  // 同じ draftId の古い退避は新しい内容で置き換える（同じ異稿について複数の
  // 古い退避を積み上げても意味が無いため）。呼び出し側で try/catch すること:
  // ここでの setItem 失敗（さらなる容量超過）が、保存失敗を知らせる alert() の
  // 到達を妨げてはならない（C1）。
  function stashToRescue({ workId, chapterId, draftId, text }) {
    const list = readRescueList().filter((r) => r.draftId !== draftId);
    list.push({ workId, versionId: state.versionId, chapterId, draftId, text, at: Date.now() });
    writeRescueList(list);
  }

  async function writeWithConflictCheck(workId, chapterId, draftId, text) {
    // 基準（このクライアントが最後に見た内容）が無い異稿は、まだ一度も読んだことが
    // 無いので比べようがない。素直に書き込む。
    const baseline = baselines.get(draftId);
    if (baseline && conflictCheckedDraftId !== draftId) {
      conflictCheckedDraftId = draftId;
      try {
        const remote = (await store.listDrafts(workId, chapterId)).find((d) => d.id === draftId);
        const verdict = detectConflict(baseline, remote);
        // 判定は「最後に見た内容」対「今のリモート」。自分の直前の書き込みが
        // 成功していれば baseline はその内容に更新済みなので、通常の自動保存では
        // remote と一致し conflicted にならない。conflicted になるのは、
        // 別の端末がこちらの知らない間に書き込んだときだけ。
        //
        // このアプリの writeText は常に今タイプ中の本文を書き込む（ローカル優先）。
        // keep === 'remote'（＝相手の書き込みの方が新しい）のときだけ、失われる
        // 相手の本文を異稿として残す。keep === 'local' のときは baseline 自体が
        // 相手より新しい＝相手はこちらの内容を既に見ている状態なので、退避は不要。
        if (verdict.conflicted && verdict.keep === 'remote') {
          try {
            await store.createDraft(workId, chapterId, {
              name: `別端末の版 ${new Date().toLocaleString('ja-JP')}`,
              text: remote.text,
            });
          } catch (stashError) {
            // 退避の書き込み自体が失敗した（オフライン等）。ここで諦めると
            // 相手の本文が何にも残らず消えるので、失敗した保存と同じ
            // localStorage の退避経路に落とす。
            console.error('競合した本文の退避に失敗しました', stashError);
            try {
              stashToRescue({ workId, chapterId, draftId, text: remote.text });
            } catch (rescueError) {
              // 退避先の localStorage も書けない（容量超過など）。ここは競合チェック
              // という副次経路なので致命的に扱わず、ログだけ残して本処理を続ける。
              console.error('競合の退避にも失敗しました', rescueError);
            }
          }
        }
      } catch (error) {
        // 競合チェックの読み取り自体が失敗しても（オフラインでキャッシュも無い等）、
        // 本文の保存は諦めずに試みる。
        console.error('競合チェックに失敗しました', error);
      }
    }
    const updated = await store.updateDraft(workId, draftId, { text });
    // 自分の書き込みが成功した内容を新しい基準にする。updatedAt は store が
    // 付けたサーバー/ローカルの値を使う（無ければ Date.now() でフォールバック）。
    baselines.set(draftId, { text, updatedAt: updated?.updatedAt ?? Date.now() });
    // I6: work.updatedAt は本文保存では一切触られていなかったため、書架の「最終更新」も
    // 並び順も執筆量を反映していなかった。ここで touch するが、await はしない
    // （updateWork の確認を待つと、この関数の呼び出し元である writeText の
    // fire-and-forget という前提が崩れ、オフライン時に詰まりかねない）。
    store
      .updateWork(workId, {})
      .catch((error) => console.error('作品の最終更新時刻を更新できませんでした', error));
    return updated;
  }

  function writeText({ workId, chapterId, draftId, text }) {
    if (!draftId) return;
    state.saveState = 'saving';
    notifySaveState();
    if (chapterId === state.chapterId) {
      const draft = data.drafts.find((d) => d.id === draftId);
      if (draft) draft.text = text;
    }
    const seq = ++writeSeq;
    writeWithConflictCheck(workId, chapterId, draftId, text).then(
      () => {
        // 自分より後に発行された書き込みが既にあるなら、遅れて届いたこの結果で
        // saveState を巻き戻さない。
        if (seq !== writeSeq) return;
        state.saveState = 'saved';
        notifySaveState();
        failedAlerted = false;
        // この異稿の分の退避だけ消す。他の異稿の退避が残っていれば触らない
        // （配列に draftId ごとに積んでいるので、無関係な保存成功で他の退避を
        // 消してしまうことはない）。
        clearRescueIfMatches(draftId);
      },
      (error) => {
        console.error('保存に失敗しました', error);
        if (seq !== writeSeq) return;
        state.saveState = 'failed';
        notifySaveState();
        // 書けなかった本文をこの端末に残す。次回起動時に復元を提案する。
        // C1: この setItem 自体が失敗する（例えば容量超過が保存とこの退避の両方の
        // 原因になっている場合）ことがある。その場合でも下の alert() には必ず
        // 到達させる — footer の保存ラベルは write--bare（Esc モード）で隠れるため、
        // ここで知らせ損ねると著者は何も気付けない。
        let rescued = true;
        try {
          stashToRescue({ workId, chapterId, draftId, text });
        } catch (rescueError) {
          rescued = false;
          console.error('退避にも失敗しました', rescueError);
        }
        // 同じ理由でオフラインのまま打鍵が続くと、この then/catch は自動保存のたびに
        // 何度も呼ばれる。毎回 alert() すると入力の邪魔になるので、'failed' に
        // 入った最初の一回だけ知らせる。
        if (!failedAlerted) {
          failedAlerted = true;
          alert(
            rescued
              ? '保存に失敗しました。書いた内容はこの端末に退避しました。通信を確認してください。続けて、念のため全データをJSONで書き出します。'
              : '保存に失敗し、この端末への退避もできませんでした（保存領域の容量が一杯の可能性があります）。続けて、今書けているデータをJSONで書き出しますので、必ず保存してください。',
          );
          // 退避が効かない状況（容量超過など）で著者が唯一頼れる回収手段。
          // exportAll() は store.dump() を読むだけなので、書き込みが失敗する状況でも
          // 動作する見込みが高い。
          actions
            .exportAll()
            .catch((exportError) => console.error('緊急の書き出しにも失敗しました', exportError));
        }
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
    // 比較画面内の「異稿 / コミット / 版」切り替え。既存の setScreen('compare')（常に
    // drafts で開く）・compareCommits（履歴画面から commits で開く）はそのままにし、
    // 画面を出たり入ったりせずに比較の種類だけ変えられるようにする。
    async setCompareSource(source) {
      await flushSave();
      if (source === state.compare.source) return;
      if (source === 'drafts') {
        const others = data.drafts.filter((d) => d.id !== state.draftId);
        state.compare = {
          source: 'drafts',
          leftId: others[0]?.id ?? state.draftId,
          rightId: state.draftId,
          choices: {},
        };
      } else if (source === 'commits') {
        const sorted = [...data.commits].sort((a, b) => b.createdAt - a.createdAt);
        state.compare = {
          source: 'commits',
          leftId: sorted[1]?.id ?? sorted[0]?.id ?? null,
          rightId: sorted[0]?.id ?? null,
          choices: {},
        };
      } else {
        const rightId = state.versionId ?? data.versions[0]?.id ?? null;
        const leftId = data.versions.find((v) => v.id !== rightId)?.id ?? rightId;
        state.compare = { source: 'versions', leftId, rightId, choices: {} };
        await loadCompareVersions();
      }
      render();
    },
    async setCompareVersionSide(side, id) {
      await flushSave();
      state.compare[side === 'left' ? 'leftId' : 'rightId'] = id;
      // ハンクの choices は配列位置なので、左右どちらを変えても対応が崩れる。
      // 版比較では章ごとに choices[order] を持つので、丸ごとリセットして
      // renderVersionsBody 側で章ごとに defaultChoices を作り直させる。
      state.compare.choices = {};
      await loadCompareVersions();
      render();
    },
    // 版 ↔ 版 の「取り込む」。commits モードと同じく、既存の異稿を上書きしない。
    // 選んだ内容を「右側の版」の対応する章に、新しい異稿として追加するだけ。
    async applyVersionMerge(chapterId, text) {
      await flushSave();
      await store.createDraft(state.workId, chapterId, {
        name: `マージ ${new Date().toLocaleString('ja-JP')}`,
        text,
      });
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
    // I5: フォーカスモード・タイプライターモードの切り替えは、以前はこの位置に
    // state だけを書き換える toggleFocus()/toggleTypewriter() があったが、呼び出し元が
    // どこにも無い死んだコードだった（仕様は両方が切り替え可能だと約束している）。
    // 設定画面（settings.js）から updateSettings({ focusMode }) / updateSettings({ typewriter })
    // を直接呼んで work.settings に永続化する形に置き換えたため、単純な toggle アクションは
    // 廃止した（reload() がここから state.focusMode / state.typewriter を復元する）。
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
        // I3: 章が既に削除されていると、以前はここで黙って skip していた。
        // すると、コミットに記録された本文はその章を復元しない限り二度と読めない
        // （restore() 自身がその唯一の手段のはずなのに、それが機能していなかった）。
        // 章が無ければ、そのスナップショットのタイトルで作り直してから復元する。
        let targetChapterId = chapterId;
        if (!data.chapters.some((c) => c.id === chapterId)) {
          const recreated = await store.createChapter(state.workId, state.versionId, chapter.title);
          targetChapterId = recreated.id;
        }
        await store.createDraft(state.workId, targetChapterId, {
          name: `復元 ${new Date().toLocaleString('ja-JP')}`,
          text: chapter.text,
        });
      }
      state.screen = 'write';
      await reload();
      render();
    },
  };

  // 前回、保存に失敗して localStorage に退避した本文があれば復元を提案する。
  // mount() の一番最初でこれをやると、画面がまだ何も描かれていない状態で
  // confirm() のダイアログが出てしまう（著者が何のアプリか分かる前に確認を迫られる）。
  // 初回の render() の後に呼ぶことで、著者は少なくとも一度アプリの画面を見てから
  // ダイアログに向き合える。
  //
  // 「いいえ」を選んだ場合、この場では localStorage から消さない。1回の誤クリックで
  // 復元不能に本文を失わせないため、次回起動時にもう一度尋ねる（＝退避データを
  // 積極的に消すのは「復元した」ときだけ）。
  // I2: 退避スロットは配列（複数件）なので、1件ずつ順に尋ねる。
  async function checkRescue() {
    const list = readRescueList();
    if (list.length === 0) return;
    const remaining = [];
    let changed = false;
    for (const rescue of list) {
      if (
        !confirm(
          `前回、保存できなかった本文があります（${new Date(rescue.at).toLocaleString('ja-JP')}）。異稿として復元しますか`,
        )
      ) {
        // 「いいえ」を選んだ場合、この場では消さない。1回の誤クリックで復元不能に
        // 本文を失わせないため、次回起動時にもう一度尋ねる（＝積極的に消すのは
        // 「復元した」ときだけ）。
        remaining.push(rescue);
        continue;
      }
      try {
        // createDraft は章の存在を検証しない。復元先の章（あるいは作品ごと）が
        // その後に削除されていると、到達不能な孤立異稿を作ったうえで
        // 「復元できた」と誤って報告し、退避データも消してしまう。
        // 先に章がまだ存在するか確かめる。章が無ければ、このエントリは消さずに
        // 残す（I3 の restore() と違い、ここは「見つからなかった」ことをそのまま
        // 伝えるだけに留める — 何の章として作り直すべきか著者の意図が分からないため）。
        const chapters = await store.listChapters(rescue.workId, rescue.versionId);
        if (!chapters.some((c) => c.id === rescue.chapterId)) {
          alert('復元先の章が見つかりませんでした。控えはこの端末に残してあります。');
          remaining.push(rescue);
          continue;
        }
        await store.createDraft(rescue.workId, rescue.chapterId, {
          name: `復旧 ${new Date(rescue.at).toLocaleString('ja-JP')}`,
          text: rescue.text,
        });
        changed = true;
        // 今開いている章の異稿一覧に増えたかもしれないので、見えるように更新する。
        if (rescue.workId === state.workId && rescue.chapterId === state.chapterId) {
          await reload();
        }
      } catch (error) {
        // 復元の書き込み自体が失敗したら、退避データは消さずに残し、次回また尋ねる。
        console.error('退避の復元に失敗しました', error);
        alert('復元に失敗しました。退避した内容はこの端末に残っています。');
        remaining.push(rescue);
      }
    }
    writeRescueList(remaining);
    if (changed) render();
  }

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
      } else {
        await actions.openWork(works[0].id);
      }
      await checkRescue();
    },
    // ログアウトなど、この app インスタンスを捨てるときに呼ぶ。
    // C2: 以前は pending を無条件に捨てており、保存タイマー待ちの入力がログアウトや
    // ページ遷移でそのまま失われていた。まず flushSave() で今保留中の分を送ってから
    // （destroyed はまだ false なので、この flushSave() 自身は握りつぶされない）、
    // 以降の書き込みが飛ばないよう destroyed を立てる。window の online/offline/
    // pagehide リスナーもここで外す（次のログインで新しい app インスタンスが
    // 自分のリスナーを登録するため、外さないと二重に増え続ける）。
    destroy() {
      flushSave();
      destroyed = true;
      pending = null;
      clearTimeout(saveTimer);
      saveTimer = null;
      root = null;
      window.removeEventListener('online', notifyOnline);
      window.removeEventListener('offline', notifyOnline);
      window.removeEventListener('pagehide', handlePageHide);
    },
  };
}

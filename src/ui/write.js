import { countChars, countManuscriptPages } from '../lib/counter.js';
import { renderChapters } from './chapters.js';

const SAVE_LABEL = {
  saved: '保存済み',
  saving: '保存中',
  dirty: '編集中',
  failed: '保存できていません',
  committed: '記録しました',
  unchanged: '前回から変更がありません',
};

export function renderWrite({ state, data, actions }) {
  const chapter = data.chapters.find((c) => c.id === state.chapterId);
  const draft = data.drafts.find((d) => d.id === state.draftId);

  const root = document.createElement('div');
  root.className = 'write';

  const header = document.createElement('div');
  header.className = 'write__header';
  const title = document.createElement('span');
  title.textContent = chapter ? chapter.title : '';
  const meta = document.createElement('span');
  meta.className = 'write__meta';
  // 参照を持っておく。Task 11 で異稿の切り替えが同じ入れ物に入るため、
  // 位置で取りに行くと別の要素に書き込んでしまう。
  const countSpan = document.createElement('span');
  const draftPicker = document.createElement('div');
  draftPicker.className = 'drafts';

  for (const d of data.drafts) {
    const b = document.createElement('button');
    b.className = 'drafts__item' + (d.id === state.draftId ? ' is-current' : '');
    b.textContent = d.name + (chapter && chapter.primaryDraftId === d.id ? '（本文）' : '');
    b.addEventListener('click', () => actions.selectDraft(d.id));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const name = prompt('異稿の名前', d.name);
      if (name) actions.renameDraft(d.id, name);
    });
    draftPicker.append(b);
  }

  const addDraft = document.createElement('button');
  addDraft.className = 'drafts__add';
  addDraft.textContent = '＋書き比べ';
  addDraft.addEventListener('click', () => {
    const name = prompt('異稿の名前', `異稿${data.drafts.length + 1}`);
    if (name) actions.addDraft(name);
  });
  draftPicker.append(addDraft);

  const primaryButton = document.createElement('button');
  primaryButton.className = 'drafts__primary';
  primaryButton.textContent = 'これを本文にする';
  primaryButton.addEventListener('click', () => actions.setPrimaryDraft(state.draftId));
  draftPicker.append(primaryButton);

  meta.append(countSpan, draftPicker);
  header.append(title, meta);

  const toggle = document.createElement('button');
  toggle.className = 'write__toggle';
  toggle.textContent = '章立て';
  toggle.addEventListener('click', () => root.classList.toggle('write--panel'));
  header.prepend(toggle);

  const shelfButton = document.createElement('button');
  shelfButton.className = 'write__toggle';
  shelfButton.textContent = '書架';
  shelfButton.addEventListener('click', () => actions.setScreen('shelf'));
  header.prepend(shelfButton);

  const settingsButton = document.createElement('button');
  settingsButton.className = 'write__toggle';
  settingsButton.textContent = '設定';
  settingsButton.addEventListener('click', () => actions.setScreen('settings'));
  header.prepend(settingsButton);

  const compareButton = document.createElement('button');
  compareButton.className = 'write__toggle';
  compareButton.textContent = '比較';
  compareButton.addEventListener('click', () => actions.setScreen('compare'));
  header.prepend(compareButton);

  const historyButton = document.createElement('button');
  historyButton.className = 'write__toggle';
  historyButton.textContent = '履歴';
  historyButton.addEventListener('click', () => actions.setScreen('history'));
  header.prepend(historyButton);

  const commitButton = document.createElement('button');
  commitButton.className = 'write__toggle';
  commitButton.textContent = '記録する';
  commitButton.addEventListener('click', () => doCommit());
  header.prepend(commitButton);

  const versionPicker = document.createElement('select');
  versionPicker.className = 'write__version';
  for (const v of data.versions) {
    const option = document.createElement('option');
    option.value = v.id;
    option.textContent = v.name;
    option.selected = v.id === state.versionId;
    versionPicker.append(option);
  }
  const newVersion = document.createElement('option');
  newVersion.value = '__new__';
  newVersion.textContent = '＋ 新しい版を切る…';
  versionPicker.append(newVersion);
  versionPicker.addEventListener('change', () => {
    if (versionPicker.value === '__new__') {
      const name = prompt('版の名前（例: 主人公が死ぬ版）');
      if (name) actions.createVersion(name);
      else actions.reload();
      return;
    }
    actions.switchVersion(versionPicker.value);
  });
  header.prepend(versionPicker);

  async function doCommit() {
    await actions.setText(editor.value);
    const message = prompt('何をしたか（例: 第三章 冒頭を雨に変更）');
    if (!message) return;
    await actions.commit(message);
  }

  const editor = document.createElement('textarea');
  editor.className = 'write__editor';
  editor.spellcheck = false;
  editor.value = draft ? draft.text : '';
  editor.setAttribute('aria-label', '本文');

  const stack = document.createElement('div');
  stack.className = 'write__stack';
  const ghost = document.createElement('div');
  ghost.className = 'write__ghost';
  ghost.setAttribute('aria-hidden', 'true');
  stack.append(ghost, editor);

  function paintFocus() {
    if (!state.focusMode) {
      ghost.replaceChildren();
      editor.classList.remove('write__editor--focus');
      return;
    }
    editor.classList.add('write__editor--focus');
    const caret = editor.selectionStart;
    const paragraphs = editor.value.split('\n');
    let pos = 0;
    ghost.replaceChildren(
      ...paragraphs.map((line, i) => {
        const start = pos;
        pos += line.length + 1;
        const el = document.createElement('div');
        el.textContent = line === '' ? '​' : line;
        el.className = caret >= start && caret <= start + line.length ? 'is-current' : '';
        return el;
      }),
    );
    ghost.scrollLeft = editor.scrollLeft;
  }

  const footer = document.createElement('div');
  footer.className = 'write__footer';
  const saveLabel = document.createElement('span');
  footer.append(saveLabel);

  // 同期先が無いときに「オフライン・同期待ち」と出しても意味がないので、
  // ログインしている場合だけ表示する。window の online/offline リスナーは
  // renderWrite (毎レンダー呼ばれる) の中では登録しない — app.js 側で一度だけ
  // 登録し、actions.onOnline 経由でここに届ける。
  if (window.__auth) {
    const online = document.createElement('span');
    online.className = 'write__online';
    const setOnline = (isOnline) => {
      online.textContent = isOnline ? '' : 'オフライン・同期待ち';
    };
    setOnline(navigator.onLine);
    actions.onOnline(setOnline);
    footer.append(online);

    const out = document.createElement('button');
    out.className = 'write__toggle';
    out.textContent = 'ログアウト';
    out.addEventListener('click', () => {
      // I1: オフラインのままログアウトすると、まだサーバーに届いていない書き込みが
      // 認証情報を失った状態で再試行され、拒否されて消える。flushSave() はローカルの
      // 保存キューに投げるだけでオンライン復帰後の再送を保証しない（このアプリの
      // 設計上、書き込みはトークンが有効な間しか成立しない）ので、ここで一度
      // 立ち止まって著者に確認する。
      if (navigator.onLine === false) {
        const proceed = confirm(
          'オフラインです。まだ同期できていない変更はログアウトすると失われる可能性があります。' +
            '先に「全部書き出す（JSON）」で控えを取っておくことをおすすめします。それでもログアウトしますか',
        );
        if (!proceed) return;
      }
      // flushSave() はもう同期関数で store への書き込みを待たないので、
      // ここで待たずに呼んでも直前の入力を投げてから抜けられる（以前は
      // await flushSave() を省いていたため、最大 SAVE_DELAY 分の入力が
      // ログアウトで失われていた）。
      actions.flushSave();
      window.__auth.signOut();
    });
    footer.append(out);
  }

  function updateMeta() {
    const text = editor.value;
    const charsPerLine = data.work.settings.charsPerLine;
    countSpan.textContent = `${countChars(text).toLocaleString()}字 ／ ${countManuscriptPages(text, { charsPerLine })}枚`;
  }

  function paintSaveState() {
    saveLabel.textContent = SAVE_LABEL[state.saveState] ?? '';
  }

  actions.onSaveState(paintSaveState);

  editor.addEventListener('input', () => {
    paintFocus();
    updateMeta();
    actions.queueText(editor.value);
    paintSaveState();
  });

  editor.addEventListener('scroll', () => { ghost.scrollLeft = editor.scrollLeft; });
  // keydown はキーリピート中も飛ぶ。select はドラッグ選択がエディタの外で終わっても飛ぶ。
  // この 2 つが無いと、矢印キー長押しとドラッグ選択で強調が置いていかれる。
  editor.addEventListener('keydown', paintFocus);
  editor.addEventListener('keyup', paintFocus);
  editor.addEventListener('select', paintFocus);
  editor.addEventListener('click', paintFocus);
  editor.addEventListener('focus', paintFocus);

  if (state.typewriter) {
    editor.addEventListener('keyup', () => scrollCaretToCenter(editor));
    editor.addEventListener('click', () => scrollCaretToCenter(editor));
  }

  updateMeta();
  paintSaveState();
  paintFocus();
  root.append(header, stack, footer, renderChapters({ state, data, actions }));

  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    // 変換中の Esc は「変換の取り消し」であって、UI を消す操作ではない。
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      root.classList.toggle('write--bare');
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      doCommit();
    }
  });

  return root;
}

function scrollCaretToCenter(editor) {
  const isVertical = getComputedStyle(editor).writingMode.startsWith('vertical');
  if (isVertical) {
    const center = editor.clientWidth / 2;
    const offset = editor.scrollWidth - editor.scrollLeft;
    if (Math.abs(offset - center) > center / 2) {
      editor.scrollLeft = editor.scrollWidth - center;
    }
    return;
  }
  const ratio = editor.selectionStart / Math.max(1, editor.value.length);
  editor.scrollTop = ratio * editor.scrollHeight - editor.clientHeight / 2;
}

import { countChars, countManuscriptPages } from '../lib/counter.js';
import { renderChapters } from './chapters.js';

const SAVE_LABEL = {
  saved: '保存済み',
  saving: '保存中',
  dirty: '編集中',
  failed: '保存できていません',
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
  const draftName = document.createElement('span');
  draftName.textContent = draft ? draft.name : '';
  meta.append(countSpan, draftName);
  header.append(title, meta);

  const toggle = document.createElement('button');
  toggle.className = 'write__toggle';
  toggle.textContent = '章立て';
  toggle.addEventListener('click', () => root.classList.toggle('write--panel'));
  header.prepend(toggle);

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

  function updateMeta() {
    const text = editor.value;
    countSpan.textContent = `${countChars(text).toLocaleString()}字 ／ ${countManuscriptPages(text)}枚`;
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

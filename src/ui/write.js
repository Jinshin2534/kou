import { countChars, countManuscriptPages } from '../lib/counter.js';

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

  const editor = document.createElement('textarea');
  editor.className = 'write__editor';
  editor.spellcheck = false;
  editor.value = draft ? draft.text : '';
  editor.setAttribute('aria-label', '本文');

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
    updateMeta();
    actions.queueText(editor.value);
    paintSaveState();
  });

  if (state.typewriter) {
    editor.addEventListener('keyup', () => scrollCaretToCenter(editor));
    editor.addEventListener('click', () => scrollCaretToCenter(editor));
  }

  updateMeta();
  paintSaveState();
  root.append(header, editor, footer);
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

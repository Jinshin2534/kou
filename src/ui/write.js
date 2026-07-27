import { countChars, countManuscriptPages } from '../lib/counter.js';

const SAVE_DELAY = 600;

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
  const draftName = document.createElement('span');
  draftName.textContent = draft ? draft.name : '';
  meta.append(document.createElement('span'), draftName);
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
    meta.firstChild.textContent = `${countChars(text).toLocaleString()}字 ／ ${countManuscriptPages(text)}枚`;
  }

  let timer = null;
  editor.addEventListener('input', () => {
    updateMeta();
    state.saveState = 'dirty';
    saveLabel.textContent = '編集中';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await actions.setText(editor.value);
      saveLabel.textContent = '保存済み';
    }, SAVE_DELAY);
  });

  if (state.typewriter) {
    editor.addEventListener('keyup', () => scrollCaretToCenter(editor));
    editor.addEventListener('click', () => scrollCaretToCenter(editor));
  }

  root.classList.toggle('write--focus', state.focusMode);
  updateMeta();
  saveLabel.textContent = '保存済み';
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

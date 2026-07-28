import { splitParagraphs, parseAnnotations } from '../lib/text.js';

export function renderPreview({ state, data, actions }) {
  const chapter = data.chapters.find((c) => c.id === state.chapterId);
  const draft = data.drafts.find((d) => d.id === state.draftId);

  const root = document.createElement('div');
  root.className = 'preview';

  const bar = document.createElement('div');
  bar.className = 'preview__bar';

  const back = document.createElement('button');
  back.textContent = '執筆に戻る';
  back.addEventListener('click', () => actions.setScreen('write'));
  bar.append(back);

  const title = document.createElement('span');
  title.className = 'preview__title';
  title.textContent = chapter ? chapter.title : '';
  bar.append(title);

  root.append(bar);

  const body = document.createElement('div');
  body.className = 'preview__body';

  const text = draft ? draft.text : '';
  for (const line of splitParagraphs(text)) {
    const p = document.createElement('p');
    p.className = 'preview__line';
    if (line === '') {
      // 空行もエディタのゴースト表示と同じく、1行分の場所を占める。
      p.append(document.createTextNode('​'));
    } else {
      for (const token of parseAnnotations(line)) {
        p.append(renderToken(token));
      }
    }
    body.append(p);
  }

  root.append(body);

  const note = document.createElement('p');
  note.className = 'preview__note';
  note.textContent = '記法 — ルビ: ｜黄昏《たそがれ》 ／ 傍点: 《《絶対》》';
  root.append(note);

  return root;
}

function renderToken(token) {
  if (token.type === 'ruby') {
    const ruby = document.createElement('ruby');
    ruby.append(document.createTextNode(token.base));
    const rt = document.createElement('rt');
    rt.textContent = token.ruby;
    ruby.append(rt);
    return ruby;
  }
  if (token.type === 'emphasis') {
    const span = document.createElement('span');
    span.className = 'preview__emphasis';
    span.textContent = token.value;
    return span;
  }
  return document.createTextNode(token.value);
}

export function renderChapters({ state, data, actions }) {
  const panel = document.createElement('aside');
  panel.className = 'chapters';

  const list = document.createElement('ul');
  list.className = 'chapters__list';

  for (const chapter of data.chapters) {
    const li = document.createElement('li');
    li.className = 'chapters__item' + (chapter.id === state.chapterId ? ' is-current' : '');

    const button = document.createElement('button');
    button.className = 'chapters__title';
    button.textContent = chapter.title;
    button.addEventListener('click', () => actions.selectChapter(chapter.id));

    const summary = document.createElement('input');
    summary.className = 'chapters__summary';
    summary.value = chapter.summary;
    summary.placeholder = 'この章で書くこと';
    summary.addEventListener('change', () =>
      actions.updateChapter(chapter.id, { summary: summary.value }),
    );

    const memo = document.createElement('textarea');
    memo.className = 'chapters__memo';
    memo.value = chapter.memo;
    memo.rows = 2;
    memo.placeholder = 'メモ（人物・伏線・書き直したい点）';
    memo.addEventListener('change', () => actions.updateChapter(chapter.id, { memo: memo.value }));

    const tools = document.createElement('div');
    tools.className = 'chapters__tools';
    for (const [label, handler] of [
      ['↑', () => actions.moveChapter(chapter.id, -1)],
      ['↓', () => actions.moveChapter(chapter.id, 1)],
      ['名前', () => {
        const title = prompt('章のタイトル', chapter.title);
        if (title) actions.updateChapter(chapter.id, { title });
      }],
      ['削除', () => {
        if (confirm(`「${chapter.title}」を削除しますか（異稿も消えます）`)) {
          actions.deleteChapter(chapter.id);
        }
      }],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', handler);
      tools.append(b);
    }

    li.append(button, summary, memo, tools);
    list.append(li);
  }

  const add = document.createElement('button');
  add.className = 'chapters__add';
  add.textContent = '章を追加';
  add.addEventListener('click', () => {
    const title = prompt('章のタイトル', `第${data.chapters.length + 1}章`);
    if (title) actions.addChapter(title);
  });

  const importMd = document.createElement('label');
  importMd.className = 'chapters__add';
  importMd.textContent = '.md を章として読み込む';
  const importMdInput = document.createElement('input');
  importMdInput.type = 'file';
  importMdInput.accept = '.md,text/markdown';
  importMdInput.style.display = 'none';
  importMdInput.addEventListener('change', () => {
    const file = importMdInput.files[0];
    if (file) actions.importChapterMarkdown(file);
  });
  importMd.append(importMdInput);

  panel.append(list, add, importMd);
  return panel;
}

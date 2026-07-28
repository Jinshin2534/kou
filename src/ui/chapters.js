export function renderChapters({ state, data, actions }) {
  const panel = document.createElement('aside');
  panel.className = 'chapters';

  const list = document.createElement('ul');
  list.className = 'chapters__list';

  // ドラッグ中の章 id。renderChapters はレンダーのたびに毎回新しく呼ばれ、この変数も
  // そのたびに作り直される（DOM 要素も全部作り直す）ので、前回の render をまたいで
  // 値が残ることはない。
  let draggedId = null;

  function clearDropIndicators() {
    for (const node of list.children) {
      node.classList.remove('is-drop-before', 'is-drop-after');
    }
  }

  for (const chapter of data.chapters) {
    const li = document.createElement('li');
    li.className = 'chapters__item' + (chapter.id === state.chapterId ? ' is-current' : '');

    const handle = document.createElement('span');
    handle.className = 'chapters__handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグして並べ替え';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      draggedId = chapter.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chapter.id);
      li.classList.add('is-dragging');
    });
    handle.addEventListener('dragend', () => {
      draggedId = null;
      li.classList.remove('is-dragging');
      clearDropIndicators();
    });

    li.addEventListener('dragover', (e) => {
      if (!draggedId || draggedId === chapter.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = li.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      clearDropIndicators();
      li.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropIndicators();
      const fromId = draggedId;
      draggedId = null;
      if (!fromId || fromId === chapter.id) return;
      const rect = li.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;

      // moveChapter (↑/↓ボタン) と同じく、必ず全章分の順序リストを組み立てて渡す。
      // store.reorderChapters は部分的なリストも渡されなかった章を末尾に押しやる形で
      // 受け付けるが、そこに頼らずここで完全なリストを作る。
      const ids = data.chapters.map((c) => c.id).filter((id) => id !== fromId);
      const targetIndex = ids.indexOf(chapter.id);
      ids.splice(before ? targetIndex : targetIndex + 1, 0, fromId);
      actions.reorderChapters(ids);
    });

    const button = document.createElement('button');
    button.className = 'chapters__title';
    button.textContent = chapter.title;
    button.addEventListener('click', () => actions.selectChapter(chapter.id));

    const summary = document.createElement('input');
    summary.className = 'chapters__summary';
    summary.value = chapter.summary;
    summary.placeholder = 'この章で書くこと';
    summary.addEventListener('change', () =>
      actions.updateChapterQuiet(chapter.id, { summary: summary.value }),
    );

    const memo = document.createElement('textarea');
    memo.className = 'chapters__memo';
    memo.value = chapter.memo;
    memo.rows = 2;
    memo.placeholder = 'メモ（人物・伏線・書き直したい点）';
    memo.addEventListener('change', () => actions.updateChapterQuiet(chapter.id, { memo: memo.value }));

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
        // I3: 削除された章にひも付くコミット履歴は、その章を復元するまで参照できなく
        // なる（restore() は章が無ければ作り直すようになったが、削除した直後は
        // まだ何も復元していない）。著者が「削除＝記録した過去も一緒に消える」と
        // 誤解しないよう、はっきり書いておく。
        if (
          confirm(
            `「${chapter.title}」を削除しますか（異稿も消えます。この章の記録済みの履歴は、章を復元するまで参照できなくなります）`,
          )
        ) {
          actions.deleteChapter(chapter.id);
        }
      }],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', handler);
      tools.append(b);
    }

    const header = document.createElement('div');
    header.className = 'chapters__header';
    header.append(handle, button);

    li.append(header, summary, memo, tools);
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
  // 「開いている作品を .md で書き出す」の逆の操作だと誤解されないよう明記する
  // （README の説明と同じ文言）。
  importMd.title =
    '章の Markdown インポートはこの逆ではない。読み込んだ1ファイルは常にちょうど1つの新しい章になる（複数章に自動分割されたりはしない）。';
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

export function renderShelf({ data, actions }) {
  const root = document.createElement('div');
  root.className = 'shelf';

  const bar = document.createElement('div');
  bar.className = 'shelf__bar';

  const add = document.createElement('button');
  add.textContent = '新しい作品';
  add.addEventListener('click', () => {
    const title = prompt('作品のタイトル', '無題');
    if (title) actions.newWork(title);
  });

  const markdownButton = document.createElement('button');
  markdownButton.textContent = '開いている作品を .md で書き出す';
  markdownButton.addEventListener('click', () => actions.exportChaptersMarkdown());

  const exportButton = document.createElement('button');
  exportButton.textContent = '全部書き出す（JSON）';
  exportButton.addEventListener('click', () => actions.exportAll());

  const importLabel = document.createElement('label');
  importLabel.className = 'shelf__import';
  importLabel.textContent = '読み込む';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json';
  importInput.addEventListener('change', () => {
    const file = importInput.files[0];
    if (!file) return;
    if (confirm('現在のデータを、読み込んだ内容で置き換えます。よろしいですか')) {
      actions.importAll(file);
    }
  });
  importLabel.append(importInput);

  bar.append(add, markdownButton, exportButton, importLabel);
  root.append(bar);

  const list = document.createElement('ul');
  list.className = 'shelf__list';
  for (const work of data.works) {
    const li = document.createElement('li');
    li.className = 'shelf__item';

    const open = document.createElement('button');
    open.className = 'shelf__title';
    open.textContent = work.title;
    open.addEventListener('click', async () => {
      await actions.openWork(work.id);
      actions.setScreen('write');
    });

    const meta = document.createElement('span');
    meta.className = 'shelf__meta';
    meta.textContent = new Date(work.updatedAt).toLocaleString('ja-JP');

    const remove = document.createElement('button');
    remove.className = 'shelf__remove';
    remove.textContent = '削除';
    remove.addEventListener('click', () => {
      if (confirm(`「${work.title}」を削除します。取り消せません。よろしいですか`)) {
        actions.removeWork(work.id);
      }
    });

    li.append(open, meta, remove);
    list.append(li);
  }
  root.append(list);

  return root;
}

import './style.css';
import { createStore } from './store/index.js';
import { createApp } from './ui/app.js';
import { initFirebase, hasFirebaseConfig } from './auth.js';
import { LOCAL_DB_KEY } from './store/local.js';

const root = document.querySelector('#app');

// I4: hasFirebaseConfig はビルド時に決まる。オーナーが env を設定した瞬間、
// それまで localStorage（kou:db）に溜まっていた原稿が書架から一斉に見えなくなり、
// 戻す手段も無い。Firestore への初回ログインで、ローカルに既存の原稿があり、かつ
// Firestore 側がまだ空（＝取り込み後の再ログインではない）なら、一度だけ取り込みを
// 申し出る。ローカルの控えは削除しない（取り込みに失敗しても手元に残るように）。
async function maybeImportLocalManuscripts(store) {
  let raw;
  try {
    raw = localStorage.getItem(LOCAL_DB_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let localDump;
  try {
    localDump = JSON.parse(raw);
  } catch {
    return;
  }
  if (!localDump || !Array.isArray(localDump.works) || localDump.works.length === 0) return;

  let remoteWorks;
  try {
    remoteWorks = await store.listWorks();
  } catch (error) {
    console.error('Firestore の作品一覧を確認できませんでした', error);
    return;
  }
  if (remoteWorks.length > 0) return;

  if (
    !confirm(
      `この端末にログイン前の原稿が ${localDump.works.length} 件残っています。アカウントに取り込みますか` +
        '（この端末の控えはそのまま残ります）',
    )
  ) {
    return;
  }
  try {
    // store.load() は dump() が返す形をそのまま受け取れる（local と firestore で同形）。
    await store.load(localDump);
  } catch (error) {
    console.error('ローカル原稿の取り込みに失敗しました', error);
    alert('取り込みに失敗しました。この端末の控えはそのまま残っています。');
  }
}

async function start(options) {
  const store = createStore(options);
  if (options.db) await maybeImportLocalManuscripts(store);
  const app = createApp(store);
  window.__app = app;
  app.mount(root);
}

if (!hasFirebaseConfig) {
  start({});
} else {
  const fb = initFirebase();
  window.__auth = fb;
  fb.onChange((user) => {
    if (user) {
      start({ db: fb.db, uid: user.uid });
      return;
    }
    window.__app?.destroy();
    window.__app = undefined;
    root.replaceChildren(loginScreen(fb));
  });
}

function loginScreen(fb) {
  const wrap = document.createElement('div');
  wrap.className = 'login';
  const title = document.createElement('h1');
  title.textContent = '稿';
  const lead = document.createElement('p');
  lead.textContent = '原稿はあなたのアカウントに保存されます。';
  const button = document.createElement('button');
  button.textContent = 'Google でログイン';
  button.addEventListener('click', () => fb.signIn());
  wrap.append(title, lead, button);
  return wrap;
}

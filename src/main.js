import './style.css';
import { createStore } from './store/index.js';
import { createApp } from './ui/app.js';
import { initSupabase, hasSupabaseConfig } from './auth.js';
import { LOCAL_DB_KEY } from './store/local.js';

const root = document.querySelector('#app');

// I4: hasSupabaseConfig はビルド時に決まる。オーナーが env を設定した瞬間、
// それまで localStorage（kou:db）に溜まっていた原稿が書架から一斉に見えなくなり、
// 戻す手段も無い。Supabase への初回ログインで、ローカルに既存の原稿があり、かつ
// Supabase 側がまだ空（＝取り込み後の再ログインではない）なら、一度だけ取り込みを
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
    console.error('Supabase の作品一覧を確認できませんでした', error);
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
    // store.load() は dump() が返す形をそのまま受け取れる（local と supabase で同形）。
    await store.load(localDump);
  } catch (error) {
    console.error('ローカル原稿の取り込みに失敗しました', error);
    alert('取り込みに失敗しました。この端末の控えはそのまま残っています。');
  }
}

async function start(options) {
  const store = createStore(options);
  if (options.client) await maybeImportLocalManuscripts(store);
  const app = createApp(store);
  window.__app = app;
  app.mount(root);
}

if (!hasSupabaseConfig) {
  start({});
} else {
  const sb = initSupabase();
  window.__auth = sb;
  sb.onChange((user) => {
    if (user) {
      start({ client: sb.client, uid: user.id });
      return;
    }
    window.__app?.destroy();
    window.__app = undefined;
    root.replaceChildren(loginScreen(sb));
  });
}

function loginScreen(sb) {
  const wrap = document.createElement('div');
  wrap.className = 'login';
  const title = document.createElement('h1');
  title.textContent = '稿';
  const lead = document.createElement('p');
  lead.textContent = '原稿はあなたのアカウントに保存されます。メールアドレスにログイン用リンクを送ります。';

  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'email';
  input.required = true;
  input.placeholder = 'you@example.com';
  input.autocomplete = 'email';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'ログインリンクを送る';
  const status = document.createElement('p');
  status.className = 'login__status';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    button.disabled = true;
    status.textContent = '送信しています…';
    try {
      const { error } = await sb.signIn(email);
      if (error) throw error;
      status.textContent = `${email} 宛にログイン用リンクを送りました。メールを確認してください。`;
      form.replaceChildren();
    } catch (error) {
      console.error('ログインリンクの送信に失敗しました', error);
      status.textContent = '送信に失敗しました。しばらくしてから試してください。';
      button.disabled = false;
    }
  });

  form.append(input, button);
  wrap.append(title, lead, form, status);
  return wrap;
}

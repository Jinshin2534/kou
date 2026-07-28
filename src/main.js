import './style.css';
import { createStore } from './store/index.js';
import { createApp } from './ui/app.js';
import { initFirebase, hasFirebaseConfig } from './auth.js';

const root = document.querySelector('#app');

function start(options) {
  const app = createApp(createStore(options));
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

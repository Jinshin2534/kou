import './style.css';
import { createStore } from './store/index.js';
import { createApp } from './ui/app.js';

const app = createApp(createStore());
window.__app = app;
app.mount(document.querySelector('#app'));

import { createLocalStore } from './local.js';
import { createFirestoreStore } from './firestore.js';
import { DEFAULT_SETTINGS } from './defaults.js';

// 既存の import 元（src/main.js など）が `from './store/index.js'` のまま
// 動き続けるよう re-export しておく。実体は defaults.js（循環import回避のため）。
export { DEFAULT_SETTINGS };

export function createStore({ db = null, uid = null } = {}) {
  if (db && uid) return createFirestoreStore(db, uid);
  return createLocalStore();
}

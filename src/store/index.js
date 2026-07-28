import { createLocalStore } from './local.js';
import { createFirestoreStore } from './firestore.js';

export { DEFAULT_SETTINGS } from './local.js';

export function createStore({ db = null, uid = null } = {}) {
  if (db && uid) return createFirestoreStore(db, uid);
  return createLocalStore();
}

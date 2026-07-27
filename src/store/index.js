import { createLocalStore } from './local.js';

export { DEFAULT_SETTINGS } from './local.js';

export function createStore() {
  return createLocalStore();
}

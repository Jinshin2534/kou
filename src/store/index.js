import { createLocalStore } from './local.js';
import { createSupabaseStore } from './supabase.js';
import { DEFAULT_SETTINGS } from './defaults.js';

// 既存の import 元（src/main.js など）が `from './store/index.js'` のまま
// 動き続けるよう re-export しておく。実体は defaults.js（循環import回避のため）。
export { DEFAULT_SETTINGS };

export function createStore({ client = null, uid = null } = {}) {
  if (client && uid) return createSupabaseStore(client, uid);
  return createLocalStore();
}

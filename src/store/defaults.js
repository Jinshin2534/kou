// local / supabase の両実装、および新規作品作成時の既定値。ここに置くのは、
// local.js だけの持ち物にすると supabase.js がストレージ実装から設定の既定値を
// 拝借する形になってしまうため（本来は無関係なはず）。index.js からも参照するが、
// index.js は local.js / supabase.js を import するため、そちら側に置くと
// 循環importになる。
export const DEFAULT_SETTINGS = {
  orientation: 'vertical',
  fontFamily: 'mincho',
  fontSize: 16,
  lineHeight: 2,
  letterSpacing: 0.05,
  charsPerLine: 20,
  theme: 'light',
  focusMode: true,
  typewriter: true,
};

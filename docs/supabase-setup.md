# Supabase セットアップ手順

`.env.local`（または `VITE_SUPABASE_*` 環境変数）が無ければアプリは今まで通り
localStorage のみで動く。以下は Supabase 同期を有効にしたい場合だけ必要。

## 現在の状態

- Supabase プロジェクト `vlrtnkfxpqurtgpqivil`（東京リージョン）を既に作成し、
  `supabase link` で紐付け済み。
- スキーマは [`supabase/migrations/20260728000000_init.sql`](../supabase/migrations/20260728000000_init.sql)
  として適用済み。`works` / `versions` / `chapters` / `drafts` / `commits` の 5 テーブル、
  それぞれ `user_id uuid references auth.users` を持ち、行単位のセキュリティ（RLS）で
  自分の行しか読み書きできない。id はクライアント側で採番した文字列をそのまま主キーに使う
  （`src/store/local.js` と同じ採番方式）。
- `@supabase/supabase-js` はインストール済み。`src/store/supabase.js` が
  `createSupabaseStore(client, userId)` として `src/store/local.js` と同じインターフェースを
  実装している。
- ログインはマジックリンク（メールにログイン用リンクを送る）方式。Google などの OAuth は
  コンソールでの追加設定が要るため使っていない。

## ゼロから再現する場合

### 1. Supabase プロジェクトを作る

https://supabase.com/dashboard で新規プロジェクトを作成する（リージョンは近い場所、
例えば東京 `ap-northeast-1` を選ぶ）。

### 2. CLI をリンクする

```bash
supabase login
supabase link --project-ref <project-ref>
```

### 3. マイグレーションを適用する

```bash
supabase db push
```

`supabase/migrations/20260728000000_init.sql` の内容（テーブル定義・インデックス・RLS
ポリシー）がそのまま反映される。

### 4. Authentication でメールログインを有効にする

Supabase ダッシュボードの Authentication → Providers → Email は既定で有効。
Authentication → URL Configuration で Site URL / Redirect URLs に、開発用の
`http://localhost:5320` と、デプロイ先のドメイン（Vercel など）を追加しておく
（マジックリンクのリダイレクト先として使われる）。

### 5. API キーを取得し `.env.local` に書く

プロジェクト設定 → API から `Project URL` と `anon public` キーを取得し、
`kou/.env.example` と同じキー名で `kou/.env.local` に書く
（このファイルは `.gitignore` 済みで git に入らないので、各人が自分で作る）。

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

CLI からも取得できる:

```bash
supabase projects api-keys --project-ref <project-ref>
```

### 6. 動作確認

`pnpm dev` して `http://localhost:5320/` を開く。

1. ログイン画面が出て、メールアドレスの入力を求められる
2. メールアドレスを送信すると「ログイン用リンクを送りました」の表示に変わる
3. 受信したメールのリンクを開くとログインし、書架または執筆画面が出る
4. 本文を書いて再読み込みしても残る
5. Supabase ダッシュボードの Table Editor で `drafts` などに行が入っているのが見える
6. 別のブラウザで同じメールアドレスにログインすると、同じ原稿が見える

## 既知の注意点

- `src/store/supabase.js` の版分岐（`createVersion`）・作品削除（`deleteWork`）・
  JSON 読み込み（`load`）は複数の insert/delete を順番に投げるだけで、単一トランザクションに
  包んでいない。途中で失敗すると一部だけ適用された状態が残りうる。
- `createChapter` の章順（`order`）割り当てと `reorderChapters` は
  read → write の間に別クライアントの書き込みが挟まるとレースが起きうる
  （トランザクション化していない）。同時編集を想定するなら対応を検討すること。
- 競合解決（同じドラフトを複数端末で編集した場合のスタッシュ／マージ UI）は
  `src/ui/app.js` 側の責務で、baselines マップに基づく判定を使う（クロックには依存しない）。
- `src/store/supabase.js` は service_role キーを使ったスクリプトで直接検証済み
  （作品作成・版分岐・章並び替え・ドラフト作成・コミット・dump/load の置き換えセマンティクスまで）。
  実際のブラウザからのマジックリンクログイン（メール受信を伴う経路）自体は自動検証していない。

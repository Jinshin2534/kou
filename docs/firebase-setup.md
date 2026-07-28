# Firebase セットアップ手順（プロジェクトオーナー作業）

Task 17 で Firestore ストアと Google ログインのコードは実装済み。ただし実際に
動かすには Firebase プロジェクト側の設定が要る。これは Claude では代行できない
（Firebase コンソールの操作・課金設定・OAuth 同意画面の設定はオーナーの Google
アカウントでの人手作業）ので、ここに手順として残す。

`.env.local`（または `VITE_FIREBASE_*` 環境変数）が無ければアプリは今まで通り
localStorage のみで動く。以下は Firestore 同期を有効にしたい場合だけ必要。

## 1. Firebase プロジェクトを作る

https://console.firebase.google.com/ で新規プロジェクトを作成する。

## 2. Authentication で Google ログインを有効にする

Authentication → Sign-in method → Google を有効化する。

## 3. Firestore を作る（本番モード）

Firestore Database → データベースを作成 → 本番モードを選択する（テストモードは
30日でルールが失効し、その後 `allow read, write: if false` になって書き込めなく
なるので使わない）。リージョンは近い場所を選ぶ。

## 4. セキュリティルールを設定する

Firestore の「ルール」タブに以下を貼り、公開する。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

`kou/src/store/firestore.js` は全データを `users/{uid}/...` 配下に置くので、
このルールで「自分の uid のドキュメントしか読み書きできない」を保証できる。

## 5. ウェブアプリを登録し、設定値を `.env.local` に書く

プロジェクト設定 → マイアプリ → ウェブアプリを追加。表示される `firebaseConfig`
の値を、`kou/.env.example` と同じキー名で `kou/.env.local` に書く（このファイルは
`.gitignore` 済みで git に入らないので、各人が自分で作る）。

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 6. Google 認証の承認済みドメインを確認する

Authentication → Settings → Authorized domains に `localhost` は最初から入って
いる。Vercel などにデプロイしたら、そのドメイン（Task 19 で設定）もここに追加
しないと `signInWithPopup` が失敗する。

## 7. 動作確認

`pnpm dev` して `http://localhost:5320/` を開く。

1. ログイン画面が出る
2. Google でログインすると書架または執筆画面が出る
3. 本文を書いて再読み込みしても残る
4. Firebase コンソールの Firestore に `users/{uid}/drafts` が見える
5. 開発者ツールでネットワークをオフラインにしても書けて、オンラインに戻すと
   同期される（`initializeFirestore` の `persistentLocalCache` によるオフライン
   キャッシュ）
6. 別のブラウザで同じ Google アカウントにログインすると、同じ原稿が見える

## 既知の注意点（Task 17 実装時点でのレビュー結果）

- `listCommits` は `createdAt` 昇順に並べ替えている（`src/store/firestore.js`）。
  同一ミリ秒に複数コミットが作られた場合の順序保証は無いので、Firestore の
  サーバータイムスタンプや単調カウンタへの置き換えは将来の改善候補。
- `createChapter` の章順（`order`）割り当てと `reorderChapters` は
  read → write の間に別クライアントの書き込みが挟まるとレースが起きうる
  （トランザクション化していない）。同時編集を想定するなら Task 18 以降で
  対応を検討すること。
- 競合解決（同じドラフトを複数端末で編集した場合のスタッシュ／マージ UI）は
  Task 18 の範囲。本タスクでは実装していない。

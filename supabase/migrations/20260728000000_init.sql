-- 稿 (kou) のデータ構造。
-- localStorage 実装 (src/store/local.js) と同じ形をそのまま持つ。
-- id はクライアントが採番した文字列をそのまま使う（両実装で id の作り方を変えないため）。

create table if not exists works (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at bigint not null,
  updated_at bigint not null,
  current_version_id text,
  settings jsonb not null default '{}'::jsonb
);

create table if not exists versions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  work_id text not null,
  name text not null,
  parent_version_id text,
  base_commit_id text,
  created_at bigint not null
);

create table if not exists chapters (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  work_id text not null,
  version_id text not null,
  title text not null,
  "order" integer not null,
  summary text not null default '',
  memo text not null default '',
  primary_draft_id text
);

create table if not exists drafts (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  work_id text not null,
  chapter_id text not null,
  name text not null,
  text text not null default '',
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists commits (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  work_id text not null,
  version_id text not null,
  message text not null,
  parent_id text,
  created_at bigint not null,
  chapters jsonb not null default '{}'::jsonb
);

-- 一覧の絞り込みに使う経路だけ張る。
create index if not exists versions_work_idx on versions (user_id, work_id);
create index if not exists chapters_version_idx on chapters (user_id, work_id, version_id, "order");
create index if not exists drafts_chapter_idx on drafts (user_id, chapter_id, created_at);
create index if not exists commits_work_idx on commits (user_id, work_id, created_at);

-- 自分の行だけ読み書きできる。他人の原稿には一切触れない。
alter table works enable row level security;
alter table versions enable row level security;
alter table chapters enable row level security;
alter table drafts enable row level security;
alter table commits enable row level security;

create policy "own works" on works for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own versions" on versions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own chapters" on chapters for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own drafts" on drafts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own commits" on commits for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

# RipPro Judge 仕様書

## 0. 概要

競プロ新歓イベント向けの簡易ジャッジ補助システム。

参加者はWebで問題を確認し、ローカルでC++またはPythonのコードを書く。提出は `npx @rippro/judge@latest` で行う。

CLIはサーバーからテストケースを取得し、参加者PC上で提出コードを実行する。全テストケースに通った場合のみ、CLIがサーバーへAC結果を送信する。

**サーバーは提出コードを実行しない。**

---

## 1. アカウント

### 1.1 ユーザー

```
users
  id           : TEXT, PK              ← 表示名兼ログインID
  passwordHash : TEXT, not null
  createdAt    : TIMESTAMPTZ
```

`users.id` は参加者がログインに使うIDである。ログインは `id + password` で行う。メールアドレスは使わない。

### 1.2 チーム

```
teams
  id             : ULID, PK
  eventId        : TEXT, FK -> events.id
  name           : TEXT, not null
  inviteCodeHash : TEXT, not null
  createdAt      : TIMESTAMPTZ
```

```
teamMembers
  teamId   : ULID, FK -> teams.id
  userId   : TEXT, FK -> users.id
  role     : TEXT    ← "owner" | "member"
  joinedAt : TIMESTAMPTZ

  unique(teamId, userId)
```

---

## 2. CLIトークン

### 2.1 形式

```
rj_live_<base64url 32chars>
```

### 2.2 DB

```
cliTokens
  id         : ULID, PK
  userId     : TEXT, FK -> users.id
  teamId     : ULID, FK -> teams.id
  tokenHash  : TEXT, not null        ← SHA-256(rawToken)
  label      : TEXT
  expiresAt  : TIMESTAMPTZ, nullable
  lastUsedAt : TIMESTAMPTZ, nullable
  createdAt  : TIMESTAMPTZ
  revokedAt  : TIMESTAMPTZ, nullable
```

`tokenHash` にはSHA-256ハッシュを保存する。トークンの平文は発行時に一度だけ表示する。

CLIトークンは必ず特定のチーム・ユーザーに紐づく。イベントの絞り込みは `teamId → teams.eventId` で行う。

### 2.3 サーバー側検証

CLIからのリクエストでは `Authorization: Bearer <token>` 形式でトークンを送る。

サーバー側の検証手順。

```
1. AuthorizationヘッダーからtokenHash = SHA-256(token) を計算する
2. cliTokens.tokenHash を検索する
3. revokedAt IS NULL を確認する
4. expiresAt IS NULL OR expiresAt > now() を確認する
5. 一致した cliToken から userId, teamId を取得する
6. lastUsedAt を更新する
```

無効な場合は `401 Unauthorized` を返す。

---

## 3. イベント・問題・テストケース

### 3.1 イベント

```
events
  id       : TEXT, PK    ← 人間が読めるスラグ (例: rippro-2026-spring)
  isActive : BOOLEAN
  startsAt : TIMESTAMPTZ
  endsAt   : TIMESTAMPTZ
```

### 3.2 問題

```
problems
  eventId          : TEXT, FK -> events.id
  id               : TEXT              ← "001", "002" など。(eventId, id) で一意
  title            : TEXT
  statement        : TEXT
  constraints      : TEXT
  inputFormat      : TEXT
  outputFormat     : TEXT
  allowedLanguages : TEXT[]
  timeLimitMs      : INTEGER
  compareMode      : TEXT
  testcaseVersion  : TEXT              ← 現在の最新バージョン
  isPublished      : BOOLEAN
  createdAt        : TIMESTAMPTZ
  updatedAt        : TIMESTAMPTZ

  primary key(eventId, id)
```

### 3.3 テストケース

```
testcases
  id             : ULID, PK
  eventId        : TEXT
  problemId      : TEXT
  version        : TEXT              ← このケースが属するバージョン (v1, v2 など)
  type           : TEXT              ← "sample" | "hidden"
  input          : TEXT
  expectedOutput : TEXT
  showOnFailure  : BOOLEAN
  orderIndex     : INTEGER
  createdAt      : TIMESTAMPTZ

  foreign key(eventId, problemId) -> problems(eventId, id)
  unique(eventId, problemId, version, orderIndex)
```

`showOnFailure` が `true` の場合、失敗時にCLIへ入力・期待出力を表示してよい。`hidden` ケースでは基本的に `false` にする。

`problems.testcaseVersion` と `testcases.version` の役割の違い。

| フィールド | 意味 |
|---|---|
| `problems.testcaseVersion` | 問題が現在使用しているバージョン。CLIはこれを基準にテストケースを要求する |
| `testcases.version` | 各テストケースが属するバージョン。バージョンごとにケースセットが存在する |

---

## 4. 提出・AC記録

### 4.1 submissions

```
submissions
  id              : ULID, PK
  userId          : TEXT, FK -> users.id
  teamId          : ULID, FK -> teams.id
  eventId         : TEXT
  problemId       : TEXT
  language        : TEXT
  sourceHash      : TEXT              ← SHA-256(source)
  testcaseVersion : TEXT
  status          : TEXT              ← v1では "AC" のみ保存
  maxTimeMs       : INTEGER
  createdAt       : TIMESTAMPTZ

  foreign key(eventId, problemId) -> problems(eventId, id)
```

v1では `status = "AC"` の提出のみサーバーに送信・保存する。WA・TLE・RE・CE・IEはCLI上でのみ表示する。

`sourceHash` にはSHA-256ハッシュを保存する。ソースコード本文は保存しない。

### 4.2 submissionCases

```
submissionCases
  submissionId : ULID, FK -> submissions.id
  caseId       : ULID, FK -> testcases.id
  status       : TEXT
  timeMs       : INTEGER

  primary key(submissionId, caseId)
```

AC時に各テストケースの実行結果を保存する。v1では全ケース `status = "AC"` になる。

### 4.3 solves

```
solves
  teamId       : ULID, FK -> teams.id
  eventId      : TEXT
  problemId    : TEXT
  submissionId : ULID, FK -> submissions.id   ← 最初にACした提出
  solvedAt     : TIMESTAMPTZ

  primary key(teamId, eventId, problemId)
  foreign key(eventId, problemId) -> problems(eventId, id)
```

「チームがその問題を解いた」という状態を表す。同じチームが同じ問題を複数回ACしても `solves` は1件だけ保持する。`submissionId` は最初にACした提出を指す（以降の提出では更新しない）。個人として誰が提出したかは `submissions.userId` に残る。

---

## 5. API

### 5.1 問題設定取得

```
GET /judge/events/:eventId/problems/:problemId/config
Authorization: Bearer <token>
```

サーバー側では、トークンに紐づく `teams.eventId` とURLの `eventId` が一致することを確認する。一致しない場合は `403 Forbidden`。

### 5.2 テストケース取得

```
GET /judge/events/:eventId/problems/:problemId/testcases?version=v1
Authorization: Bearer <token>
```

サーバー側での確認事項。

```
1. トークンが有効である
2. トークンのteamId → teams.eventId がURLのeventIdと一致する
3. eventがactiveである
4. problemが存在する
5. problem.isPublished = true
6. 指定versionが現在のtestcaseVersionと一致する
```

### 5.3 AC提出送信

```
POST /judge/events/:eventId/problems/:problemId/submissions
Authorization: Bearer <token>
```

サーバー側での確認事項。

```
1. トークンが有効である
2. トークンのteamId → teams.eventId がURLのeventIdと一致する
3. eventがactiveである
4. problemが存在する
5. problem.isPublished = true
6. languageがallowedLanguagesに含まれる
7. testcaseVersionがproblem.testcaseVersionと一致する
8. statusがACである
9. casesが対象問題・対象versionのtestcasesと対応している
10. すべてのcase statusがACである
```

問題なければ `submissions`、`submissionCases`、`solves` を作成する。すでに同じチームがその問題を解いている場合も `submissions` は保存する。`solves` は `primary key(teamId, eventId, problemId)` により1件だけ保持する。

---

## 6. CLIフロー

```
1. CLI設定を読み込む (token, eventId)
2. ユーザーが指定したproblemIdを受け取る
3. GET /judge/events/:eventId/problems/:problemId/config を呼ぶ
4. 提出ファイルを確認する (存在確認・拡張子・allowedLanguages)
5. 実行環境を確認する (g++, python3 など)
6. GET /judge/events/:eventId/problems/:problemId/testcases を呼ぶ
7. C++の場合はコンパイルする
8. 各テストケースをローカルで実行する
9. 出力を比較する
10. 全ケースACなら POST /judge/events/:eventId/problems/:problemId/submissions を呼ぶ
11. ACでない場合はローカルに結果を表示するだけでサーバーには送らない
```

---

## 7. 判定ステータス

```
AC  Accepted
WA  Wrong Answer
TLE Time Limit Exceeded
RE  Runtime Error
CE  Compile Error
IE  Internal Error
```

v1ではサーバーに送信される `submissions.status` は `"AC"` のみ。

---

## 8. 出力比較

v1では `trimmed-exact` のみ対応する。

```
actual.trim() === expected.trim()
```

先頭・末尾の空白・改行は無視する。途中の空白や改行の違いは無視しない。

---

## 9. IDまとめ

| テーブル | 型 | 備考 |
|---|---|---|
| `users.id` | TEXT | ログインID兼表示ID |
| `teams.id` | ULID | チームID |
| `events.id` | TEXT | イベントスラグ |
| `problems.id` | TEXT | `(eventId, id)` で一意 |
| `testcases.id` | ULID | テストケースID |
| `cliTokens.id` | ULID | CLIトークン管理用ID |
| `submissions.id` | ULID | 提出ID |

---

## 10. 制約まとめ

```
users
  primary key(id)

teams
  primary key(id)
  foreign key(eventId) -> events(id)

teamMembers
  unique(teamId, userId)
  foreign key(teamId) -> teams(id)
  foreign key(userId) -> users(id)

events
  primary key(id)

problems
  primary key(eventId, id)
  foreign key(eventId) -> events(id)

testcases
  primary key(id)
  unique(eventId, problemId, version, orderIndex)
  foreign key(eventId, problemId) -> problems(eventId, id)

cliTokens
  primary key(id)
  foreign key(userId) -> users(id)
  foreign key(teamId) -> teams(id)

submissions
  primary key(id)
  foreign key(userId) -> users(id)
  foreign key(teamId) -> teams(id)
  foreign key(eventId, problemId) -> problems(eventId, id)

submissionCases
  primary key(submissionId, caseId)
  foreign key(submissionId) -> submissions(id)
  foreign key(caseId) -> testcases(id)

solves
  primary key(teamId, eventId, problemId)
  foreign key(teamId) -> teams(id)
  foreign key(eventId, problemId) -> problems(eventId, id)
  foreign key(submissionId) -> submissions(id)
```
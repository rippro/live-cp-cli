# RipPro Judge 仕様書

## 0. 概要

競プロ新歓イベント向けの簡易ジャッジ補助システム。

参加者はWebで問題を確認し、ローカルでC++またはPythonのコードを書く。提出は `npx @rippro/judge@latest` で行う。

CLIはサーバーからテストケースを取得し、参加者PC上で提出コードを実行する。全テストケースに通った場合のみ、CLIがサーバーへAC結果を送信する。

**サーバーは提出コードを実行しない。**

---

## 1. アカウント・認証

### 1.1 ユーザー

```
users
  id           : TEXT, PK              ← 表示名兼ログインID
  passwordHash : TEXT                  ← scrypt ハッシュ
  createdAt    : TIMESTAMPTZ
```

`users.id` は参加者がログインに使うIDである。ログインは `id + password` で行う。メールアドレスは使わない。

パスワードは scrypt でハッシュして保存する。ハッシュ形式:
```
scrypt$N=4096,r=8,p=1$<salt_base64url>$<hash_base64url>
```

### 1.2 セッション・ロール

ロールは3種類。

| ロール | 認証方法 | 説明 |
|--------|----------|------|
| `admin` | Google OAuth (Firebase Auth) | 全権限 |
| `creator` | Google OAuth (Firebase Auth) | 問題作成・編集 |
| `solver` | userId + password (カスタムセッション) | 参加者 |

admin / creator のセッション:
```
{ role: "admin" | "creator", uid, email, name }
```

solver のセッション:
```
{ role: "solver", userId }
```

### 1.3 チーム

```
teams
  id             : ULID, PK
  eventId        : TEXT, FK -> events.id
  name           : TEXT
  inviteCodeHash : TEXT                ← SHA-256(inviteCode)
  createdAt      : TIMESTAMPTZ
```

```
teamMembers
  teamId   : ULID, FK -> teams.id
  userId   : TEXT, FK -> users.id
  role     : TEXT                      ← "admin" | "creator" | "solver"
  joinedAt : TIMESTAMPTZ

  unique(teamId, userId)
```

招待コードは5文字のCrockford base32（誤読しにくい文字のみ）。チーム作成時に一度だけ表示する。

---

## 2. CLIトークン

### 2.1 形式

```
rj_live_<base64url 32文字>   ← 24バイトのランダム値をbase64urlエンコード
```

### 2.2 DB

```
cliTokens
  id         : ULID, PK
  userId     : TEXT, FK -> users.id
  teamId     : ULID, FK -> teams.id
  tokenHash  : TEXT                    ← SHA-256(rawToken) の hex
  tokenPlain : TEXT, nullable          ← 発行時の平文（setup画面表示用）
  label      : TEXT, nullable
  expiresAt  : TIMESTAMPTZ, nullable
  lastUsedAt : TIMESTAMPTZ, nullable
  createdAt  : TIMESTAMPTZ
  revokedAt  : TIMESTAMPTZ, nullable
```

`tokenHash` の一意性は `_unique` コレクション（`cliTokens:tokenHash:<hash>` をキー）でFirestoreトランザクション内に保証する。

CLIトークンは必ず特定のチーム・ユーザーに紐づく。発行は solver のみ可能（teamMembers.role = "solver" であることを確認）。

### 2.3 サーバー側検証

CLIからのリクエストでは `Authorization: Bearer <token>` 形式でトークンを送る。

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
  isActive : BOOLEAN     ← true = 公開中
```

`isActive = true` のときのみ問題一覧・テストケース取得・提出が可能。

### 3.2 問題

```
problems
  eventId      : TEXT, FK -> events.id
  id           : TEXT              ← 4文字Crockford base32。(eventId, id) で一意
  title        : TEXT
  statement    : TEXT              ← Markdown（サンプル入出力も本文内に記述）
  solutionCode : TEXT              ← 模範解答コード（参加者には非表示）
  timeLimitMs  : INTEGER
  points       : INTEGER           ← デフォルト 100
  compareMode  : TEXT              ← 現在は "trimmed-exact" のみ
  isPublished  : BOOLEAN           ← true のときのみ参加者に表示
  creatorUid   : TEXT, nullable    ← 作成者の uid（admin/creator）
  createdAt    : TIMESTAMPTZ
  updatedAt    : TIMESTAMPTZ

  primary key(eventId, id)
```

Firestoreのドキュメントキーは `{eventId}_{problemId}`（`_` を `__` にエスケープして連結）。

問題IDは自動生成時に誤読しにくい文字のみ（`23456789ABCDEFGHJKMNPQRSTVWXYZ`）の4文字。

### 3.3 テストケース

```
testcases
  id             : ULID, PK
  eventId        : TEXT
  problemId      : TEXT
  input          : TEXT
  expectedOutput : TEXT
  orderIndex     : INTEGER
  createdAt      : TIMESTAMPTZ

  foreign key(eventId, problemId) -> problems(eventId, id)
```

テストケースはすべて hidden 扱い（参加者はCLI経由でも内容を見られない）。サンプル入出力は問題文の Markdown 内に記述する。

---

## 4. 提出・AC記録

### 4.1 submissions

```
submissions
  id         : ULID, PK
  userId     : TEXT, FK -> users.id
  teamId     : ULID, FK -> teams.id
  eventId    : TEXT
  problemId  : TEXT
  sourceHash : TEXT              ← SHA-256(source) の hex
  status     : TEXT              ← "AC" のみ保存
  maxTimeMs  : INTEGER
  createdAt  : TIMESTAMPTZ

  foreign key(eventId, problemId) -> problems(eventId, id)
```

v1では `status = "AC"` の提出のみサーバーに送信・保存する。WA・TLE・RE・CE・IEはCLI上でのみ表示する。

`sourceHash` にはSHA-256ハッシュを保存する。ソースコード本文は保存しない。

### 4.2 submissionCases

```
submissionCases
  submissionId : ULID, FK -> submissions.id
  caseId       : ULID, FK -> testcases.id
  status       : TEXT              ← "AC"
  timeMs       : INTEGER

  primary key(submissionId, caseId)
```

AC時に各テストケースの実行結果を保存する。v1では全ケース `status = "AC"`。

Firestoreのドキュメントキーは `{submissionId}_{caseId}`（`_` を `__` にエスケープして連結）。

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

「チームがその問題を解いた」という状態を表す。同じチームが同じ問題を複数回ACしても `solves` は1件だけ保持する。`submissionId` は最初にACした提出を指す（以降の提出では更新しない）。

Firestoreのドキュメントキーは `{teamId}_{eventId}_{problemId}`（`_` を `__` にエスケープして連結）。

---

## 5. CLI向け API

### 5.1 問題設定取得

```
GET /judge/events/:eventId/problems/:problemId/config
Authorization: Bearer <token>
```

確認事項:
1. トークンが有効
2. トークンの `teamId → teams.eventId` がURLの `eventId` と一致
3. event が `isActive = true`
4. problem が存在し `isPublished = true`

レスポンス:
```json
{
  "eventId": "...",
  "id": "...",
  "title": "...",
  "statement": "...",
  "timeLimitMs": 2000,
  "compareMode": "trimmed-exact"
}
```

### 5.2 テストケース取得

```
GET /judge/events/:eventId/problems/:problemId/testcases
Authorization: Bearer <token>
```

確認事項は5.1と同じ。

レスポンス:
```json
{
  "cases": [
    { "id": "...", "input": "...", "expectedOutput": "...", "orderIndex": 0 }
  ]
}
```

### 5.3 AC提出送信

```
POST /judge/events/:eventId/problems/:problemId/submissions
Authorization: Bearer <token>
```

確認事項:
1. トークンが有効
2. トークンの `teamId → teams.eventId` がURLの `eventId` と一致
3. event が `isActive = true`
4. problem が存在し `isPublished = true`
5. `status` が `"AC"`
6. 全 case の `status` が `"AC"`
7. `cases` が対象問題の全テストケースと過不足なく対応（caseId 照合）

リクエストボディ:
```json
{
  "sourceHash": "<SHA-256 hex>",
  "status": "AC",
  "maxTimeMs": 123,
  "cases": [
    { "caseId": "...", "status": "AC", "timeMs": 45 }
  ]
}
```

レスポンス:
```json
{
  "submissionId": "...",
  "solved": true,
  "solvedAt": "2026-01-01T00:00:00.000Z"
}
```

`solved` は今回の提出でそのチームが初めてACした場合 `true`、既にsolves済みなら `false`。

---

## 6. Web UI向け API（主要エンドポイント）

### イベント

- `GET /api/events` — イベント一覧（`id`, `isActive`）
- `GET /api/events/:eventId` — イベント詳細（+ `problemCount`, `teamCount`）
- `POST /api/admin/events` — イベント作成（admin のみ）
- `PATCH /api/admin/events` — isActive 切替（admin のみ）
- `DELETE /api/admin/events` — イベント削除、関連データ一括削除（admin のみ）

### 問題

- `GET /api/events/:eventId/problems` — 問題一覧（solver は isPublished=true のみ）
- `POST /api/events/:eventId/problems` — 問題作成（admin / creator）
- `POST /api/events/:eventId/problems/bulk` — 問題一括インポート（JSON配列）
- `GET /api/events/:eventId/problems/:problemId` — 問題詳細（admin/creator はテストケースも含む）
- `PATCH /api/events/:eventId/problems/:problemId` — 問題更新（admin / 自分のproblemのcreator）
- `DELETE /api/events/:eventId/problems/:problemId` — 問題削除（admin / 自分のproblemのcreator）

### チーム・CLIトークン

- `GET /api/events/:eventId/teams` — チーム一覧（solveCount, totalPoints 付き、得点降順）
- `POST /api/events/:eventId/teams` — チーム作成（solver のみ）
- `GET /api/events/:eventId/token` — CLIトークン取得（なければ自動発行、solver のみ）

---

## 7. CLIフロー

```
1. CLI設定を読み込む (token, eventId)
2. ユーザーが指定したproblemIdを受け取る
3. GET /judge/events/:eventId/problems/:problemId/config を呼ぶ
4. 提出ファイルを確認する（存在確認・拡張子）
5. 実行環境を確認する (g++, python3 など)
6. GET /judge/events/:eventId/problems/:problemId/testcases を呼ぶ
7. C++の場合はコンパイルする
8. 各テストケースをローカルで実行する
9. 出力を比較する
10. 全ケースACなら POST /judge/events/:eventId/problems/:problemId/submissions を呼ぶ
11. ACでない場合はローカルに結果を表示するだけでサーバーには送らない
```

---

## 8. 判定ステータス

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

## 9. 出力比較

v1では `trimmed-exact` のみ対応。

```
actual.trim() === expected.trim()
```

先頭・末尾の空白・改行は無視する。途中の空白や改行の違いは無視しない。

---

## 10. IDまとめ

| テーブル | 型 | 備考 |
|---|---|---|
| `users.id` | TEXT | ログインID兼表示ID |
| `teams.id` | ULID | Crockford base32、26文字 |
| `events.id` | TEXT | イベントスラグ |
| `problems.id` | TEXT | 4文字Crockford base32（誤読しにくい文字のみ） |
| `testcases.id` | ULID | |
| `cliTokens.id` | ULID | |
| `submissions.id` | ULID | |

ULID実装: `crockfordBase32(Date.now(), 10) + crockfordBase32FromBytes(randomBytes(10), 16)`

---

## 11. Firestore コレクション一覧

| コレクション | ドキュメントキー |
|---|---|
| `users` | userId |
| `events` | eventId |
| `teams` | ULID |
| `teamMembers` | `{teamId}_{userId}`（`_`→`__`エスケープ） |
| `problems` | `{eventId}_{problemId}`（`_`→`__`エスケープ） |
| `testcases` | ULID |
| `cliTokens` | ULID |
| `submissions` | ULID |
| `submissionCases` | `{submissionId}_{caseId}`（`_`→`__`エスケープ） |
| `solves` | `{teamId}_{eventId}_{problemId}`（`_`→`__`エスケープ） |
| `_unique` | `cliTokens:tokenHash:<hash>` |

---

## 12. 制約まとめ

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
  foreign key(eventId, problemId) -> problems(eventId, id)

cliTokens
  primary key(id)
  unique(tokenHash)                     ← _unique コレクションで保証
  foreign key(userId) -> users(id)
  foreign key(teamId) -> teams(id)
  cliToken.userId must be role="solver" in teamMembers

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

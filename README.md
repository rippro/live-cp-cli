# live-cp-cli

live-cp-web の CLI ツール。

## Install

参加者 PC では npm でグローバルインストールして使う。

```sh
npm install -g @rippro/judge@latest
```

提出作業ディレクトリで設定ファイルを作る。

```sh
rj init
```

対話せずに作る場合は値を指定できる。

```sh
rj init --event rippro-2026-spring --token rj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

作成される `.rippro-judge.json` は次の形式。

```json
{
  "eventId": "rippro-2026-spring",
  "token": "rj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

インストール後は `rj` コマンドで提出する。

```sh
rj submit <problemId> <sourcePath>
```

設定は提出作業ディレクトリの `./.rippro-judge.json` だけを読む。

## 対応言語

拡張子ベースで次の言語を判定する。

```text
.c, .cc, .cpp, .cxx, .go, .hs, .java, .js, .cjs, .mjs, .kt, .pl, .php, .py, .rb, .rs
```

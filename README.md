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
rj init --api https://example.com --event rippro-2026-spring --token rj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

作成される `.rippro-judge.json` は次の形式。

```json
{
  "apiBaseUrl": "https://example.com",
  "eventId": "rippro-2026-spring",
  "token": "rj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

インストール後は `rj` コマンドで提出する。

```sh
rj submit <problemId> <sourcePath>
```

設定は `./.rippro-judge.json`、`~/.rippro-judge/config.json`、または環境変数で渡せる。イベント中の案内は、提出作業ディレクトリの `.rippro-judge.json` を推奨する。

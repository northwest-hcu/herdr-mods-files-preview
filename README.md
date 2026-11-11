# Herdr Files Preview

Herdr デスクトップアプリの右側にある **Files** パネルを拡張する Mod です。ターミナルで開いているフォルダーのファイルを、Herdr のウィンドウ内で閲覧・編集できます。

## 概要

- `.md` と `.markdown` は **Preview** で開き、**Source** で原文を表示します。長いソース行はペインの幅で折り返します。
- ローカルの UTF-8 テキストは **Edit** で編集できます。**Save** で保存し、**Cancel** で編集を取り消します。Markdown は保存前の内容も **Preview** で確認できます。外部でファイルが更新された場合は、保存を中止して下書きを保持します。
- ソース表示と編集画面は拡張子に応じて色分けします。`.bashrc` や `.zshrc` も判定します。Markdown 内の独立したコードブロックは、`bash`、`zsh`、`python` などの言語名を指定し、前後の本文と空行で区切ると色が付きます。

SSH 接続先のファイルは読み取り専用です。色分けには Herdr 内蔵の言語定義を使います。Herdr 0.1.15 の標準ビルドでは PowerShell のコードは単色で表示されます。参照リンク定義や HTML を含む Markdown のプレビューには Herdr 標準の描画を使います。

## クイックスタート

[Herdr デスクトップアプリ](https://herdr.dev/)を起動し、このリポジトリのルートで PowerShell を開きます。手順は Windows 版 Herdr 0.1.15 で確認しています。

### 設定フォルダーを指定する

インストール時とアンインストール時に、以下を実行します。

```powershell
$herdrAppHome = if ($env:HERDR_APP_HOME) {
    $env:HERDR_APP_HOME
} elseif ($env:XDG_CONFIG_HOME) {
    Join-Path $env:XDG_CONFIG_HOME 'herdr-app'
} else {
    Join-Path $HOME '.config/herdr-app'
}
$modPath = Join-Path $herdrAppHome 'mods/files-markdown'
$layoutPath = Join-Path $herdrAppHome 'layouts/main-markdown.json'
```

### インストール

Mod と同梱のレイアウトを Herdr の設定フォルダーへコピーし、`main-markdown` に切り替えます。

```powershell
if ((Test-Path -LiteralPath $modPath) -or (Test-Path -LiteralPath $layoutPath)) {
    throw 'files-markdown または main-markdown が既にあります。'
}
Copy-Item -LiteralPath 'mods/files-markdown' -Destination $modPath -Recurse -ErrorAction Stop
Copy-Item -LiteralPath 'layouts/main-markdown.json' -Destination $layoutPath -ErrorAction Stop
herdr-app do layout.switch --name main-markdown
```

Herdr のタブバーで **Files** を開き、Markdown ファイルを選択します。

### アンインストール

編集中のファイルがあれば保存し、標準レイアウトに切り替えてから、インストールした Mod とレイアウトを削除します。

```powershell
herdr-app do layout.switch --name main
if ($LASTEXITCODE -ne 0) {
    throw '標準レイアウトに切り替えられませんでした。'
}
if (Test-Path -LiteralPath $layoutPath) {
    Remove-Item -LiteralPath $layoutPath -ErrorAction Stop
}
if (Test-Path -LiteralPath $modPath) {
    Remove-Item -LiteralPath $modPath -Recurse -ErrorAction Stop
}
```

## フォルダー構造

```text
.
├── README.md
├── LICENSE
├── layouts/
│   └── main-markdown.json       # 拡張した Files パネルを使うレイアウト
└── mods/
    └── files-markdown/
        ├── main.js             # ファイルツリー、プレビュー、編集の実装
        ├── mod.json            # Herdr の Mod マニフェスト
        ├── chevron-down.svg
        ├── chevron-right.svg
        ├── file.svg
        ├── folder.svg
        └── LICENSE-Lucide.txt  # SVG アイコンのライセンス
```

## ライセンス

この Mod とレイアウトは、[Herdr の標準 Files Mod と main レイアウト](https://github.com/herdrdev/herdr-app/tree/v0.1.15/defaults)を改変したものです。[Apache License 2.0](LICENSE) に従います。アイコンのライセンスは [LICENSE-Lucide.txt](mods/files-markdown/LICENSE-Lucide.txt) を参照してください。

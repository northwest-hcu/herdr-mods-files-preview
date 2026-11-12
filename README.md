# Herdr Files Preview

Herdr デスクトップアプリの右側にある **Files** パネルを拡張する Mod です。ターミナルで開いているフォルダーのファイルを、Herdr のウィンドウ内で閲覧・編集できます。

# 概要

- `.md` と `.markdown` は **Preview** で開き、**Source** で原文を表示します。長いソース行はペインの幅で折り返します。
- `.csv` は **Table** で開き、先頭のレコードを列見出しとして表形式で表示します。引用符内のカンマ・改行、引用符のエスケープ、UTF-8 BOM に対応します。**Source** で原文を表示・編集し、保存前の内容も **Table** で確認できます。
- PNG、JPEG、GIF、WebP、SVG を選択すると、Files 内に画像を表示します。SVG は **Source** で原文を表示・編集し、保存後に **Preview** へ戻れます。
- ローカルの UTF-8 テキストは **Edit** で編集できます。**Save** で保存し、**Cancel** で編集を取り消します。Markdown は保存前の内容も **Preview** で確認できます。外部でファイルが更新された場合は、保存を中止して下書きを保持します。(SSH 接続先のファイルは読み取り専用です。)
- ローカルでは、Files 上部またはフォルダー行の **Add File** で空のファイルを作成し、そのまま編集できます。各行の **Delete** は確認画面を表示してから完全削除します。フォルダーは中身も削除し、内部のシンボリックリンク・ジャンクションの参照先は削除しません。Windows は PowerShell、Linux・macOS は `sh` と `rm` を使います。
- ソース表示と編集画面は拡張子に応じて色分けします。`.bashrc` や `.zshrc` も判定します。Markdown 内の独立したコードブロックは、`bash`、`zsh`、`python` などの言語名を指定し、前後の本文と空行で区切ると色が付きます。

# クイックスタート

[Herdr デスクトップアプリ](https://herdr.dev/)を起動し、このリポジトリのルートで、お使いの OS に対応したシェルを開きます。

## Windows（PowerShell）

#### 設定フォルダーを指定する

インストール時とアンインストール時に、以下を実行します。

```powershell
$herdrAppHome = if ($env:HERDR_APP_HOME) {
    $env:HERDR_APP_HOME
} elseif ($env:XDG_CONFIG_HOME) {
    Join-Path $env:XDG_CONFIG_HOME 'herdr-app'
} else {
    Join-Path $HOME '.config/herdr-app'
}
$modPath = Join-Path $herdrAppHome 'mods/files-preview'
$layoutPath = Join-Path $herdrAppHome 'layouts/files-preview.json'
$imageCachePath = Join-Path $herdrAppHome 'data/files-preview'
```

#### インストール

Mod と同梱のレイアウトを Herdr の設定フォルダーへコピーし、`files-preview` に切り替えます。

```powershell
if ((Test-Path -LiteralPath $modPath) -or (Test-Path -LiteralPath $layoutPath)) {
    throw 'files-preview の Mod またはレイアウトが既にあります。'
}
Copy-Item -LiteralPath 'mods/files-preview' -Destination $modPath -Recurse -ErrorAction Stop
Copy-Item -LiteralPath 'layouts/files-preview.json' -Destination $layoutPath -ErrorAction Stop
herdr-app do layout.switch --name files-preview
```

Herdr のタブバーで **Files** を開き、Markdown ファイルを選択します。

#### アンインストール

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
if (Test-Path -LiteralPath $imageCachePath) {
    Remove-Item -LiteralPath $imageCachePath -Recurse -ErrorAction Stop
}
```

---

## WSL／Linux・macOS（Bash／Zsh）

この手順は Herdr のデスクトップアプリを実行している Linux または macOS のシェルで実行します。WSL 内で Linux 版 Herdr を使う場合も同じ手順です。Windows 版 Herdr から WSL のターミナルを開いている場合は、Windows 側の PowerShell で上の手順を実行します。

#### 設定フォルダーを指定する

インストール時とアンインストール時に、以下を実行します。設定フォルダーは `HERDR_APP_HOME`、`XDG_CONFIG_HOME/herdr-app`、`$HOME/.config/herdr-app` の順で選択します。 [Herdr の設定フォルダー](https://github.com/herdrdev/herdr-app/blob/master/docs/security.md#what-stays-on-disk)

```sh
herdr_app_home="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
mod_path="$herdr_app_home/mods/files-preview"
layout_path="$herdr_app_home/layouts/files-preview.json"
image_cache_path="$herdr_app_home/data/files-preview"
```

#### インストール

Mod と同梱のレイアウトをコピーし、`files-preview` に切り替えます。

```sh
(
    set -e
    if [ -e "$mod_path" ] || [ -L "$mod_path" ] ||
       [ -e "$layout_path" ] || [ -L "$layout_path" ]; then
        printf '%s\n' 'files-preview の Mod またはレイアウトが既にあります。' >&2
        exit 1
    fi
    cp -R mods/files-preview "$mod_path"
    cp layouts/files-preview.json "$layout_path"
    herdr-app do layout.switch --name files-preview
)
```

Herdr のタブバーで **Files** を開き、Markdown ファイルを選択します。

#### アンインストール

編集中のファイルを保存し、標準レイアウトに切り替えてから、インストールした Mod とレイアウトを削除します。

```sh
(
    set -e
    herdr-app do layout.switch --name main
    rm -f "$layout_path"
    rm -rf "$mod_path"
    rm -rf "$image_cache_path"
)
```

---

# フォルダー構造

```text
.
├── README.md
├── LICENSE
├── layouts/
│   └── files-preview.json       # 拡張した Files パネルを使うレイアウト
├── samples/
│   └── quoted-cells.csv         # 引用符・カンマ・改行を確認するサンプル
└── mods/
    └── files-preview/
        ├── main.js             # ファイルツリー、プレビュー、編集の実装
        ├── csv.js              # CSV の解析とテーブル表示用データの生成
        ├── files.js            # ローカルのファイル作成・ファイルとフォルダーの削除
        ├── images.js           # 画像の読み込み、一時コピー、削除
        ├── mod.json            # Herdr の Mod マニフェスト
        ├── chevron-down.svg
        ├── chevron-right.svg
        ├── file.svg
        ├── folder.svg
        └── LICENSE-Lucide.txt  # SVG アイコンのライセンス
```

## ライセンス

この Mod とレイアウトは、[Herdr の標準 Files Mod と main レイアウト](https://github.com/herdrdev/herdr-app/tree/v0.1.15/defaults)を改変したものです。[Apache License 2.0](LICENSE) に従います。アイコンのライセンスは [LICENSE-Lucide.txt](mods/files-preview/LICENSE-Lucide.txt) を参照してください。

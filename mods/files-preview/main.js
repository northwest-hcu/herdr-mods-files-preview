// A lazy file browser and editor for the focused pane's folder.
// Adapted from Herdr's Files mod to add Markdown previews, wrapping, and editing.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = {
  ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js",
  toml: "yaml", jsonc: "json", svelte: "html", vue: "html",
  bash: "sh", bashrc: "sh", bash_profile: "sh", bash_login: "sh", bash_logout: "sh", bash_aliases: "sh",
  zsh: "sh", zshrc: "sh", zshenv: "sh", zprofile: "sh", zlogin: "sh", zlogout: "sh",
  markdown: "md",
};
const PER_FOLDER = 500, TOTAL = 5000;
const PREVIEW_LIMIT = 400000;

function previewText(text) {
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + "\n\n… (file truncated)" : text;
}

function usesCRLF(text) {
  return text.includes("\r\n") && !text.replace(/\r\n/g, "").includes("\n");
}

function editText(text) {
  const body = text.replace(/^\uFEFF/, "");
  return usesCRLF(body) ? body.replace(/\r\n/g, "\n") : body;
}

function savedText(text, original) {
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  return bom + (usesCRLF(original) ? text.replace(/\r?\n/g, "\r\n") : text);
}

function codeEditor(value, language, readonly, snippet = false) {
  const t = theme();
  const syntaxLanguage = Object.hasOwn(LANG, language) ? LANG[language] : language;
  const syntax = {
    keyword: t.ansi5, string: t.ansi2, comment: t.muted, function: t.ansi4,
    type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6,
  };
  if (syntaxLanguage === "sh") syntax.variable = t.ansi6;
  if (syntaxLanguage === "md") syntax.punctuation = t.ansi4;
  return EditorState.new({
    value, language: syntaxLanguage,
    readonly, soft_wrap: !snippet, line_numbers: !snippet, folding: !snippet,
    font_family: settings().font_family, font_size: 12, syntax,
  });
}

function markdownSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let proseStart = 0;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = /^ {0,3}(~{3,}|`{3,})[ \t\r]*$/.exec(line);
      if (!close || close[1][0] !== fence.marker[0] || close[1].length < fence.marker.length) continue;
      if (fence.language && i > fence.index + 1 && (i + 1 === lines.length || !lines[i + 1].trim())) {
        sections.push({ markdown: lines.slice(proseStart, fence.index).join("\n") });
        sections.push({ language: fence.language, code: lines.slice(fence.index + 1, i).join("\n"), lines: i - fence.index - 1 });
        proseStart = i + 1;
      }
      fence = null;
      continue;
    }
    // Reference definitions and raw HTML can span the fragments around a code block.
    if (/^ {0,3}(?:<|\[.*\]:)/.test(line)) return [];
    const open = /^( {0,3})(~{3,}|`{3,})[ \t]*([^ \t\r]*)[^\r]*\r?$/.exec(line);
    if (!open || (open[2][0] === "`" && line.slice(open[1].length + open[2].length).includes("`"))) continue;
    const standalone = !open[1] && (i === 0 || !lines[i - 1].trim());
    const label = open[3].toLowerCase();
    const language = standalone && /^[a-z0-9][a-z0-9_+#.-]*$/.test(label)
      && !["text", "txt", "plain", "plaintext", "none", "mermaid"].includes(label) ? label : null;
    fence = { index: i, marker: open[2], language };
  }
  if (!sections.length || sections.length > 128) return [];
  sections.push({ markdown: lines.slice(proseStart).join("\n") });
  return sections;
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, {
        folders: this.folders, file: this.file, showSource: this.showSource,
        document: this.document?.draft ? this.document : null,
      });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx, saved.document, saved.showSource);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx, restored = null, source = false) {
    this.code?.release();
    this.code = null;
    this.releasePreview();
    this.document = null;
    this.file = path;
    this.fileError = null;
    this.showSource = source;
    const request = this.fileRequest = {};
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    const isCurrent = () => this.fileRequest === request && this.current(context);
    cx.spawn(async cx => {
      try {
        if (restored) {
          if (isCurrent()) this.openDocument(restored);
          return;
        }
        const text = await readTextFile(`${root}/${path}`, { on });
        if (!isCurrent()) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const filename = path.split("/").pop();
        const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "txt";
        this.openDocument({ text, ext, isMarkdown: ext === "md" || ext === "markdown", draft: null });
      } catch { if (isCurrent()) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  openDocument(document) {
    this.document = document;
    this.updateEditor();
    if (!this.showSource) this.updatePreview();
  }

  updateEditor() {
    this.code?.release();
    const { text, ext, draft } = this.document;
    const editor = this.code = codeEditor(draft ? draft.text : previewText(text), ext, !draft);
    if (draft) editor.on("change", () => {
      if (this.code === editor) draft.text = editor.value();
    });
  }

  releasePreview() {
    for (const section of this.preview?.sections ?? []) section.editor?.release();
    this.preview = null;
  }

  updatePreview() {
    if (!this.document.isMarkdown) return;
    const text = previewText(this.document.draft?.text ?? this.document.text);
    if (this.preview?.text === text) return;
    this.releasePreview();
    const sections = markdownSections(text).filter(section => section.language || section.markdown.trim());
    this.preview = { text, sections: sections.map(section => section.language
      ? { ...section, editor: codeEditor(section.code, section.language, true, true) }
      : section) };
  }

  edit(cx) {
    if (this.on || !this.document || this.document.draft) return;
    this.document.draft = { text: editText(this.document.text), saving: false, error: null };
    this.updateEditor();
    cx.notify();
  }

  cancel(cx) {
    if (!this.document?.draft || this.document.draft.saving) return;
    this.show(this.file, cx, null, this.showSource);
    cx.notify();
  }

  save(cx) {
    const document = this.document;
    const draft = document?.draft;
    if (this.on || !draft || draft.saving) return;
    const text = draft.text = this.code.value();
    const expected = document.text;
    if (text === editText(expected)) {
      this.cancel(cx);
      return;
    }
    const path = `${this.root}/${this.file}`;
    const output = savedText(text, expected);
    draft.saving = true;
    draft.error = null;
    cx.spawn(async cx => {
      try {
        await writeTextFile(path, output, expected);
        document.text = output;
        if (draft.text === text) {
          document.draft = null;
          if (this.document === document) this.updateEditor();
        }
      } catch (error) {
        const message = String(error);
        draft.error = /file changed (outside|while)/i.test(message)
          ? "File changed on disk. Your draft is still here."
          : /exceeds 1 MiB/i.test(message) ? "File exceeds 1 MiB. Your draft is still here."
          : "Could not save the file. Your draft is still here.";
      } finally {
        draft.saving = false;
        if (this.document === document && !this.showSource) this.updatePreview();
        cx.notify();
      }
    });
    cx.notify();
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files-preview/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-preview/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  previewMode(label, source, t) {
    const selected = this.showSource === source;
    return Button.new(source ? "markdown-source" : "markdown-preview").px(10).py(4).rounded(6)
      .cursor_pointer().text_size(12).font_semibold().text_color(selected ? t.foreground : t.muted)
      .when(selected, el => el.bg(t.selected))
      .hover(s => s.bg(selected ? t.selected : t.hover))
      .on_click((_e, cx) => {
        if (this.document.draft && this.showSource) this.document.draft.text = this.code.value();
        this.showSource = source;
        if (!source) this.updatePreview();
        cx.notify();
      })
      .child(label);
  }

  fileAction(label, handler, t, { primary = false, disabled = false } = {}) {
    return Button.new(`files-${label}`).disabled(disabled).px(9).py(4).rounded(6)
      .text_size(12).font_semibold().text_color(disabled ? t.dim : primary ? t.accent_foreground : t.foreground)
      .bg(primary && !disabled ? t.accent : t.raised)
      .when(!disabled, el => el.cursor_pointer().hover(s => s.bg(primary ? t.accent : t.hover)))
      .on_click((_e, cx) => handler.call(this, cx))
      .child(label);
  }

  renderPreview(t) {
    const { text, sections } = this.preview;
    const id = `markdown-${this.file}`;
    if (!sections.length) return TextView.markdown(id, text).selectable(true).scrollable(true)
      .flex_1().min_h(0).min_w(0).p(16);

    return v_flex().id(id).flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(16).gap(12)
      .children(sections.map((section, i) => section.editor
        ? v_flex().flex_none().min_w(0).rounded(7).border_1().border_color(t.border).overflow_hidden()
          .child(div().flex_none().px(10).py(5).bg(t.raised).text_size(11).text_color(t.muted).child(section.language))
          .child(Editor.new(section.editor).flex_none().h(Math.min(14, section.lines) * 19 + 10))
        : TextView.markdown(`${id}-${i}`, section.markdown).selectable(true).scrollable(false).flex_none().w_full()));
  }

  renderFile(t) {
    if (!this.code) return div().p(12).text_color(t.dim).child(this.fileError || "Loading file…");

    const { isMarkdown, draft } = this.document;
    const canEdit = !this.on && (!isMarkdown || this.showSource);
    const content = isMarkdown && !this.showSource
      ? this.renderPreview(t)
      : Editor.new(this.code).flex_1().min_h(0);
    return v_flex().flex_1().min_h(0).min_w(0)
      .when(isMarkdown || canEdit, el => el.child(h_flex().flex_none().items_center()
        .px(10).py(5).gap(4).border_b(1).border_color(t.border)
        .when(isMarkdown, bar => bar.child(this.previewMode("Preview", false, t)).child(this.previewMode("Source", true, t)))
        .child(div().flex_1())
        .when(canEdit && !draft, bar => bar.child(this.fileAction("Edit", this.edit, t)))
        .when(Boolean(draft), bar => bar
          .child(this.fileAction("Cancel", this.cancel, t, { disabled: draft.saving }))
          .child(this.fileAction(draft.saving ? "Saving…" : "Save", this.save, t, { primary: true, disabled: draft.saving })))))
      .when(Boolean(draft?.error), el => el.child(div().px(12).py(6).text_color(t.blocked).child(draft.error)))
      .child(content);
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(Button.new("files-back").w(20).disabled(Boolean(this.document?.draft))
          .accessibility_label("Back to files").text_color(this.document?.draft ? t.dim : t.muted)
          .on_click((_e, cx) => { if (!this.document?.draft) { this.show(null); cx.notify(); } }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.renderFile(t)));
  }
}

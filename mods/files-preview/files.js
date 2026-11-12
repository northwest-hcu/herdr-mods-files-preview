import { exec, window } from "herdr";

function relativePath(path) {
  if (!path || path.split("/").some(part => !part || part === "." || part === ".." || part === ".git")
    || /[\\\0]/.test(path)) throw new Error("Choose a file or folder inside the current folder.");
  return path;
}

export function fileName(name) {
  if (!name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Enter a valid file name without folder separators.");
  }
  return relativePath(name);
}

function quoted(value) {
  return "'" + value.replace(/['‘’‚‛]/g, "$&$&") + "'";
}

// Inspect parents separately so a folder link cannot redirect a destructive operation.
const windowsParent = `
$base = [IO.Path]::GetFullPath($root)
$p = $base
$parts = $relative.Split('/')
for ($i = 0; $i -lt $parts.Length - 1; $i++) {
  $p = Join-Path $p $parts[$i]
  $item = Get-Item -LiteralPath $p -Force
  if (-not $item.PSIsContainer -or $item.LinkType) { exit 3 }
}
$p = Join-Path $p $parts[-1]
`;

const unixParent = `
cd -P "$1" || exit 1
base=$(pwd -P)
base=\${base%/}
relative=$2
case "$relative" in */*) parent=\${relative%/*};; *) parent=.;; esac
name=\${relative##*/}
cd -P "$base/$parent" || exit 1
parent=$(pwd -P)
case "$parent" in "$base"|"$base"/*) ;; *) exit 3;; esac
`;

async function operate(root, relative, kind, directory = false) {
  relativePath(relative);
  let result;
  if (window()?.platform === "windows") {
    const action = kind === "create" ? `
if (Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue) { exit 2 }
$stream = [IO.File]::Open($p, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$stream.Dispose()
` : `
$item = Get-Item -LiteralPath $p -Force
if (-not $item.LinkType -and $item.PSIsContainer -ne $directory) { exit 4 }
function Remove-Entry($item) {
  if ($item.PSIsContainer) {
    if (-not $item.LinkType) {
      foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) { Remove-Entry $child }
    }
    [IO.Directory]::Delete($item.FullName)
  } else {
    if (-not $item.LinkType) { $item.IsReadOnly = $false }
    [IO.File]::Delete($item.FullName)
  }
}
Remove-Entry $item
`;
    const script = "$ErrorActionPreference = 'Stop'; & { param($root, $relative, $directory) "
      + windowsParent + action + " } " + quoted(root) + " " + quoted(relative) + (directory ? " $true" : " $false");
    result = await exec("powershell", ["-NoProfile", "-Command", script]).catch(() => ({ code: 1 }));
  } else {
    const action = kind === "create" ? `
[ ! -e "./$name" ] && [ ! -L "./$name" ] || exit 2
(set -C; : > "./$name") || exit 1
` : `
[ -e "./$name" ] || [ -L "./$name" ] || exit 1
if [ ! -L "./$name" ]; then
  if [ "$3" = directory ]; then [ -d "./$name" ] || exit 4
  else [ ! -d "./$name" ] || exit 4; fi
fi
rm -rf "./$name"
`;
    result = await exec("sh", ["-c", unixParent + action, "files-preview", root, relative, directory ? "directory" : "file"])
      .catch(() => ({ code: 1 }));
  }
  if (result.code === 3) throw new Error("Cannot operate through this folder link.");
  if (result.code === 4) throw new Error("The entry type changed. Cancel and select it again.");
  if (result.code === 2 && kind === "create") throw new Error("A file or folder with that name already exists.");
  if (result.code !== 0) throw new Error(kind === "create" ? "Could not create the file." : "Could not delete the entry. Some contents may remain.");
}

export async function createFile(root, parent, name) {
  fileName(name);
  const path = parent ? parent + "/" + name : name;
  await operate(root, path, "create");
  return path;
}

export async function deleteEntry(root, path, directory) {
  await operate(root, path, "delete", directory);
}

import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { appHome, exec, window } from "herdr";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const IMAGE_LIMIT = 16 * 1024 * 1024;
// Base64 and the remote command envelope must fit Herdr's 8 MiB exec output.
const TRANSFER_LIMIT = 4 * 1024 * 1024;
const CACHE_DIRECTORY = "data/files-preview";

export function isImage(extension) {
  return IMAGE_EXTENSIONS.has(extension);
}

function powershellPath(path) {
  return "'" + path.replace(/['‘’‚‛]/g, "$&$&") + "'";
}

async function transferredImage(path, on) {
  const windowsImage = () => {
    const script = "$ErrorActionPreference = 'Stop'; $p = " + powershellPath(path) + "; "
      + "if ((Get-Item -LiteralPath $p).Length -gt " + TRANSFER_LIMIT + ") { exit 2 }; "
      + "[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))";
    return exec("powershell", ["-NoProfile", "-Command", script], { on });
  };

  let result;
  // The extra byte lets the receiver detect an image that grew during the read.
  const script = 'size=$(wc -c < "$1") || exit 1; [ "$size" -le "$2" ] || exit 2; head -c "$3" "$1" | base64';
  try {
    result = await exec("sh", ["-c", script, "files-preview-image", path, String(TRANSFER_LIMIT), String(TRANSFER_LIMIT + 1)], { on });
  } catch (error) {
    if (!/cannot (start|run) sh/i.test(String(error))) throw error;
    result = await windowsImage();
  }
  if (result.code === 2) throw new Error("Image exceeds the 4 MiB SSH transfer limit.");
  if (result.code !== 0) throw new Error("Cannot read this image.");
  const encoded = result.stdout.replace(/\s/g, "");
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("The image transfer was incomplete.");
  }
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > TRANSFER_LIMIT) throw new Error("Image exceeds the 4 MiB SSH transfer limit.");
  return encoded;
}

async function copyImage(source, destination) {
  let result;
  if (window()?.platform === "windows") {
    const script = "$ErrorActionPreference = 'Stop'; $p = " + powershellPath(source) + "; "
      + "if ((Get-Item -LiteralPath $p).Length -gt " + IMAGE_LIMIT + ") { exit 2 }; "
      + "Copy-Item -LiteralPath $p -Destination " + powershellPath(destination);
    result = await exec("powershell", ["-NoProfile", "-Command", script]);
  } else {
    const script = 'size=$(wc -c < "$1") || exit 1; [ "$size" -le "$3" ] || exit 2; cp "$1" "$2"';
    result = await exec("sh", ["-c", script, "files-preview-copy", source, destination, String(IMAGE_LIMIT)]);
  }
  if (result.code === 2) throw new Error("Image exceeds Herdr's 16 MiB image limit.");
  if (result.code !== 0) throw new Error("Cannot read this image.");
}

async function decodeImage(encoded, destination) {
  const transfer = destination + ".base64";
  try {
    await fs.writeFile(transfer, encoded);
    let result;
    if (window()?.platform === "windows") {
      const script = "$ErrorActionPreference = 'Stop'; [IO.File]::WriteAllBytes("
        + powershellPath(destination) + ", [Convert]::FromBase64String([IO.File]::ReadAllText("
        + powershellPath(transfer) + ")))";
      result = await exec("powershell", ["-NoProfile", "-Command", script]);
    } else {
      const flag = window()?.platform === "macos" ? "-D" : "-d";
      result = await exec("sh", ["-c", 'base64 "$3" < "$1" > "$2"', "files-preview-decode", transfer, destination, flag]);
    }
    if (result.code !== 0) throw new Error("Cannot prepare this image for display.");
  } finally {
    await fs.unlink(transfer).catch(() => {});
  }
}

function validImage(bytes, extension) {
  const header = String.fromCharCode(...bytes.slice(0, 12));
  if (extension === "svg") {
    return bytes.some((byte, i) => byte === 60 && (bytes[i + 1] | 32) === 115
      && (bytes[i + 2] | 32) === 118 && (bytes[i + 3] | 32) === 103
      && [9, 10, 13, 32, 62].includes(bytes[i + 4]));
  }
  if (extension === "png") return header.startsWith("\x89PNG\r\n\x1a\n");
  if (extension === "jpg" || extension === "jpeg") return header.startsWith("\xff\xd8\xff");
  if (extension === "gif") return /^GIF8[79]a/.test(header);
  return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
}

export async function loadImage(path, extension, on) {
  const asset = CACHE_DIRECTORY + "/" + randomUUID() + "." + extension;
  const absolute = appHome() + "/" + asset;
  try {
    await fs.mkdir(appHome() + "/" + CACHE_DIRECTORY, { recursive: true });
    // OS copy/decoding preserves binary bytes across Herdr 0.1.15's JS bridge.
    if (on) await decodeImage(await transferredImage(path, on), absolute);
    else await copyImage(path, absolute);

    const bytes = await fs.readFile(absolute);
    if (bytes.length > IMAGE_LIMIT) throw new Error("Image exceeds Herdr's 16 MiB image limit.");
    if (!validImage(bytes, extension)) throw new Error("This file does not contain a supported image.");
    return { asset, absolute, extension };
  } catch (error) {
    await fs.unlink(absolute).catch(() => {});
    if (/^(Image exceeds|Cannot read this image|The image transfer|This file does not contain)/.test(error.message ?? "")) throw error;
    throw new Error("Cannot prepare this image for display.");
  }
}

export async function releaseImage(preview) {
  if (preview) await fs.unlink(preview.absolute).catch(() => {});
}

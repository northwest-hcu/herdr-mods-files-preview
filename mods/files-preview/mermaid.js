import { renderMermaidSVG } from "./vendor/beautiful-mermaid.js";

const COLORS = {
  bg: "#ffffff", fg: "#24292f", line: "#57606a", accent: "#0969da",
  muted: "#57606a", surface: "#f6f8fa", border: "#d0d7de",
};

function mixColor(first, percent, second, otherPercent) {
  const rgba = value => {
    if (value === "transparent") return [0, 0, 0, 0];
    let hex = value.slice(1);
    if (hex.length < 5) hex = Array.from(hex, char => char + char).join("");
    if (hex.length === 6) hex += "ff";
    return [0, 2, 4, 6].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / (offset === 6 ? 255 : 1));
  };
  const a = rgba(first), b = rgba(second);
  const left = Number(percent) / 100, right = otherPercent === undefined ? 1 - left : Number(otherPercent) / 100;
  const sum = left + right, alpha = (a[3] * left + b[3] * right) / sum;
  const channel = index => alpha ? Math.round((a[index] * a[3] * left + b[index] * b[3] * right) / (sum * alpha)) : 0;
  return "#" + [channel(0), channel(1), channel(2), Math.round(alpha * Math.min(1, sum) * 255)]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}

function nativeSvg(svg) {
  const variables = new Map();
  const styles = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]);
  styles.push(...[...svg.matchAll(/\bstyle="([^"]*)"/g)].map(match => match[1]));
  for (const style of styles) for (const match of style.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) variables.set(match[1], match[2].trim());
  const resolve = (value, depth = 0) => {
    if (depth > 20) throw new Error("Invalid SVG color variables.");
    let start;
    while ((start = value.indexOf("var(")) >= 0) {
      let end = start + 4, nested = 1;
      while (end < value.length && nested) { if (value[end] === "(") nested++; else if (value[end] === ")") nested--; end++; }
      if (nested) throw new Error("Invalid SVG color variables.");
      const inside = value.slice(start + 4, end - 1), comma = inside.indexOf(",");
      const name = (comma < 0 ? inside : inside.slice(0, comma)).trim().slice(2);
      const replacement = variables.get(name) ?? (comma < 0 ? COLORS.fg : inside.slice(comma + 1));
      value = value.slice(0, start) + resolve(replacement, depth + 1) + value.slice(end);
    }
    return value.replace(/color-mix\(in srgb,\s*(#[\da-f]{3,8}|transparent)\s+([\d.]+)%,\s*(#[\da-f]{3,8}|transparent)(?:\s+([\d.]+)%)?\s*\)/gi,
      (_match, a, percent, b, otherPercent) => mixColor(a, percent, b, otherPercent));
  };
  // Native SVG drawing does not evaluate CSS variables or fetch web fonts.
  const css = value => resolve(value).replace(/--[\w-]+\s*:[^;}]+;?/g, "");
  svg = svg.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g, (_match, attributes, style) =>
    "<style" + attributes + ">" + css(style.replace(/@import\s+url\([^)]*\)\s*;?/g, "")) + "</style>");
  svg = svg.replace(/\b(fill|stroke|color|stop-color|flood-color|style)="([^"]*)"/g,
    (_match, name, value) => name + '="' + (name === "style" ? css(value) : resolve(value)) + '"');
  return svg.replace(/<svg\b[^>]*>/, opening => opening + '<rect width="100%" height="100%" fill="' + COLORS.bg + '"/>');
}

export function mermaidSvg(source) {
  return nativeSvg(renderMermaidSVG(source, { ...COLORS, font: "sans-serif" }));
}

export function mermaidSections(text) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines = text.slice(bom.length).split(/\r?\n/), parts = [], prose = [], references = [];
  let fence = null, html = null, found = false;
  const flush = () => { if (prose.length) { parts.push({ markdown: prose.join("\n") }); prose.length = 0; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fence) {
      if (!html) {
        const raw = /^ {0,3}<(pre|script|style|textarea)(?:\s|>)/i.exec(line);
        if (raw) html = new RegExp("</" + raw[1] + "\\s*>", "i");
        else if (/^ {0,3}<!--/.test(line)) html = /-->/;
      }
      if (html) {
        prose.push(line);
        if (html.test(line)) html = null;
        continue;
      }
      if (/^ {0,3}\[[^\]\n]+\]:/.test(line)) {
        let end = i + 1;
        while (end < lines.length && /^[ \t]+\S/.test(lines[end])) end++;
        references.push(lines.slice(i, end).join("\n"));
      }
      const open = /^( {0,3})(`{3,}|~{3,})[ \t]*([^ \t]*)[^\r]*$/.exec(line);
      if (open && !(open[2][0] === "`" && line.slice(open[1].length + open[2].length).includes("`"))) {
        fence = { start: i, marker: open[2], diagram: open[3].toLowerCase() === "mermaid" };
      }
      if (!fence?.diagram) prose.push(line);
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (!close || close[1][0] !== fence.marker[0] || close[1].length < fence.marker.length) {
      if (!fence.diagram) prose.push(line);
      continue;
    }
    if (fence.diagram) {
      found = true;
      flush();
      try {
        const svg = mermaidSvg(lines.slice(fence.start + 1, i).join("\n"));
        const viewBox = /\bviewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number);
        if (!viewBox || !viewBox.slice(2).every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid diagram size.");
        parts.push({ diagram: true, svg, width: viewBox[2], height: viewBox[3], source: lines.slice(fence.start, i + 1).join("\n") });
      } catch {
        parts.push({ markdown: "**Mermaid preview unavailable:** invalid syntax or unsupported diagram type.\n\n" + lines.slice(fence.start, i + 1).join("\n") });
      }
    } else prose.push(line);
    fence = null;
  }
  if (fence?.diagram) prose.push(...lines.slice(fence.start));
  flush();
  if (!found) return null;
  // Each native prose view needs the document's reference definitions.
  if (references.length) for (const part of parts) if (part.markdown) part.markdown += "\n\n" + references.join("\n");
  return parts;
}

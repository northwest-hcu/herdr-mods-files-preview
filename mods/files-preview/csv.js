export function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, "");
  if (!text) return [];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let quoteEnded = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          quoteEnded = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === "," || character === "\r" || character === "\n") {
      row.push(field);
      field = "";
      quoteEnded = false;
      if (character !== ",") {
        rows.push(row);
        row = [];
        if (character === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (character === '"' && field === "" && !quoteEnded) {
      quoted = true;
    } else {
      if (quoteEnded || character === '"') throw new Error("CSV contains an incorrectly quoted field.");
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (row.length || !/[\r\n]$/.test(text)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellText(value) {
  // Herdr preserves line breaks in pre, but its HTML minifier decodes entities once before parsing.
  const text = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r\n|\r/g, "\n");
  return "<pre>" + text.replace(/&/g, "&amp;") + "</pre>";
}

export function csvTable(source) {
  const rows = parseCsv(source);
  if (!rows.length) return "";
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0);
  const header = Array.from({ length: columnCount }, (_, i) => "<th>" + cellText(rows[0][i] ?? "") + "</th>").join("");
  const body = rows.slice(1).map(row => "<tr>" + row.map(value => "<td>" + cellText(value) + "</td>").join("") + "</tr>").join("");
  return "<table><thead><tr>" + header + "</tr></thead><tbody>" + body + "</tbody></table>";
}

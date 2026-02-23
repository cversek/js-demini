import { colorize, cleanAnsi, measureWidth, wrapText } from "./require-bridge.cjs";

export function formatTable(rows, colWidths) {
  return rows.map(row =>
    row.map((cell, i) => {
      const clean = cleanAnsi(String(cell));
      const width = measureWidth(clean);
      const pad = Math.max(0, (colWidths[i] || 20) - width);
      return String(cell) + " ".repeat(pad);
    }).join(" | ")
  ).join("\n");
}

export function truncate(text, maxWidth) {
  if (measureWidth(text) <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + "…";
}

export function wrapOutput(text, cols = 80) {
  return wrapText(text, cols);
}

export function highlight(text, color = "yellow") {
  return colorize(text, color);
}

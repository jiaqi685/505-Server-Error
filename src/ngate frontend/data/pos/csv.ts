/** Strict RFC-style comma-separated text, including escaped quotes and BOM/CRLF. */
export function readCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  function finishField() {
    row.push(field.trim());
    field = "";
    closed = false;
  }
  function finishRow() {
    finishField();
    if (row.some((value) => value !== "")) records.push(row);
    row = [];
  }
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ",") {
      finishField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i += 1;
      finishRow();
    } else if (c === '"' && !field && !closed) {
      quoted = true;
    } else if (c === '"' || (closed && c.trim())) {
      throw new Error(`Malformed CSV near record ${records.length + 1}: unexpected text or quotation mark.`);
    } else if (!closed) field += c;
  }
  if (quoted) throw new Error("Malformed CSV: an opening quotation mark has no closing quotation mark.");
  if (field || row.length || closed) finishRow();
  return records;
}

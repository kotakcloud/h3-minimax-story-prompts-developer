export type DiffLine = {
  type: "same" | "del" | "add";
  text: string;
};

export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const rows = left.length;
  const cols = right.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      lines.push({ type: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "del", text: left[i] });
      i += 1;
    } else {
      lines.push({ type: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < rows) {
    lines.push({ type: "del", text: left[i] });
    i += 1;
  }
  while (j < cols) {
    lines.push({ type: "add", text: right[j] });
    j += 1;
  }
  return lines;
}

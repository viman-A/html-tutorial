// animals.csv と parts.csv から animals.js を作ります。
// 使い方: node build-animals.js

const fs = require("fs");
const path = require("path");

const root = __dirname;
const animalColumns = ["name", "description", "image", "width", "height", "points"];
const partColumns = ["name", "part", "x", "y"];

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let cells = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;

  function endRow() {
    cells.push(field);
    rows.push({ line: rowLine, cells });
    cells = [];
    field = "";
    closedQuote = false;
    line += 1;
    rowLine = line;
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += c;
        if (c === "\n") {
          line += 1;
        }
      }
      continue;
    }

    if (closedQuote) {
      if (c === " " || c === "\t") {
        continue;
      }
      if (c !== "," && c !== "\n" && c !== "\r") {
        throw new Error(`${line} 行目の引用符の使い方が正しくありません`);
      }
    }

    if (c === '"') {
      if (field !== "") {
        throw new Error(`${line} 行目の引用符の使い方が正しくありません`);
      }
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      cells.push(field);
      field = "";
      closedQuote = false;
      continue;
    }

    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      endRow();
      continue;
    }

    field += c;
  }

  if (inQuotes) {
    throw new Error(`${rowLine} 行目の引用符が閉じられていません`);
  }

  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push({ line: rowLine, cells });
  }

  return rows;
}

function readTable(filename, expected, errors) {
  const full = path.join(root, filename);
  if (!fs.existsSync(full)) {
    errors.push(`${filename} が見つかりません`);
    return null;
  }

  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch (error) {
    errors.push(`${filename} を読めませんでした`);
    return null;
  }

  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    errors.push(`${filename}: ${error.message}`);
    return null;
  }

  const nonempty = rows.filter((row) => !row.cells.every((cell) => cell.trim() === ""));
  if (nonempty.length === 0) {
    errors.push(`${filename}: ヘッダがありません`);
    return null;
  }

  const header = nonempty[0];
  const actual = header.cells.map((cell) => cell.trim());
  const headerMatches = actual.length === expected.length && actual.every((cell, index) => cell === expected[index]);
  if (!headerMatches) {
    errors.push(`${filename}:${header.line}: ヘッダは ${expected.join(",")} である必要があります`);
    return null;
  }

  const data = [];
  for (const row of nonempty.slice(1)) {
    if (row.cells.length !== expected.length) {
      errors.push(`${filename}:${row.line}: 列の数が ${expected.length} ではありません`);
      continue;
    }
    const record = { line: row.line };
    expected.forEach((key, index) => {
      record[key] = row.cells[index].trim();
    });
    data.push(record);
  }
  return data;
}

function parseNumber(value) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}

function checkImage(image, line, errors) {
  if (!image) {
    errors.push(`animals.csv:${line}: image が空です`);
    return null;
  }

  const slash = image.replace(/\\/g, "/");
  const segments = slash.split("/");
  const leavesProject = path.win32.isAbsolute(image) || slash.startsWith("/") || segments.includes("..") || segments.includes("") || slash.includes(":");
  if (leavesProject) {
    errors.push(`animals.csv:${line}: image「${image}」はプロジェクト内の相対パスである必要があります`);
    return null;
  }

  const stored = segments.filter((segment) => segment !== ".").join("/");
  const full = path.resolve(root, ...stored.split("/"));
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    errors.push(`animals.csv:${line}: image「${image}」はプロジェクト内の相対パスである必要があります`);
    return null;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    errors.push(`animals.csv:${line}: image「${stored}」が見つかりません`);
    return null;
  }
  return stored;
}

function isZeroArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(sum) < 1e-9;
}

function jsString(value) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}"`;
}

function jsNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(value);
}

function generate(animals) {
  const lines = [
    "// このファイルは animals.csv と parts.csv から生成しています。直接編集しないでください。",
    "const animals = ["
  ];

  animals.forEach((animal, animalIndex) => {
    lines.push("  {");
    lines.push(`    name: ${jsString(animal.name)},`);
    lines.push(`    description: ${jsString(animal.description)},`);
    lines.push(`    image: ${jsString(animal.image)},`);
    lines.push(`    width: ${jsNumber(animal.width)},`);
    lines.push(`    height: ${jsNumber(animal.height)},`);
    lines.push(`    points: ${jsNumber(animal.points)},`);
    lines.push("    parts: [");
    animal.parts.forEach((part, partIndex) => {
      lines.push("      [");
      part.forEach((point, pointIndex) => {
        const comma = pointIndex < part.length - 1 ? "," : "";
        lines.push(`        { x: ${jsNumber(point.x)}, y: ${jsNumber(point.y)} }${comma}`);
      });
      const comma = partIndex < animal.parts.length - 1 ? "," : "";
      lines.push(`      ]${comma}`);
    });
    lines.push("    ]");
    const comma = animalIndex < animals.length - 1 ? "," : "";
    lines.push(`  }${comma}`);
  });

  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

function fail(errors) {
  for (const error of errors) {
    console.error(error);
  }
  console.error("変換を中止しました。animals.js は変更していません。");
  process.exit(1);
}

function main() {
  const errors = [];
  const animalRows = readTable("animals.csv", animalColumns, errors);
  const partRows = readTable("parts.csv", partColumns, errors);

  const animals = [];
  const names = new Set();
  if (animalRows) {
    if (animalRows.length === 0) {
      errors.push("animals.csv: 動物が 1 件もありません");
    }
    for (const row of animalRows) {
      let valid = true;
      if (!row.name) {
        errors.push(`animals.csv:${row.line}: name が空です`);
        valid = false;
      } else if (names.has(row.name)) {
        errors.push(`animals.csv:${row.line}: name「${row.name}」が重複しています`);
        valid = false;
      } else {
        names.add(row.name);
      }

      if (!row.description) {
        errors.push(`animals.csv:${row.line}: description が空です`);
        valid = false;
      }

      const image = checkImage(row.image, row.line, errors);
      if (!image) {
        valid = false;
      }

      const width = parseNumber(row.width);
      if (width === null || width < 1) {
        errors.push(`animals.csv:${row.line}: width は 1 以上の数値である必要があります`);
        valid = false;
      }

      const height = parseNumber(row.height);
      if (height === null || height < 1) {
        errors.push(`animals.csv:${row.line}: height は 1 以上の数値である必要があります`);
        valid = false;
      }

      const points = parseNumber(row.points);
      if (points === null || points < 0) {
        errors.push(`animals.csv:${row.line}: points は 0 以上の数値である必要があります`);
        valid = false;
      }

      if (valid) {
        animals.push({
          name: row.name,
          description: row.description,
          image,
          width,
          height,
          points,
          parts: []
        });
      }
    }
  }

  const vertices = [];
  if (partRows) {
    for (const row of partRows) {
      let valid = true;
      if (!row.name) {
        errors.push(`parts.csv:${row.line}: name が空です`);
        valid = false;
      } else if (animalRows && !names.has(row.name)) {
        errors.push(`parts.csv:${row.line}: name「${row.name}」は animals.csv にありません`);
        valid = false;
      }

      if (!/^[1-9]\d*$/.test(row.part)) {
        errors.push(`parts.csv:${row.line}: part は 1 以上の整数である必要があります`);
        valid = false;
      }

      const x = parseNumber(row.x);
      if (x === null) {
        errors.push(`parts.csv:${row.line}: x は数値である必要があります`);
        valid = false;
      }

      const y = parseNumber(row.y);
      if (y === null) {
        errors.push(`parts.csv:${row.line}: y は数値である必要があります`);
        valid = false;
      }

      if (valid) {
        vertices.push({
          line: row.line,
          name: row.name,
          part: Number(row.part),
          x,
          y
        });
      }
    }
  }

  if (animalRows && partRows && errors.length === 0) {
    const byName = new Map(animals.map((animal) => [animal.name, []]));
    for (const vertex of vertices) {
      byName.get(vertex.name).push(vertex);
    }

    for (const animal of animals) {
      const rows = byName.get(animal.name);
      if (rows.length === 0) {
        errors.push(`parts.csv: 動物「${animal.name}」に頂点がありません`);
        continue;
      }

      const numbers = [...new Set(rows.map((row) => row.part))].sort((a, b) => a - b);
      let numberedInOrder = true;
      for (let i = 0; i < numbers.length; i++) {
        if (numbers[i] !== i + 1) {
          errors.push(`parts.csv: 動物「${animal.name}」の部品番号は 1 から連番である必要があります`);
          numberedInOrder = false;
          break;
        }
      }

      const parts = [];
      for (const partNumber of numbers) {
        const part = rows.filter((row) => row.part === partNumber);
        if (part.length < 3) {
          errors.push(`parts.csv:${part[0].line}: 動物「${animal.name}」の部品 ${partNumber} は頂点が ${part.length} 個です（3 個以上必要です）`);
          continue;
        }
        if (isZeroArea(part)) {
          errors.push(`parts.csv:${part[0].line}: 動物「${animal.name}」の部品 ${partNumber} は面積が 0 です（頂点が一直線です）`);
          continue;
        }
        parts.push(part.map((point) => ({ x: point.x, y: point.y })));
      }

      if (numberedInOrder && parts.length === numbers.length) {
        animal.parts = parts;
      }
    }
  }

  if (errors.length > 0) {
    fail(errors);
  }

  fs.writeFileSync(path.join(root, "animals.js"), generate(animals), "utf8");
  console.log(`animals.js を更新しました（${animals.length} 匹）。`);
}

main();

'use strict';

function splitCsvLine(line) {
  const output = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      output.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  output.push(current.trim());
  return output;
}

function parseCsv(text) {
  const raw = String(text || '').replace(/\r/g, '\n');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map((h, index) => {
    const clean = String(h || '').trim();
    return index === 0 ? clean.replace(/^\uFEFF/, '') : clean;
  });
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = values[c] == null ? '' : values[c];
    }
    rows.push(row);
  }

  return rows;
}

module.exports = {
  parseCsv
};

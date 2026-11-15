export interface ParsedCsvPersonnelRow {
  rowNumber: number;
  full_name: string;
  document_id: string;
  role_department: string;
  isValid: boolean;
  error: string | null;
}

export interface CsvParseResult {
  rows: ParsedCsvPersonnelRow[];
  validCount: number;
  invalidCount: number;
  headerError: string | null;
}

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s/-]+/g, '_');
}

function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (semicolons > commas && semicolons >= tabs) return ';';
  if (tabs > commas && tabs > semicolons) return '\t';
  return ',';
}

function splitCsvLines(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const clean = content.replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += ch;
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

const NAME_ALIASES = new Set([
  'nombre_completo',
  'nombre',
  'nombres',
  'empleado',
  'personal',
  'full_name',
  'name',
]);

const DOC_ALIASES = new Set([
  'documento_id',
  'documento',
  'documento_de_identidad',
  'dni',
  'cedula',
  'id',
  'codigo',
  'codigo_unico',
  'document_id',
]);

const DEPT_ALIASES = new Set([
  'cargo_departamento',
  'cargo',
  'departamento',
  'area',
  'puesto',
  'role_department',
  'department',
  'role',
]);

export function parsePersonnelCsv(text: string): CsvParseResult {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = detectDelimiter(firstLine);
  const matrix = splitCsvLines(text, delimiter);

  if (matrix.length === 0) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      headerError: 'El archivo CSV está vacío.',
    };
  }

  const rawHeaders = matrix[0].map(normalizeHeader);
  let nameIdx = rawHeaders.findIndex((h) => NAME_ALIASES.has(h));
  let docIdx = rawHeaders.findIndex((h) => DOC_ALIASES.has(h));
  let deptIdx = rawHeaders.findIndex((h) => DEPT_ALIASES.has(h));

  // If the first row doesn't look like headers at all and has >= 3 columns, check if it's missing headers
  const hasAnyRecognizedHeader = nameIdx !== -1 || docIdx !== -1 || deptIdx !== -1;
  if (!hasAnyRecognizedHeader) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      headerError:
        'No se encontraron las columnas obligatorias en el encabezado. Use: nombre_completo, documento_id, cargo_departamento.',
    };
  }

  if (nameIdx === -1 || docIdx === -1 || deptIdx === -1) {
    const missing: string[] = [];
    if (nameIdx === -1) missing.push('nombre_completo');
    if (docIdx === -1) missing.push('documento_id');
    if (deptIdx === -1) missing.push('cargo_departamento');
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      headerError: `Faltan columnas obligatorias en el CSV: ${missing.join(', ')}.`,
    };
  }

  const seenDocs = new Set<string>();
  const rows: ParsedCsvPersonnelRow[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    const rowNumber = i + 1;
    const full_name = (cols[nameIdx] || '').trim();
    const document_id = (cols[docIdx] || '').trim();
    const role_department = (cols[deptIdx] || '').trim();

    let error: string | null = null;
    if (!full_name) {
      error = 'Falta nombre completo';
    } else if (!document_id) {
      error = 'Falta documento / código único';
    } else if (!role_department) {
      error = 'Falta cargo / departamento';
    } else if (seenDocs.has(document_id.toLowerCase())) {
      error = `Documento "${document_id}" duplicado en el CSV`;
    } else {
      seenDocs.add(document_id.toLowerCase());
    }

    const isValid = error === null;
    if (isValid) validCount++;
    else invalidCount++;

    rows.push({
      rowNumber,
      full_name,
      document_id,
      role_department,
      isValid,
      error,
    });
  }

  if (rows.length === 0) {
    return {
      rows: [],
      validCount: 0,
      invalidCount: 0,
      headerError: 'El archivo solo contiene la fila de encabezados y ningún empleado.',
    };
  }

  return {
    rows,
    validCount,
    invalidCount,
    headerError: null,
  };
}

export function downloadPersonnelCsvTemplate(): void {
  const lines = [
    'nombre_completo,documento_id,cargo_departamento',
    'Carlos Andrés Mendoza,EMP-1001,Operaciones',
    'Lucía Herrera Gómez,EMP-1002,Recursos Humanos',
  ];
  const csv = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'plantilla_registro_personal.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

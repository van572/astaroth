import * as XLSX from 'xlsx';
import type { DailyAttendanceRow } from '../types';

function mapRowsForExport(rows: DailyAttendanceRow[]) {
  return rows.map((row) => ({
    ID: row.document_id,
    Nombre: row.full_name,
    Fecha: row.date,
    'Hora de Entrada': row.entry_time,
    'Hora de Salida': row.exit_time,
    Estado: row.status,
  }));
}

export function exportAttendanceCsv(rows: DailyAttendanceRow[], date: string): void {
  const mapped = mapRowsForExport(rows);
  const headers = ['ID', 'Nombre', 'Fecha', 'Hora de Entrada', 'Hora de Salida', 'Estado'] as const;

  const escapeCell = (val: string) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.join(','),
    ...mapped.map((item) => headers.map((h) => escapeCell(item[h])).join(',')),
  ];

  // UTF-8 BOM for clean Excel compatibility with Spanish accents
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `asistencia_${date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportAttendanceXlsx(rows: DailyAttendanceRow[], date: string): void {
  const mapped = mapRowsForExport(rows);
  const worksheet = XLSX.utils.json_to_sheet(mapped, {
    header: ['ID', 'Nombre', 'Fecha', 'Hora de Entrada', 'Hora de Salida', 'Estado'],
  });

  worksheet['!cols'] = [
    { wch: 16 }, // ID
    { wch: 30 }, // Nombre
    { wch: 14 }, // Fecha
    { wch: 18 }, // Hora de Entrada
    { wch: 18 }, // Hora de Salida
    { wch: 20 }, // Estado
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Asistencia');
  XLSX.writeFile(workbook, `asistencia_${date}.xlsx`);
}

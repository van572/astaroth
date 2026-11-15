import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, FileText, Printer } from 'lucide-react';
import {
  exportIdCardAsJpg,
  exportIdCardAsPdf,
  exportIdCardAsPng,
  getInitials,
} from '../utils/cardExporter';

interface IdCardPreviewProps {
  fullName: string;
  documentId: string;
  roleDepartment: string;
  qrToken: string;
  photoData: string | null;
  organizationName: string;
  isDraft?: boolean;
}

export function IdCardPreview({
  fullName,
  documentId,
  roleDepartment,
  qrToken,
  photoData,
  organizationName,
  isDraft = false,
}: IdCardPreviewProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [exporting, setExporting] = useState<'png' | 'jpg' | 'pdf' | null>(null);

  useEffect(() => {
    let active = true;
    const value = qrToken || 'CQR-BORRADOR-SIN-EMITIR';
    QRCode.toDataURL(value, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [qrToken]);

  const cardData = {
    full_name: fullName || 'Nombre Completo',
    document_id: documentId || '00000000',
    role_department: roleDepartment || 'Cargo / Departamento',
    qr_token: qrToken,
    photo_data: photoData,
    organization_name: organizationName || 'ControlQR Corporativo',
  };

  async function handleExport(format: 'png' | 'jpg' | 'pdf') {
    if (isDraft) return;
    setExporting(format);
    try {
      if (format === 'png') await exportIdCardAsPng(cardData);
      if (format === 'jpg') await exportIdCardAsJpg(cardData);
      if (format === 'pdf') await exportIdCardAsPdf(cardData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        id="printable-id-card"
        className="w-[300px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"
      >
        {/* Header band */}
        <div className="border-b-4 border-blue-700 bg-slate-900 px-5 py-4 text-center">
          <div className="truncate font-display text-sm font-bold tracking-tight text-white">
            {organizationName || 'ControlQR Corporativo'}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            Credencial de Identificación y Acceso
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col items-center px-6 py-5 text-center">
          {/* Photo or Monogram */}
          <div className="h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {photoData ? (
              <img
                src={photoData}
                alt={fullName || 'Fotografía de personal'}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-blue-50 font-display text-2xl font-bold text-blue-700">
                {getInitials(fullName || 'ID')}
              </div>
            )}
          </div>

          <h3 className="mt-4 line-clamp-2 font-display text-lg font-bold leading-snug text-slate-900">
            {fullName || 'Nombre del personal'}
          </h3>
          <p className="mt-1 line-clamp-1 text-sm text-slate-600">
            {roleDepartment || 'Cargo / Departamento'}
          </p>
          <p className="mt-1.5 font-mono text-xs font-semibold tracking-wide text-slate-800 tabular-nums">
            ID: {documentId || '00000000'}
          </p>

          <div className="my-4 h-px w-full bg-slate-200" />

          {/* QR Image */}
          <div className="relative rounded-lg border border-slate-200 bg-white p-2">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Código QR de ${fullName}`}
                className={`h-32 w-32 object-contain ${isDraft ? 'opacity-25' : 'opacity-100'}`}
              />
            ) : (
              <div className="h-32 w-32 bg-slate-100" />
            )}
            {isDraft && (
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <span className="rounded bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white">
                  Vista previa
                </span>
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Uso personal e intransferible
          </p>
          <p className="mt-0.5 max-w-full truncate font-mono text-[10px] text-slate-400">
            {isDraft ? 'QR asignado al confirmar registro' : qrToken.slice(0, 24)}
          </p>
        </div>
      </div>

      {!isDraft && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('png')}
            disabled={exporting !== null}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-blue-700" />
            {exporting === 'png' ? 'Generando...' : 'PNG'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('jpg')}
            disabled={exporting !== null}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-blue-700" />
            {exporting === 'jpg' ? 'Generando...' : 'JPG'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            {exporting === 'pdf' ? 'Generando...' : 'Descargar PDF'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            Imprimir
          </button>
        </div>
      )}
    </div>
  );
}

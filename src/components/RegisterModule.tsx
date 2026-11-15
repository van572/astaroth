import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  QrCode,
  RotateCcw,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { BulkImportResponse, Personnel } from '../types';
import { bulkCreatePersonnel, createPersonnel } from '../utils/api';
import { resizePhotoFile } from '../utils/cardExporter';
import {
  downloadPersonnelCsvTemplate,
  parsePersonnelCsv,
  type CsvParseResult,
} from '../utils/csvPersonnelParser';
import { IdCardPreview } from './IdCardPreview';

interface RegisterModuleProps {
  organizationName: string;
}

type RegisterMode = 'single' | 'csv';

export function RegisterModule({ organizationName }: RegisterModuleProps) {
  const [mode, setMode] = useState<RegisterMode>('single');

  // Single registration state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [fullName, setFullName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [roleDepartment, setRoleDepartment] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdPerson, setCreatedPerson] = useState<Personnel | null>(null);

  // CSV bulk import state
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvParse, setCsvParse] = useState<CsvParseResult | null>(null);
  const [csvDragging, setCsvDragging] = useState<boolean>(false);
  const [csvImporting, setCsvImporting] = useState<boolean>(false);
  const [csvSubmitError, setCsvSubmitError] = useState<string>('');
  const [csvResult, setCsvResult] = useState<BulkImportResponse | null>(null);
  const [selectedCardPerson, setSelectedCardPerson] = useState<Personnel | null>(null);

  function stopPhotoCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function openPhotoCamera() {
    setError('');
    if (!window.isSecureContext) {
      setError(
        'La cámara requiere conexión segura HTTPS (o localhost). Use "Subir fotografía".'
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Cámara no disponible en este navegador. Use "Subir fotografía".');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setError('No se pudo acceder a la cámara para tomar la fotografía.');
    }
  }

  function captureSnapshot() {
    const video = videoRef.current;
    if (!video) return;
    const size = 420;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const minSide = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - minSide) / 2;
    const sy = (video.videoHeight - minSide) / 2;
    ctx.drawImage(video, sx, sy, minSide, minSide, 0, 0, size, size);
    setPhotoData(canvas.toDataURL('image/jpeg', 0.88));
    stopPhotoCamera();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const resized = await resizePhotoFile(file);
      setPhotoData(resized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la imagen.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || !documentId.trim() || !roleDepartment.trim()) {
      setError('Complete todos los campos obligatorios.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createPersonnel({
        full_name: fullName.trim(),
        document_id: documentId.trim(),
        role_department: roleDepartment.trim(),
        photo_data: photoData,
      });
      setCreatedPerson(created);
      stopPhotoCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar personal.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleResetForNew() {
    setCreatedPerson(null);
    setFullName('');
    setDocumentId('');
    setRoleDepartment('');
    setPhotoData(null);
    setError('');
  }

  function processCsvFile(file: File) {
    setCsvSubmitError('');
    setCsvResult(null);
    setCsvFileName(file.name);

    const reader = new FileReader();
    reader.onerror = () => {
      setCsvSubmitError('No se pudo leer el archivo CSV.');
    };
    reader.onload = () => {
      const content = String(reader.result || '');
      const parsed = parsePersonnelCsv(content);
      setCsvParse(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleCsvInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processCsvFile(file);
  }

  function handleCsvDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setCsvDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processCsvFile(file);
  }

  async function handleBulkImport() {
    if (!csvParse) return;
    const validRows = csvParse.rows
      .filter((r) => r.isValid)
      .map((r) => ({
        rowNumber: r.rowNumber,
        full_name: r.full_name,
        document_id: r.document_id,
        role_department: r.role_department,
      }));

    if (validRows.length === 0) {
      setCsvSubmitError('No hay filas válidas para registrar.');
      return;
    }

    setCsvImporting(true);
    setCsvSubmitError('');
    try {
      const res = await bulkCreatePersonnel(validRows);
      setCsvResult(res);
    } catch (err) {
      setCsvSubmitError(
        err instanceof Error ? err.message : 'Error al importar el archivo CSV.'
      );
    } finally {
      setCsvImporting(false);
    }
  }

  function handleResetCsv() {
    setCsvFileName('');
    setCsvParse(null);
    setCsvSubmitError('');
    setCsvResult(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Registro de Personal y Generación de Carnet
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            El personal registrado no requiere usuario ni contraseña. Al guardar se emite un carnet único con código QR intransferible.
          </p>
        </div>

        {/* Mode Switcher: Individual vs Carga Masiva CSV */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'single'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Registro Individual
          </button>
          <button
            type="button"
            onClick={() => {
              stopPhotoCamera();
              setMode('csv');
            }}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mode === 'csv'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Carga Masiva (CSV)
          </button>
        </div>
      </div>

      {mode === 'single' ? (
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          {/* Left: Registration Form */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
            {createdPerson ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <h2 className="font-display text-base font-bold">
                      Personal registrado y carnet emitido
                    </h2>
                    <p className="mt-1 text-sm text-emerald-800">
                      El código QR de <span className="font-semibold">{createdPerson.full_name}</span> ya se encuentra activo para el Modo Escáner. Puede descargar o imprimir el carnet desde la vista previa a la derecha.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <span className="block text-xs text-slate-500">Nombre completo</span>
                    <span className="mt-0.5 block font-semibold text-slate-900">
                      {createdPerson.full_name}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-slate-500">Documento / Código</span>
                    <span className="mt-0.5 block font-mono font-semibold text-slate-900 tabular-nums">
                      {createdPerson.document_id}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-slate-500">Cargo / Departamento</span>
                    <span className="mt-0.5 block font-medium text-slate-800">
                      {createdPerson.role_department}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-slate-500">Identificador QR</span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-slate-600">
                      {createdPerson.qr_token}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetForNew}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
                >
                  <RotateCcw className="h-4 w-4" />
                  Registrar otra persona
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="reg-fullname" className="block text-sm font-medium text-slate-700">
                    Nombre completo <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="reg-fullname"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. María Fernanda López"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="reg-docid" className="block text-sm font-medium text-slate-700">
                      Documento de identidad / Código único <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="reg-docid"
                      type="text"
                      required
                      value={documentId}
                      onChange={(e) => setDocumentId(e.target.value)}
                      placeholder="Ej. EMP-1042 o 45892103"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>

                  <div>
                    <label htmlFor="reg-role" className="block text-sm font-medium text-slate-700">
                      Cargo / Departamento <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="reg-role"
                      type="text"
                      required
                      value={roleDepartment}
                      onChange={(e) => setRoleDepartment(e.target.value)}
                      placeholder="Ej. Operaciones / Logística"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    />
                  </div>
                </div>

                {/* Photo Optional Section */}
                <div>
                  <span className="block text-sm font-medium text-slate-700">
                    Fotografía (opcional)
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Se mostrará en el carnet digital y en la terminal del escáner al leer el QR.
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                    >
                      <Upload className="h-3.5 w-3.5 text-blue-700" />
                      Subir fotografía
                    </button>

                    {!cameraOpen ? (
                      <button
                        type="button"
                        onClick={openPhotoCamera}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                      >
                        <Camera className="h-3.5 w-3.5 text-slate-600" />
                        Tomar con cámara
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopPhotoCamera}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancelar cámara
                      </button>
                    )}

                    {photoData && (
                      <button
                        type="button"
                        onClick={() => setPhotoData(null)}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Quitar foto
                      </button>
                    )}
                  </div>

                  {cameraOpen && (
                    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 p-3">
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="mx-auto h-56 w-56 rounded-lg object-cover"
                      />
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          onClick={captureSnapshot}
                          className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600"
                        >
                          Capturar fotografía
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
                    {error}
                  </p>
                )}

                <div className="border-t border-slate-100 pt-4">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" />
                    {submitting ? 'Generando carnet...' : 'Registrar Personal y Generar Carnet'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right: Digital ID Card Live Preview & Export */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
            <div className="mb-5 text-center">
              <h2 className="font-display text-base font-bold text-slate-900">
                {createdPerson ? 'Carnet Digital Oficial' : 'Vista Previa del Carnet'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {createdPerson
                  ? 'Listo para descargar en PNG, JPG, PDF o imprimir'
                  : 'El código QR único se generará al confirmar el registro'}
              </p>
            </div>

            <IdCardPreview
              fullName={createdPerson ? createdPerson.full_name : fullName}
              documentId={createdPerson ? createdPerson.document_id : documentId}
              roleDepartment={createdPerson ? createdPerson.role_department : roleDepartment}
              qrToken={createdPerson ? createdPerson.qr_token : 'CQR-BORRADOR'}
              photoData={createdPerson ? createdPerson.photo_data : photoData}
              organizationName={organizationName}
              isDraft={!createdPerson}
            />
          </div>
        </div>
      ) : (
        /* CSV BULK IMPORT MODE */
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Importación Simultánea mediante Archivo CSV
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Columnas obligatorias: <span className="font-mono text-xs font-semibold text-slate-800">nombre_completo</span>,{' '}
                  <span className="font-mono text-xs font-semibold text-slate-800">documento_id</span> y{' '}
                  <span className="font-mono text-xs font-semibold text-slate-800">cargo_departamento</span>. Admite separador por coma o punto y coma.
                </p>
              </div>

              <button
                type="button"
                onClick={downloadPersonnelCsvTemplate}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-blue-700" />
                Descargar plantilla CSV
              </button>
            </div>

            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvInputChange}
              className="hidden"
            />

            {!csvResult && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setCsvDragging(true);
                }}
                onDragLeave={() => setCsvDragging(false)}
                onDrop={handleCsvDrop}
                className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  csvDragging
                    ? 'border-blue-700 bg-blue-50/70'
                    : 'border-slate-300 bg-slate-50/50 hover:border-slate-400'
                }`}
              >
                <FileSpreadsheet className="h-9 w-9 text-blue-700" />
                <p className="mt-3 font-display text-sm font-bold text-slate-900">
                  {csvFileName
                    ? `Archivo cargado: ${csvFileName}`
                    : 'Seleccione o arrastre un archivo .csv de personal'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Se validará cada fila antes de emitir los carnets digitales QR.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => csvInputRef.current?.click()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {csvFileName ? 'Seleccionar otro CSV' : 'Subir archivo CSV'}
                  </button>
                  {csvParse && (
                    <button
                      type="button"
                      onClick={handleResetCsv}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
            )}

            {csvParse?.headerError && (
              <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{csvParse.headerError}</span>
              </div>
            )}

            {csvSubmitError && (
              <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{csvSubmitError}</span>
              </div>
            )}

            {/* Pre-submit Validation Preview Table */}
            {csvParse && !csvParse.headerError && !csvResult && (
              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-semibold text-slate-900">
                      Total detectado: <span className="font-mono tabular-nums">{csvParse.rows.length}</span>
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-semibold text-emerald-700">
                      Válidos: <span className="font-mono tabular-nums">{csvParse.validCount}</span>
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className={`font-semibold ${csvParse.invalidCount > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                      Con error de validación: <span className="font-mono tabular-nums">{csvParse.invalidCount}</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleBulkImport}
                    disabled={csvImporting || csvParse.validCount === 0}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Users className="h-4 w-4" />
                    {csvImporting
                      ? 'Registrando empleados...'
                      : `Registrar ${csvParse.validCount} empleados válidos`}
                  </button>
                </div>

                <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">Fila</th>
                        <th className="px-4 py-2.5">Nombre completo</th>
                        <th className="px-4 py-2.5">Documento / ID</th>
                        <th className="px-4 py-2.5">Cargo / Departamento</th>
                        <th className="px-4 py-2.5">Validación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvParse.rows.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={row.isValid ? 'bg-white' : 'bg-red-50/60'}
                        >
                          <td className="px-4 py-2 font-mono text-xs text-slate-500 tabular-nums">
                            {row.rowNumber}
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-900">
                            {row.full_name || <span className="italic text-red-600">Vacío</span>}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-slate-700 tabular-nums">
                            {row.document_id || <span className="italic text-red-600">Vacío</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-600">
                            {row.role_department || <span className="italic text-red-600">Vacío</span>}
                          </td>
                          <td className="px-4 py-2 text-xs font-medium">
                            {row.isValid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Listo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-700">
                                <AlertCircle className="h-3.5 w-3.5" />
                                {row.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Post-Import Results */}
            {csvResult && (
              <div className="mt-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    <div>
                      <h3 className="font-display text-base font-bold">
                        Importación completada: {csvResult.created.length} empleados registrados
                      </h3>
                      <p className="mt-0.5 text-xs text-emerald-800">
                        Todos los carnets QR generados ya están activos. Puede descargar el carnet individual de cada empleado desde la lista.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleResetCsv}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Nueva carga CSV
                  </button>
                </div>

                {csvResult.errors.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h4 className="font-display text-xs font-bold uppercase tracking-wide text-amber-900">
                      Registros omitidos por el servidor ({csvResult.errors.length})
                    </h4>
                    <ul className="mt-2 space-y-1 text-xs text-amber-900">
                      {csvResult.errors.map((errItem, idx) => (
                        <li key={idx}>
                          <span className="font-mono font-semibold">Fila {errItem.rowNumber}</span>
                          {errItem.document_id ? ` (${errItem.document_id})` : ''}: {errItem.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {csvResult.created.length > 0 && (
                  <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <tr>
                          <th className="px-4 py-2.5">Nombre completo</th>
                          <th className="px-4 py-2.5">Documento / ID</th>
                          <th className="px-4 py-2.5">Cargo / Departamento</th>
                          <th className="px-4 py-2.5 text-right">Carnet QR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {csvResult.created.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-medium text-slate-900">{p.full_name}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                              {p.document_id}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">
                              {p.role_department}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedCardPerson(p)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              >
                                <QrCode className="h-3.5 w-3.5 text-blue-700" />
                                Ver / Descargar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal to preview/export ID card for CSV imported person */}
      {selectedCardPerson && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Carnet Digital QR
              </h2>
              <button
                type="button"
                onClick={() => setSelectedCardPerson(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <IdCardPreview
              fullName={selectedCardPerson.full_name}
              documentId={selectedCardPerson.document_id}
              roleDepartment={selectedCardPerson.role_department}
              qrToken={selectedCardPerson.qr_token}
              photoData={selectedCardPerson.photo_data}
              organizationName={organizationName}
            />
          </div>
        </div>
      )}
    </div>
  );
}

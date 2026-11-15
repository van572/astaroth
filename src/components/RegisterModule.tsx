import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, CheckCircle2, RotateCcw, Trash2, Upload, UserPlus } from 'lucide-react';
import type { Personnel } from '../types';
import { createPersonnel } from '../utils/api';
import { resizePhotoFile } from '../utils/cardExporter';
import { IdCardPreview } from './IdCardPreview';

interface RegisterModuleProps {
  organizationName: string;
}

export function RegisterModule({ organizationName }: RegisterModuleProps) {
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

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Registro de Personal y Generación de Carnet
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          El personal registrado no requiere usuario ni contraseña. Al guardar se emite un carnet único con código QR intransferible.
        </p>
      </div>

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
    </div>
  );
}

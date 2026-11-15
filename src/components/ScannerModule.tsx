import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  ImageUp,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ScanResponse } from '../types';
import { fetchScannerConfig, submitQrScan } from '../utils/api';
import { getInitials } from '../utils/cardExporter';
import {
  playCooldownSound,
  playErrorSound,
  playSuccessSound,
  unlockAudio,
} from '../utils/sound';

interface RecentTerminalEntry {
  id: string;
  fullName: string;
  documentId: string;
  movementType: 'Entrada' | 'Salida';
  time: string;
}

export function ScannerModule() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Anti-rebote client guard to prevent spamming the server while card stays in frame
  const localDebounceRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef<boolean>(false);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(15);
  const [now, setNow] = useState(() => new Date());

  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [resultTimestamp, setResultTimestamp] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [recentFeed, setRecentFeed] = useState<RecentTerminalEntry[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchScannerConfig()
      .then((cfg) => setCooldownSeconds(cfg.cooldownSeconds))
      .catch(() => undefined);
  }, []);

  // Live countdown for active anti-rebote bar on screen
  useEffect(() => {
    if (!lastResult || lastResult.status !== 'success') {
      setCooldownRemaining(0);
      return;
    }
    const cd = lastResult.cooldownSeconds || cooldownSeconds;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - resultTimestamp) / 1000);
      const rem = Math.max(0, cd - elapsed);
      setCooldownRemaining(rem);
    }, 250);

    return () => clearInterval(interval);
  }, [lastResult, resultTimestamp, cooldownSeconds]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera();
      setCameraState('starting');
      setCameraError('');

      if (!window.isSecureContext) {
        setCameraState('error');
        setCameraError(
          'El navegador bloquea el acceso a la cámara fuera de HTTPS o localhost. Abra la aplicación bajo HTTPS o utilice el botón "Escanear imagen QR".'
        );
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('error');
        setCameraError(
          'Este navegador no permite acceso directo a cámara. Puede usar el botón "Escanear imagen QR" para probar lecturas.'
        );
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoInputs);
        if (!deviceId && videoInputs.length > 0) {
          const activeTrack = stream.getVideoTracks()[0];
          const settings = activeTrack?.getSettings();
          if (settings?.deviceId) {
            setSelectedDeviceId(settings.deviceId);
          }
        }

        setCameraState('active');
      } catch (err) {
        setCameraState('error');
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilite el acceso en su navegador o use "Escanear imagen QR".'
            : 'No se detectó cámara activa en este equipo. Puede conectar una cámara o usar "Escanear imagen QR".';
        setCameraError(msg);
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleDecodedToken = useCallback(
    async (qrToken: string, source: 'camera' | 'image') => {
      const cleaned = qrToken.trim();
      if (!cleaned || processingRef.current) return;

      const nowMs = Date.now();
      // Client frame throttle: for live camera, avoid hitting API repeatedly for same card within 2.5s
      // unless it's an explicit image upload where user expects immediate feedback (server still enforces full anti-rebote!)
      const lastHit = localDebounceRef.current.get(cleaned) || 0;
      if (source === 'camera' && nowMs - lastHit < 2500) {
        return;
      }

      localDebounceRef.current.set(cleaned, nowMs);
      processingRef.current = true;

      try {
        const res = await submitQrScan(cleaned);
        setLastResult(res);
        setResultTimestamp(Date.now());

        if (res.status === 'success' && res.movementType && res.person) {
          setCooldownRemaining(res.cooldownSeconds || cooldownSeconds);
          if (soundEnabled) playSuccessSound(res.movementType);
          setRecentFeed((prev) => [
            {
              id: `${Date.now()}-${Math.random()}`,
              fullName: res.person!.full_name,
              documentId: res.person!.document_id,
              movementType: res.movementType!,
              time: res.localTime || new Date().toLocaleTimeString('es-ES', { hour12: false }),
            },
            ...prev.slice(0, 5),
          ]);
        } else if (res.status === 'cooldown') {
          if (soundEnabled) playCooldownSound();
        } else {
          if (soundEnabled) playErrorSound();
        }
      } catch {
        setLastResult({
          status: 'invalid',
          message: 'Error de comunicación con el servidor al validar el QR.',
        });
        if (soundEnabled) playErrorSound();
      } finally {
        processingRef.current = false;
      }
    },
    [cooldownSeconds, soundEnabled]
  );

  // Continuous real-time scanning loop
  useEffect(() => {
    if (cameraState !== 'active') return;

    let rafId = 0;
    let lastScanTime = 0;

    const scanFrame = (timestamp: number) => {
      // Scan at ~10 fps to preserve CPU while keeping instant responsiveness
      if (timestamp - lastScanTime >= 100) {
        lastScanTime = timestamp;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const decoded = jsQR(imageData.data, w, h, {
                inversionAttempts: 'dontInvert',
              });
              if (decoded?.data) {
                handleDecodedToken(decoded.data, 'camera');
              }
            }
          }
        }
      }
      rafId = requestAnimationFrame(scanFrame);
    };

    rafId = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(rafId);
  }, [cameraState, handleDecodedToken]);

  async function handleImageUploadScan(e: ChangeEvent<HTMLInputElement>) {
    unlockAudio();
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, canvas.width, canvas.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded?.data) {
          handleDecodedToken(decoded.data, 'image');
        } else {
          setLastResult({
            status: 'invalid',
            message: 'No se detectó ningún código QR legible en la imagen seleccionada.',
          });
          if (soundEnabled) playErrorSound();
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const formattedClock = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const formattedDate = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className="mx-auto max-w-7xl px-6 py-6"
      onClick={() => unlockAudio()}
    >
      {/* Terminal Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Terminal de Lectura Continua
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            <span className="capitalize">{formattedDate}</span>
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span>Bloqueo anti-rebote: <strong className="font-mono tabular-nums">{cooldownSeconds}s</strong></span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-mono text-lg font-bold text-slate-900 tabular-nums">
            {formattedClock}
          </div>

          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setSoundEnabled((prev) => !prev);
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {soundEnabled ? (
              <>
                <Volume2 className="h-4 w-4 text-blue-700" />
                Sonido activo
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4 text-slate-500" />
                Silenciado
              </>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUploadScan}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <ImageUp className="h-4 w-4 text-slate-600" />
            Escanear imagen QR
          </button>
        </div>
      </div>

      {/* 2-Column Scanner Split */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        {/* Left: Live Camera Feed */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-slate-900 p-4 lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Camera className="h-4 w-4 text-blue-400" />
              <span>
                {cameraState === 'active'
                  ? 'Cámara activa · Acerque el código QR del carnet'
                  : cameraState === 'starting'
                  ? 'Iniciando cámara...'
                  : 'Cámara no disponible'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {devices.length > 1 && (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    startCamera(e.target.value);
                  }}
                  aria-label="Seleccionar cámara"
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                >
                  {devices.map((d, idx) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Cámara ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => startCamera(selectedDeviceId || undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reiniciar cámara
              </button>
            </div>
          </div>

          <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraState === 'active' ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Viewfinder reticle when active */}
            {cameraState === 'active' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-56 w-56 sm:h-64 sm:w-64">
                  <span className="absolute top-0 left-0 h-8 w-8 border-t-3 border-l-3 border-white/90" />
                  <span className="absolute top-0 right-0 h-8 w-8 border-t-3 border-r-3 border-white/90" />
                  <span className="absolute bottom-0 left-0 h-8 w-8 border-b-3 border-l-3 border-white/90" />
                  <span className="absolute right-0 bottom-0 h-8 w-8 border-r-3 border-b-3 border-white/90" />
                </div>
              </div>
            )}

            {cameraState === 'error' && (
              <div className="max-w-md px-6 py-10 text-center">
                <CameraOff className="mx-auto h-10 w-10 text-slate-400" />
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  {cameraError}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => startCamera()}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600"
                  >
                    Reintentar cámara
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Cargar imagen de carnet QR
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Visual Feedback & Recent Terminal Feed */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          {/* Result Card */}
          <div className="flex flex-1 flex-col justify-between rounded-xl border border-slate-200 bg-white p-6">
            {!lastResult ? (
              <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <Clock className="h-7 w-7" />
                </div>
                <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
                  Esperando lectura de carnet
                </h2>
                <p className="mt-1.5 max-w-xs text-sm text-slate-600">
                  Coloque el código QR frente a la cámara. El sistema determinará automáticamente si es Entrada o Salida.
                </p>
              </div>
            ) : lastResult.status === 'success' && lastResult.person ? (
              <div>
                {/* Green Success Header */}
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
                    <span className="font-display text-sm font-bold uppercase tracking-wide">
                      {lastResult.movementType} registrada
                    </span>
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums">
                    {lastResult.localTime}
                  </span>
                </div>

                {/* Person Details */}
                <div className="mt-6 flex items-center gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    {lastResult.person.photo_data ? (
                      <img
                        src={lastResult.person.photo_data}
                        alt={lastResult.person.full_name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-blue-50 font-display text-xl font-bold text-blue-700">
                        {getInitials(lastResult.person.full_name)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-xl font-bold text-slate-900">
                      {lastResult.person.full_name}
                    </h2>
                    <p className="mt-0.5 truncate text-sm text-slate-600">
                      {lastResult.person.role_department}
                    </p>
                    <p className="mt-1 font-mono text-xs font-medium text-slate-500 tabular-nums">
                      ID: {lastResult.person.document_id}
                    </p>
                  </div>
                </div>

                {/* Movement Indicator Box */}
                <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-xs text-slate-500">Movimiento</span>
                    <span className="mt-1 inline-flex items-center gap-1.5 font-display text-base font-bold text-emerald-700">
                      {lastResult.movementType === 'Entrada' ? (
                        <LogIn className="h-4 w-4" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                      {lastResult.movementType}
                    </span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-xs text-slate-500">Hora exacta</span>
                    <span className="mt-1 block font-mono text-base font-bold text-slate-900 tabular-nums">
                      {lastResult.localTime}
                    </span>
                  </div>
                </div>

                {cooldownRemaining > 0 && (
                  <p className="mt-4 text-xs text-slate-500 tabular-nums">
                    Protección anti-rebote activa para este carnet: {cooldownRemaining}s restantes.
                  </p>
                )}
              </div>
            ) : lastResult.status === 'cooldown' ? (
              <div>
                <div className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                  <span className="font-display text-sm font-bold">
                    Lectura bloqueada (Anti-rebote)
                  </span>
                </div>

                {lastResult.person && (
                  <div className="mt-5 flex items-center gap-3.5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      {lastResult.person.photo_data ? (
                        <img
                          src={lastResult.person.photo_data}
                          alt={lastResult.person.full_name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-100 font-display text-base font-bold text-slate-700">
                          {getInitials(lastResult.person.full_name)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-display text-base font-bold text-slate-900">
                        {lastResult.person.full_name}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        ID: {lastResult.person.document_id}
                      </div>
                    </div>
                  </div>
                )}

                <p className="mt-4 text-sm text-slate-700">{lastResult.message}</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2.5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-red-700" />
                  <span className="font-display text-sm font-bold uppercase tracking-wide">
                    {lastResult.status === 'inactive' ? 'Carnet desactivado' : 'Código QR no válido'}
                  </span>
                </div>

                {lastResult.person && (
                  <div className="mt-5 flex items-center gap-3.5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-red-200 bg-red-50">
                      {lastResult.person.photo_data ? (
                        <img
                          src={lastResult.person.photo_data}
                          alt={lastResult.person.full_name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover grayscale"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-display text-base font-bold text-red-700">
                          {getInitials(lastResult.person.full_name)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-display text-base font-bold text-slate-900">
                        {lastResult.person.full_name}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        ID: {lastResult.person.document_id}
                      </div>
                    </div>
                  </div>
                )}

                <p className="mt-4 text-sm font-medium text-red-700">{lastResult.message}</p>
              </div>
            )}
          </div>

          {/* Recent session scans */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Lecturas recientes en este terminal
            </h3>
            {recentFeed.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Aún no se han registrado movimientos en esta sesión.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {recentFeed.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">
                        {item.fullName}
                      </span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {item.documentId}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`block text-xs font-semibold ${
                          item.movementType === 'Entrada' ? 'text-emerald-700' : 'text-blue-700'
                        }`}
                      >
                        {item.movementType}
                      </span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {item.time}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

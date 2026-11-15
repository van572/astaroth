import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  CloudOff,
  Flashlight,
  FlipHorizontal2,
  ImageUp,
  Keyboard,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import type { ScanResponse } from '../types';
import { getCachedTerminalMeta } from '../utils/offlineDb';
import {
  submitQrScanWithOfflineFallback,
  useOfflineSyncStatus,
} from '../utils/offlineSync';
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
  offlineQueued?: boolean;
}

interface QrCornerPoint {
  x: number;
  y: number;
}

interface NativeBarcodeDetection {
  rawValue?: string;
  cornerPoints?: Array<{ x: number; y: number }>;
}

interface NativeBarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<NativeBarcodeDetection[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

type FlashTone = 'none' | 'success' | 'cooldown' | 'error';

const AUTO_IDLE_RESET_MS = 10000;

export function ScannerModule() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeDetectorRef = useRef<NativeBarcodeDetectorInstance | null>(null);

  // Anti-rebote client guard + concurrency lock
  const localDebounceRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef<boolean>(false);
  const frameTickRef = useRef<number>(0);
  const lastPolygonRef = useRef<{
    points: QrCornerPoint[];
    videoW: number;
    videoH: number;
    tone: FlashTone;
    expiresAt: number;
  } | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [mirrored, setMirrored] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>('');
  const [decoderEngine, setDecoderEngine] = useState<'native' | 'jsqr'>('jsqr');

  const [cooldownSeconds, setCooldownSeconds] = useState<number>(15);
  const [now, setNow] = useState(() => new Date());

  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [resultTimestamp, setResultTimestamp] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [flashTone, setFlashTone] = useState<FlashTone>('none');
  const [recentFeed, setRecentFeed] = useState<RecentTerminalEntry[]>([]);

  const {
    isOnline,
    isSyncing,
    pendingCount,
    cachedPersonnelCount,
    lastSyncMessage,
    triggerSync,
    refreshCache,
  } = useOfflineSyncStatus();

  // Initialize native BarcodeDetector when supported by browser
  useEffect(() => {
    const win = window as unknown as {
      BarcodeDetector?: NativeBarcodeDetectorConstructor;
    };
    const DetectorCtor = win.BarcodeDetector;
    if (!DetectorCtor) {
      setDecoderEngine('jsqr');
      return;
    }

    let cancelled = false;
    const initDetector = async () => {
      try {
        if (DetectorCtor.getSupportedFormats) {
          const formats = await DetectorCtor.getSupportedFormats();
          if (!formats.includes('qr_code')) return;
        }
        if (!cancelled) {
          barcodeDetectorRef.current = new DetectorCtor({ formats: ['qr_code'] });
          setDecoderEngine('native');
        }
      } catch {
        if (!cancelled) setDecoderEngine('jsqr');
      }
    };
    initDetector();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clock ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync fullscreen state
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    let active = true;
    const syncDirectoryAndConfig = async () => {
      const meta = await getCachedTerminalMeta();
      if (active && meta.cooldownSeconds) {
        setCooldownSeconds(meta.cooldownSeconds);
      }
      const snapshot = await refreshCache();
      if (active && snapshot?.cooldownSeconds) {
        setCooldownSeconds(snapshot.cooldownSeconds);
      }
    };

    void syncDirectoryAndConfig();
    const interval = window.setInterval(() => {
      if (navigator.onLine) {
        void syncDirectoryAndConfig();
      }
    }, 60000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshCache]);

  // Live countdown for active anti-rebote + auto-reset result card after idle
  useEffect(() => {
    if (!lastResult) {
      setCooldownRemaining(0);
      return;
    }

    const cd = lastResult.cooldownSeconds || cooldownSeconds;
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - resultTimestamp;
      if (lastResult.status === 'success') {
        const rem = Math.max(0, cd - Math.floor(elapsedMs / 1000));
        setCooldownRemaining(rem);
      } else {
        setCooldownRemaining(0);
      }

      if (elapsedMs >= AUTO_IDLE_RESET_MS) {
        setLastResult(null);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [lastResult, resultTimestamp, cooldownSeconds]);

  // Clear visual frame flash quickly
  useEffect(() => {
    if (flashTone === 'none') return;
    const timer = setTimeout(() => setFlashTone('none'), 900);
    return () => clearTimeout(timer);
  }, [flashTone]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera();
      setCameraState('starting');
      setCameraError('');

      if (!window.isSecureContext) {
        setCameraState('error');
        setCameraError(
          'El navegador bloquea el acceso a la cámara fuera de HTTPS o localhost. Abra la aplicación bajo HTTPS o utilice "Escanear imagen QR" o el lector manual.'
        );
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('error');
        setCameraError(
          'Este navegador no permite acceso directo a cámara. Puede usar "Escanear imagen QR" o un lector USB.'
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

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] })
            | undefined;
          setTorchSupported(Boolean(capabilities?.torch));

          // Attempt continuous autofocus if hardware supports it
          if (capabilities?.focusMode?.includes('continuous')) {
            videoTrack
              .applyConstraints({
                advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
              })
              .catch(() => undefined);
          }

          const settings = videoTrack.getSettings();
          if (!deviceId && settings?.deviceId) {
            setSelectedDeviceId(settings.deviceId);
          }
          // Auto-mirror front-facing cameras for natural kiosk UX
          if (!deviceId && settings?.facingMode === 'user') {
            setMirrored(true);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoInputs);

        setCameraState('active');
      } catch (err) {
        setCameraState('error');
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilite el acceso en su navegador o use "Escanear imagen QR".'
            : 'No se detectó cámara activa en este equipo. Puede conectar una cámara, usar un lector USB o subir una imagen QR.';
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

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement && containerRef.current) {
        await containerRef.current.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial in restricted iframe
    }
  }

  const handleDecodedToken = useCallback(
    async (
      qrToken: string,
      source: 'camera' | 'image' | 'manual',
      detectedPoints?: QrCornerPoint[],
      videoDims?: { w: number; h: number }
    ) => {
      const cleaned = qrToken.trim();
      if (!cleaned || processingRef.current) return;

      const nowMs = Date.now();
      const lastHit = localDebounceRef.current.get(cleaned) || 0;
      if (source === 'camera' && nowMs - lastHit < 2200) {
        if (detectedPoints && videoDims) {
          lastPolygonRef.current = {
            points: detectedPoints,
            videoW: videoDims.w,
            videoH: videoDims.h,
            tone: lastPolygonRef.current?.tone || 'cooldown',
            expiresAt: nowMs + 350,
          };
        }
        return;
      }

      localDebounceRef.current.set(cleaned, nowMs);
      processingRef.current = true;

      try {
        const res = await submitQrScanWithOfflineFallback(cleaned);
        setLastResult(res);
        setResultTimestamp(Date.now());

        let tone: FlashTone = 'error';
        if (res.status === 'success' && res.movementType && res.person) {
          tone = 'success';
          setCooldownRemaining(res.cooldownSeconds || cooldownSeconds);
          if (soundEnabled) playSuccessSound(res.movementType);
          setRecentFeed((prev) => [
            {
              id: `${Date.now()}-${Math.random()}`,
              fullName: res.person!.full_name,
              documentId: res.person!.document_id,
              movementType: res.movementType!,
              time: res.localTime || new Date().toLocaleTimeString('es-ES', { hour12: false }),
              offlineQueued: res.offlineQueued,
            },
            ...prev.slice(0, 7),
          ]);
        } else if (res.status === 'cooldown') {
          tone = 'cooldown';
          if (soundEnabled) playCooldownSound();
        } else {
          tone = 'error';
          if (soundEnabled) playErrorSound();
        }

        setFlashTone(tone);
        if (detectedPoints && videoDims) {
          lastPolygonRef.current = {
            points: detectedPoints,
            videoW: videoDims.w,
            videoH: videoDims.h,
            tone,
            expiresAt: Date.now() + 900,
          };
        }
      } catch {
        setLastResult({
          status: 'invalid',
          message: 'Error inesperado al validar el código QR en el terminal.',
        });
        setResultTimestamp(Date.now());
        setFlashTone('error');
        if (soundEnabled) playErrorSound();
      } finally {
        processingRef.current = false;
      }
    },
    [cooldownSeconds, soundEnabled]
  );

  // Keyboard-wedge support for physical USB / Bluetooth 2D QR scanners
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastKeyTime > 120) {
        buffer = '';
      }
      lastKeyTime = nowMs;

      if (e.key === 'Enter') {
        if (buffer.length >= 6) {
          unlockAudio();
          handleDecodedToken(buffer, 'manual');
        }
        buffer = '';
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDecodedToken]);

  // Draw live QR bounding box polygon over the video feed
  const drawOverlayPolygon = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    const displayW = video.clientWidth;
    const displayH = video.clientHeight;
    if (displayW === 0 || displayH === 0) return;

    if (overlay.width !== displayW || overlay.height !== displayH) {
      overlay.width = displayW;
      overlay.height = displayH;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, displayW, displayH);

    const poly = lastPolygonRef.current;
    if (!poly || Date.now() > poly.expiresAt || poly.points.length < 3) {
      return;
    }

    // Map video coordinates into object-cover display coordinates
    const scale = Math.max(displayW / poly.videoW, displayH / poly.videoH);
    const renderedW = poly.videoW * scale;
    const renderedH = poly.videoH * scale;
    const offsetX = (displayW - renderedW) / 2;
    const offsetY = (displayH - renderedH) / 2;

    const mapped = poly.points.map((pt) => {
      const rawX = pt.x * scale + offsetX;
      return {
        x: mirrored ? displayW - rawX : rawX,
        y: pt.y * scale + offsetY,
      };
    });

    const strokeColor =
      poly.tone === 'success'
        ? '#22c55e'
        : poly.tone === 'cooldown'
        ? '#f59e0b'
        : '#ef4444';

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.fillStyle = `${strokeColor}22`;
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    for (let i = 1; i < mapped.length; i++) {
      ctx.lineTo(mapped[i].x, mapped[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [mirrored]);

  // Optimized continuous real-time scanning loop (Native BarcodeDetector + jsQR fallback)
  useEffect(() => {
    if (cameraState !== 'active') return;

    let rafId = 0;
    let lastScanTime = 0;
    let inFlightDetect = false;

    const scanFrame = (timestamp: number) => {
      drawOverlayPolygon();

      if (!inFlightDetect && timestamp - lastScanTime >= 90) {
        lastScanTime = timestamp;
        const video = videoRef.current;
        const canvas = analysisCanvasRef.current;

        if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          if (vw > 0 && vh > 0) {
            if (barcodeDetectorRef.current) {
              inFlightDetect = true;
              barcodeDetectorRef.current
                .detect(video)
                .then((results) => {
                  const first = results.find((r) => Boolean(r.rawValue));
                  if (first?.rawValue) {
                    const pts = first.cornerPoints?.map((p) => ({ x: p.x, y: p.y }));
                    handleDecodedToken(first.rawValue, 'camera', pts, { w: vw, h: vh });
                  }
                })
                .catch(() => {
                  // Fallback silently if detector fails on a frame
                })
                .finally(() => {
                  inFlightDetect = false;
                });
            } else {
              // Fast downscaled jsQR pass (max 640px wide) + periodic center ROI & inversion pass
              const tick = ++frameTickRef.current;
              const targetW = Math.min(640, vw);
              const scale = targetW / vw;
              const targetH = Math.round(vh * scale);

              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });

              if (ctx) {
                ctx.drawImage(video, 0, 0, targetW, targetH);
                const imageData = ctx.getImageData(0, 0, targetW, targetH);
                const inversion = tick % 3 === 0 ? 'attemptBoth' : 'dontInvert';

                let decoded = jsQR(imageData.data, targetW, targetH, {
                  inversionAttempts: inversion,
                });

                let pts: QrCornerPoint[] | undefined;
                if (decoded?.location) {
                  const loc = decoded.location;
                  pts = [
                    { x: loc.topLeftCorner.x / scale, y: loc.topLeftCorner.y / scale },
                    { x: loc.topRightCorner.x / scale, y: loc.topRightCorner.y / scale },
                    { x: loc.bottomRightCorner.x / scale, y: loc.bottomRightCorner.y / scale },
                    { x: loc.bottomLeftCorner.x / scale, y: loc.bottomLeftCorner.y / scale },
                  ];
                }

                // Center-crop high-detail pass every 2nd frame if full frame missed
                if (!decoded && tick % 2 === 0 && vw > 640) {
                  const cropSize = Math.round(Math.min(vw, vh) * 0.62);
                  const sx = Math.round((vw - cropSize) / 2);
                  const sy = Math.round((vh - cropSize) / 2);
                  const outSize = 480;
                  canvas.width = outSize;
                  canvas.height = outSize;
                  ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize);
                  const cropData = ctx.getImageData(0, 0, outSize, outSize);
                  decoded = jsQR(cropData.data, outSize, outSize, {
                    inversionAttempts: 'attemptBoth',
                  });

                  if (decoded?.location) {
                    const cScale = outSize / cropSize;
                    const loc = decoded.location;
                    pts = [
                      { x: sx + loc.topLeftCorner.x / cScale, y: sy + loc.topLeftCorner.y / cScale },
                      { x: sx + loc.topRightCorner.x / cScale, y: sy + loc.topRightCorner.y / cScale },
                      { x: sx + loc.bottomRightCorner.x / cScale, y: sy + loc.bottomRightCorner.y / cScale },
                      { x: sx + loc.bottomLeftCorner.x / cScale, y: sy + loc.bottomLeftCorner.y / cScale },
                    ];
                  }
                }

                if (decoded?.data) {
                  handleDecodedToken(decoded.data, 'camera', pts, { w: vw, h: vh });
                }
              }
            }
          }
        }
      }
      rafId = requestAnimationFrame(scanFrame);
    };

    rafId = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(rafId);
  }, [cameraState, drawOverlayPolygon, handleDecodedToken]);

  const decodeImageFile = useCallback(
    (file: File) => {
      unlockAudio();
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          // Try native detector first if available, then jsQR
          if (barcodeDetectorRef.current) {
            try {
              const found = await barcodeDetectorRef.current.detect(img);
              const first = found.find((r) => Boolean(r.rawValue));
              if (first?.rawValue) {
                handleDecodedToken(first.rawValue, 'image');
                return;
              }
            } catch {
              // Fallback to jsQR below
            }
          }

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
            setResultTimestamp(Date.now());
            setFlashTone('error');
            if (soundEnabled) playErrorSound();
          }
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    },
    [handleDecodedToken, soundEnabled]
  );

  function handleImageUploadScan(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) decodeImageFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      decodeImageFile(file);
    }
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    if (!manualCode.trim()) return;
    handleDecodedToken(manualCode, 'manual');
    setManualCode('');
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

  const sessionEntries = recentFeed.filter((r) => r.movementType === 'Entrada').length;
  const sessionExits = recentFeed.filter((r) => r.movementType === 'Salida').length;

  const cameraRingClass =
    flashTone === 'success'
      ? 'ring-4 ring-emerald-500 border-emerald-500'
      : flashTone === 'cooldown'
      ? 'ring-4 ring-amber-500 border-amber-500'
      : flashTone === 'error'
      ? 'ring-4 ring-red-500 border-red-500'
      : 'border-slate-200';

  return (
    <div
      ref={containerRef}
      className={`mx-auto max-w-7xl px-6 py-6 ${isFullscreen ? 'min-h-screen bg-slate-50 overflow-y-auto' : ''}`}
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
            <span>
              Anti-rebote: <strong className="font-mono tabular-nums">{cooldownSeconds}s</strong>
            </span>
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span>
              Motor: <strong className="font-medium text-slate-800">{decoderEngine === 'native' ? 'Acelerado (Hardware)' : 'Óptico (jsQR)'}</strong>
            </span>
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                  <strong className="font-medium text-emerald-700">En línea</strong>
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-amber-700" />
                  <strong className="font-medium text-amber-800">Sin conexión (IndexedDB)</strong>
                </>
              )}
              <span className="text-slate-400 tabular-nums">({cachedPersonnelCount} en caché)</span>
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => void triggerSync()}
              disabled={!isOnline || isSyncing}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing
                ? 'Sincronizando...'
                : `Sincronizar (${pendingCount})`}
            </button>
          )}

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

          <button
            type="button"
            onClick={() => setManualOpen((prev) => !prev)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              manualOpen
                ? 'border-blue-700 bg-blue-50 text-blue-800'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Keyboard className="h-4 w-4" />
            Código manual
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

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {(!isOnline || pendingCount > 0 || lastSyncMessage) && (
        <div
          className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs ${
            !isOnline
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : pendingCount > 0
              ? 'border-blue-200 bg-blue-50 text-blue-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {!isOnline ? (
              <CloudOff className="h-4 w-4 shrink-0 text-amber-700" />
            ) : (
              <RefreshCw className={`h-4 w-4 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
            )}
            <span>
              {!isOnline
                ? `Modo sin conexión activo. Las lecturas se validan con ${cachedPersonnelCount} carnets en caché y se guardan en IndexedDB.`
                : pendingCount > 0
                ? `${pendingCount} ${pendingCount === 1 ? 'lectura pendiente' : 'lecturas pendientes'} en almacenamiento local listas para sincronizar.`
                : lastSyncMessage}
            </span>
          </div>
          {pendingCount > 0 && (
            <span className="font-mono font-semibold tabular-nums">
              Cola local: {pendingCount}
            </span>
          )}
        </div>
      )}

      {/* Collapsible Manual / USB Backup Code Bar */}
      {manualOpen && (
        <form
          onSubmit={handleManualSubmit}
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <label htmlFor="manual-qr-input" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
            Token QR / Lector USB:
          </label>
          <input
            id="manual-qr-input"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Pegue o escanee el código CQR-... y presione Enter"
            autoFocus
            className="min-w-[260px] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
          />
          <button
            type="submit"
            className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            Validar código
          </button>
        </form>
      )}

      {/* 2-Column Scanner Split */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        {/* Left: Live Camera Feed + Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleDrop}
          className={`flex flex-col rounded-xl border bg-slate-900 p-4 transition-all duration-150 lg:col-span-7 ${cameraRingClass}`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Camera className="h-4 w-4 text-blue-400" />
              <span>
                {cameraState === 'active'
                  ? 'Cámara activa · Acerque el carnet QR o use lector USB'
                  : cameraState === 'starting'
                  ? 'Iniciando cámara...'
                  : 'Cámara no disponible'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {devices.length > 1 && (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    startCamera(e.target.value);
                  }}
                  aria-label="Seleccionar cámara"
                  className="max-w-[180px] truncate rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                >
                  {devices.map((d, idx) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Cámara ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}

              {cameraState === 'active' && (
                <button
                  type="button"
                  onClick={() => setMirrored((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    mirrored
                      ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                      : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" />
                  Espejo
                </button>
              )}

              {cameraState === 'active' && torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    torchOn
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <Flashlight className="h-3.5 w-3.5" />
                  Linterna
                </button>
              )}

              <button
                type="button"
                onClick={() => startCamera(selectedDeviceId || undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reiniciar
              </button>
            </div>
          </div>

          <div className="relative flex min-h-[380px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${
                cameraState === 'active' ? 'block' : 'hidden'
              }`}
            />
            <canvas ref={analysisCanvasRef} className="hidden" />

            {/* Live QR bounding polygon overlay */}
            {cameraState === 'active' && (
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}

            {/* Viewfinder reticle */}
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

            {/* Drag & Drop Image Overlay */}
            {isDraggingFile && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-blue-950/85 text-white">
                <ImageUp className="h-10 w-10 text-blue-300" />
                <p className="mt-2 font-display text-sm font-bold">
                  Suelte la imagen del carnet QR para escanear
                </p>
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
                    Cargar o arrastrar imagen QR
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
                  Listo para escanear
                </h2>
                <p className="mt-1.5 max-w-xs text-sm text-slate-600">
                  Coloque el código QR frente a la cámara, arrastre una imagen de carnet o utilice un lector USB.
                </p>
              </div>
            ) : lastResult.status === 'success' && lastResult.person ? (
              <div>
                {/* Green Success Header */}
                <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
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

                {lastResult.offlineQueued && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <span>Guardado en IndexedDB · Se sincronizará automáticamente al recuperar la red.</span>
                  </div>
                )}

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

                {/* Anti-rebote progress bar */}
                {cooldownRemaining > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                      <span>Protección anti-rebote activa</span>
                      <span className="font-mono font-semibold text-slate-700">
                        {cooldownRemaining}s
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-emerald-600 transition-all duration-200"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (cooldownRemaining /
                                (lastResult.cooldownSeconds || cooldownSeconds)) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
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
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Lecturas recientes en este terminal
              </h3>
              {recentFeed.length > 0 && (
                <span className="text-xs text-slate-500 tabular-nums">
                  {sessionEntries} entradas · {sessionExits} salidas
                </span>
              )}
            </div>

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
                        {item.offlineQueued ? ' · Local' : ''}
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

import jsQR from 'jsqr';

interface WorkerDecodeRequest {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  inversionAttempts: 'dontInvert' | 'onlyInvert' | 'attemptBoth';
}

interface WorkerDecodeResponse {
  id: number;
  data: string | null;
  location: {
    topLeftCorner: { x: number; y: number };
    topRightCorner: { x: number; y: number };
    bottomRightCorner: { x: number; y: number };
    bottomLeftCorner: { x: number; y: number };
  } | null;
}

self.onmessage = (event: MessageEvent<WorkerDecodeRequest>) => {
  const { id, width, height, buffer, inversionAttempts } = event.data;
  try {
    const clamped = new Uint8ClampedArray(buffer);
    const decoded = jsQR(clamped, width, height, { inversionAttempts });
    const response: WorkerDecodeResponse = {
      id,
      data: decoded?.data ?? null,
      location: decoded?.location
        ? {
            topLeftCorner: decoded.location.topLeftCorner,
            topRightCorner: decoded.location.topRightCorner,
            bottomRightCorner: decoded.location.bottomRightCorner,
            bottomLeftCorner: decoded.location.bottomLeftCorner,
          }
        : null,
    };
    self.postMessage(response);
  } catch {
    self.postMessage({ id, data: null, location: null } satisfies WorkerDecodeResponse);
  }
};

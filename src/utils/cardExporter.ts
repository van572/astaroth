import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

export interface CardRenderInput {
  full_name: string;
  document_id: string;
  role_department: string;
  qr_token: string;
  photo_data: string | null;
  organization_name: string;
}

export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ID';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export async function resizePhotoFile(file: File, maxSize = 420): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen no compatible.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Error al procesar la imagen.'));
          return;
        }
        // Center-crop square
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Error cargando imagen'));
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export async function renderIdCardCanvas(data: CardRenderInput): Promise<HTMLCanvasElement> {
  // High-resolution CR80 vertical badge (640 x 1014 px)
  const W = 640;
  const H = 1014;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');

  // Card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header band
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, 148);

  // Thin cobalt accent bar under header
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(0, 148, W, 8);

  // Organization title
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 26px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.textAlign = 'center';
  const orgTitle = (data.organization_name || 'ControlQR Corporativo').slice(0, 32);
  ctx.fillText(orgTitle, W / 2, 72);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 16px "DM Sans", Arial, sans-serif';
  ctx.fillText('Credencial de Identificación y Acceso', W / 2, 108);

  // Photo / Avatar container
  const avatarSize = 204;
  const avatarX = (W - avatarSize) / 2;
  const avatarY = 198;

  ctx.save();
  drawRoundedRect(ctx, avatarX, avatarY, avatarSize, avatarSize, 24);
  ctx.clip();

  if (data.photo_data) {
    try {
      const photoImg = await loadImage(data.photo_data);
      ctx.drawImage(photoImg, avatarX, avatarY, avatarSize, avatarSize);
    } catch {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    }
  } else {
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = '700 68px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getInitials(data.full_name), W / 2, avatarY + avatarSize / 2 + 4);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // Hairline border around photo
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, avatarX, avatarY, avatarSize, avatarSize, 24);
  ctx.stroke();

  // Person Full Name
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 32px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.textAlign = 'center';
  const nameLines = wrapTextLines(ctx, data.full_name || 'Nombre Completo', W - 80, 2);
  let yCursor = 456;
  for (const line of nameLines) {
    ctx.fillText(line, W / 2, yCursor);
    yCursor += 38;
  }

  // Role / Department
  ctx.fillStyle = '#475569';
  ctx.font = '500 21px "DM Sans", Arial, sans-serif';
  const roleText = (data.role_department || 'Cargo / Departamento').slice(0, 44);
  ctx.fillText(roleText, W / 2, yCursor + 6);

  // Document ID label
  ctx.fillStyle = '#1e293b';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText(`ID: ${data.document_id || '00000000'}`, W / 2, yCursor + 44);

  // Hairline divider
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(64, 594);
  ctx.lineTo(W - 64, 594);
  ctx.stroke();

  // QR Code container
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, data.qr_token || 'CQR-PREVIEW', {
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  const qrSize = 276;
  const qrX = (W - qrSize) / 2;
  const qrY = 626;
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  // Hairline frame around QR
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 14);
  ctx.stroke();

  // Footer instructions
  ctx.fillStyle = '#64748b';
  ctx.font = '500 15px "DM Sans", Arial, sans-serif';
  ctx.fillText('Uso personal e intransferible · Presentar en el escáner', W / 2, 954);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 13px "JetBrains Mono", monospace';
  ctx.fillText(data.qr_token.slice(0, 24), W / 2, 982);

  // Outer border for crisp cut/print edges
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return canvas;
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function safeFileSlug(name: string, docId: string): string {
  const cleanName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  const cleanDoc = docId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `carnet_${cleanName || 'personal'}_${cleanDoc || 'id'}`;
}

export async function exportIdCardAsPng(data: CardRenderInput): Promise<void> {
  const canvas = await renderIdCardCanvas(data);
  triggerDownload(canvas.toDataURL('image/png'), `${safeFileSlug(data.full_name, data.document_id)}.png`);
}

export async function exportIdCardAsJpg(data: CardRenderInput): Promise<void> {
  const canvas = await renderIdCardCanvas(data);
  triggerDownload(
    canvas.toDataURL('image/jpeg', 0.96),
    `${safeFileSlug(data.full_name, data.document_id)}.jpg`
  );
}

export async function exportIdCardAsPdf(data: CardRenderInput): Promise<void> {
  const canvas = await renderIdCardCanvas(data);
  const imgData = canvas.toDataURL('image/png');

  // A4 sheet with CR80 badge sized at exact 54mm x 85.6mm (or 85.6mm x 135.6mm comfortable cut card)
  // Using standard CR80 scaled cleanly at 68mm x 107.7mm centered on A4 for easy reading & printing
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const cardWidthMm = 68;
  const cardHeightMm = 107.7;
  const pageWidth = doc.internal.pageSize.getWidth();
  const x = (pageWidth - cardWidthMm) / 2;
  const y = 32;

  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.text('Carnet de Identificación — Listo para imprimir y recortar', pageWidth / 2, 20, {
    align: 'center',
  });

  doc.addImage(imgData, 'PNG', x, y, cardWidthMm, cardHeightMm);

  // Subtle crop corner marks
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.2);
  doc.rect(x, y, cardWidthMm, cardHeightMm);

  doc.save(`${safeFileSlug(data.full_name, data.document_id)}.pdf`);
}

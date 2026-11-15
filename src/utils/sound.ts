import type { MovementType } from '../types';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => undefined);
  }
  return sharedAudioCtx;
}

export function unlockAudio(): void {
  getAudioContext();
}

function playTone(
  frequency: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.22
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playSuccessSound(movement: MovementType): void {
  if (movement === 'Entrada') {
    // Crisp ascending chime (C5 -> G5)
    playTone(523.25, 0, 0.14, 'sine', 0.22);
    playTone(783.99, 0.11, 0.24, 'sine', 0.24);
  } else {
    // Smooth descending confirmation chime (G5 -> E5)
    playTone(783.99, 0, 0.14, 'sine', 0.22);
    playTone(659.25, 0.11, 0.24, 'sine', 0.24);
  }
}

export function playCooldownSound(): void {
  // Subtle neutral reminder tone
  playTone(440, 0, 0.09, 'triangle', 0.12);
  playTone(440, 0.12, 0.09, 'triangle', 0.12);
}

export function playErrorSound(): void {
  // Distinct low alert buzz for invalid or deactivated QR
  playTone(190, 0, 0.18, 'sawtooth', 0.18);
  playTone(155, 0.2, 0.26, 'sawtooth', 0.2);
}

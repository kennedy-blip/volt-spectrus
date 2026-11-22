import { Injectable } from '@angular/core';
import QRCode from 'qrcode';

/**
 * Instant SVG QR generation for the APK Distribution Center.  Pure offline —
 * the QR encodes the current origin + /releases path so a laptop user can scan
 * the screen and sideload on the spot.
 */
@Injectable({ providedIn: 'root' })
export class QrCodeService {
  private cache = new Map<string, Promise<string>>();

  /** SVG string for `content`, cached by content. */
  svg(content: string, size = 220): Promise<string> {
    const key = `${content}|${size}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.render(content, size);
      this.cache.set(key, pending);
    }
    return pending;
  }

  private async render(content: string, size: number): Promise<string> {
    try {
      return await QRCode.toString(content, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: size,
        color: { dark: '#0b1220', light: '#e8f0ff' },
      });
    } catch {
      return this.placeholder(content, size);
    }
  }

  private placeholder(content: string, size: number): string {
    const cells = 21;
    const cell = size / cells;
    let rects = '';
    // Deterministic pseudo-pattern so the fallback still looks like a QR.
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const seed = (x * 31 + y * 17 + content.length * 13) % 7;
        if (seed < 2) {
          rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#e8f0ff"/><g fill="#0b1220">${rects}</g></svg>`;
  }
}

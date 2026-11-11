import { CryptoError } from './errors';

/** A byte array backed by a plain ArrayBuffer (what Web Crypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text) as Bytes;
}

export function fromUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Decrypted data is not valid UTF-8');
  }
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function randomBytes(length: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new CryptoError('INVALID_FORMAT', 'Invalid base64');
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648

export function toBase32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

/** Returns null if `text` contains a character outside the base32 alphabet. */
export function fromBase32(text: string): Bytes | null {
  const out = new Uint8Array(Math.floor((text.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (const char of text) {
    const value = BASE32.indexOf(char);
    if (value < 0) return null;
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >>> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

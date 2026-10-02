/** Read width/height from PNG, JPEG or WebP headers without decoding the image. */
export function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mimeType === "image/png" && bytes.length > 24) {
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mimeType === "image/jpeg") {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1]!;
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (mimeType === "image/webp" && bytes.length > 30) {
      const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
      if (chunk === "VP8X") return { width: 1 + (dv.getUint32(24, true) & 0xffffff), height: 1 + (dv.getUint32(27, true) & 0xffffff) };
      if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
  } catch {
    return null;
  }
  return null;
}

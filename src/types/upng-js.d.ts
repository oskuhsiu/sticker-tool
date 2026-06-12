declare module 'upng-js' {
  interface UPNGImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown> & {
      acTL?: { num_frames: number; num_plays: number };
    };
    data: Uint8Array;
  }

  interface UPNGStatic {
    /**
     * 把 RGBA8 影格編成 (A)PNG。
     * @param imgs  每張影格的 RGBA8 ArrayBuffer（長度 = w*h*4）
     * @param w,h   尺寸
     * @param cnum  量化色數；0 = 無損
     * @param dels  每格延遲（ms）；多於 1 張時產生 APNG
     */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer;
    decode(buffer: ArrayBuffer | Uint8Array): UPNGImage;
    toRGBA8(img: UPNGImage): ArrayBuffer[];
    crc: {
      crc(buf: Uint8Array, off: number, len: number): number;
      update(c: number, buf: Uint8Array, off: number, len: number): number;
    };
  }

  const UPNG: UPNGStatic;
  export default UPNG;
}

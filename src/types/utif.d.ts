declare module 'utif' {
  import type { UtifIfd } from '../core/image/utif-ifd';

  export function decode(buffer: ArrayBuffer | Uint8Array): UtifIfd[];
  export function decodeImage(
    buffer: ArrayBuffer | Uint8Array,
    ifd: UtifIfd,
    sequence?: unknown,
  ): void;
  export function decodeImages(buffer: ArrayBuffer | Uint8Array, ifds: UtifIfd[]): void;
  export function toRGBA8(ifd: UtifIfd): Uint8Array;
}

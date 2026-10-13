/** UTIF IFD 的最小类型视图（供模块导入；ambient 声明在 src/types/utif.d.ts） */
export interface UtifIfd {
  width: number;
  height: number;
  /** raw decoded sample bytes, filled by decodeImage() */
  data: Uint8Array;
  /** tag 258: bits per sample */
  t258?: number[];
  /** tag 277: samples per pixel */
  t277?: number[];
  /** tag 284: planar configuration (1 = chunky) */
  t284?: number[];
  /** tag 262: photometric interpretation */
  t262?: number[];
  [tag: string]: unknown;
}

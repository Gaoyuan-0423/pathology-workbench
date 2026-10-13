import { describe, expect, it } from 'vitest';
import { computeWorkingScale, ifdToRgba, pickMainIfd, readUint16Le, scale16to8 } from './tiff.ts';
import type { UtifIfd } from './utif-ifd.ts';

describe('scale16to8', () => {
  it('固定 /257 标尺端点', () => {
    expect(scale16to8(0)).toBe(0);
    expect(scale16to8(65535)).toBe(255);
    expect(scale16to8(257)).toBe(1);
  });

  it('不做对比度拉伸：同值输入恒等同值输出', () => {
    expect(scale16to8(32768)).toBe(scale16to8(32768));
    expect(scale16to8(32768)).toBe(128);
  });
});

describe('readUint16Le', () => {
  it('小端序读取', () => {
    expect(readUint16Le(new Uint8Array([0xcd, 0xab]), 0)).toBe(0xabcd);
    expect(readUint16Le(new Uint8Array([0x00, 0xff]), 0)).toBe(0xff00);
  });
});

function makeIfd(overrides: Partial<UtifIfd>, data: Uint8Array): UtifIfd {
  return { width: 1, height: 1, data, t258: [16], t277: [1], t284: [1], ...overrides };
}

describe('ifdToRgba', () => {
  it('16bit 灰度：v/257 映射并复制到 RGB', () => {
    const ifd = makeIfd({}, new Uint8Array([0x00, 0x80])); // 0x8000 = 32768 → 128
    const result = ifdToRgba(ifd);
    expect(result).not.toBeNull();
    expect(result?.bitsPerSample).toBe(16);
    expect(result?.note).toContain('/257');
    expect(result?.pixels.data[0]).toBe(128);
    expect(result?.pixels.data[1]).toBe(128);
    expect(result?.pixels.data[2]).toBe(128);
    expect(result?.pixels.data[3]).toBe(255);
  });

  it('16bit RGB 三通道分别映射', () => {
    const ifd = makeIfd({ t277: [3] }, new Uint8Array([0x00, 0xff, 0x01, 0x00, 0xff, 0xff]));
    // 0xff00=65280→254, 0x0001=1→0, 0xffff=65535→255
    const result = ifdToRgba(ifd);
    expect(result?.pixels.data[0]).toBe(254);
    expect(result?.pixels.data[1]).toBe(0);
    expect(result?.pixels.data[2]).toBe(255);
  });

  it('异常 IFD 返回 null', () => {
    expect(ifdToRgba(makeIfd({ width: 0 }, new Uint8Array([0, 0])))).toBeNull();
    expect(ifdToRgba(makeIfd({}, new Uint8Array(0)))).toBeNull();
  });
});

describe('pickMainIfd', () => {
  it('选面积最大的页', () => {
    const small = makeIfd({ width: 128, height: 128 }, new Uint8Array(2));
    const big = makeIfd({ width: 1000, height: 800 }, new Uint8Array(2));
    expect(pickMainIfd([small, big])).toBe(big);
    expect(pickMainIfd([])).toBeNull();
  });
});

describe('computeWorkingScale', () => {
  it('不超限不缩放', () => {
    expect(computeWorkingScale(2000, 1500, 4096)).toEqual({
      scale: 1,
      workingWidth: 2000,
      workingHeight: 1500,
    });
  });

  it('按最长边缩到上限', () => {
    const r = computeWorkingScale(10000, 5000, 4096);
    expect(r.scale).toBeCloseTo(10000 / 4096);
    expect(r.workingWidth).toBe(4096);
    expect(r.workingHeight).toBe(2048);
  });
});

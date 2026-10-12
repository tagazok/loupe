import { describe, expect, it } from 'vitest';
import { centeredAspect, confine, confineAspect, confineMove, rectFromDrag, resizeByHandle } from '../src/core/rectEdit';
import { computeResize, exportName } from '../src/store';

describe('rect editing', () => {
  it('drag in any direction gives a normalized rect', () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 4, y: 2 }, null)).toEqual({ x: 4, y: 2, w: 6, h: 8 });
  });

  it('aspect-locked drag follows the dominant axis', () => {
    const r = rectFromDrag({ x: 0, y: 0 }, { x: 160, y: 10 }, 16 / 9);
    expect(r.w).toBe(160);
    expect(r.h).toBeCloseTo(90);
  });

  it('corner handle resize anchors the opposite corner', () => {
    const r = resizeByHandle({ x: 10, y: 10, w: 100, h: 50 }, 'nw', -10, -10, null);
    expect(r).toEqual({ x: 0, y: 0, w: 110, h: 60 });
  });

  it('corner handle with aspect keeps ratio and anchor', () => {
    const r = resizeByHandle({ x: 0, y: 0, w: 100, h: 100 }, 'se', 50, 0, 1);
    expect(r).toEqual({ x: 0, y: 0, w: 150, h: 150 });
    const l = resizeByHandle({ x: 100, y: 100, w: 100, h: 100 }, 'nw', -50, 0, 1);
    expect(l).toEqual({ x: 50, y: 50, w: 150, h: 150 });
  });

  it('dragging an edge past the opposite edge flips instead of going negative', () => {
    const r = resizeByHandle({ x: 10, y: 0, w: 20, h: 10 }, 'e', -30, 0, null);
    expect(r).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('confine / confineMove / confineAspect stay inside the image', () => {
    expect(confine({ x: -5, y: 5, w: 20, h: 100 }, 10, 50)).toEqual({ x: 0, y: 5, w: 10, h: 45 });
    expect(confineMove({ x: 95, y: -3, w: 10, h: 10 }, 100, 100)).toEqual({ x: 90, y: 0, w: 10, h: 10 });
    const a = confineAspect({ x: 50, y: 0, w: 100, h: 100 }, 100, 100, 1);
    expect(a).toEqual({ x: 50, y: 0, w: 50, h: 50 });
  });

  it('centeredAspect fits the largest box', () => {
    expect(centeredAspect(200, 100, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
  });
});

describe('resize spec & naming', () => {
  it('computes sizes for each mode', () => {
    expect(computeResize(6000, 4000, { mode: 'percent', value: 50 })).toEqual({ width: 3000, height: 2000 });
    expect(computeResize(6000, 4000, { mode: 'longEdge', value: 2048 })).toEqual({ width: 2048, height: 1365 });
    expect(computeResize(4000, 6000, { mode: 'longEdge', value: 2048 })).toEqual({ width: 1365, height: 2048 });
    expect(computeResize(10, 10, { mode: 'pixels', width: 0, height: 3 })).toEqual({ width: 1, height: 3 });
  });

  it('export names never overwrite the original', () => {
    expect(exportName('holiday.final.JPG', 'image/jpeg')).toBe('holiday.final-edited.jpg');
    expect(exportName('scan', 'image/png')).toBe('scan-edited.png');
  });
});

import type { Px, Rect, Shape } from './pixels';

/** Region-scoped ops carry the buffer to edit plus the region (in buffer coords). */
interface RegionOp {
  px: Px;
  region: Rect;
  shape: Shape;
}

export type WorkerRequest =
  | { op: 'decode'; file: Blob }
  | { op: 'encode'; px: Px; mime: string; quality?: number }
  | ({ op: 'grayscale' } & RegionOp)
  | ({ op: 'invert' } & RegionOp)
  | ({ op: 'brightnessContrast'; brightness: number; contrast: number } & RegionOp)
  | ({ op: 'blur'; radius: number } & RegionOp)
  | ({ op: 'pixelate'; block: number } & RegionOp)
  | ({ op: 'fill'; rgba: [number, number, number, number] } & RegionOp)
  | { op: 'resize'; px: Px; width: number; height: number }
  | { op: 'crop'; px: Px; rect: Rect }
  | { op: 'rotate'; px: Px; cw: boolean }
  | { op: 'flip'; px: Px; axis: 'h' | 'v' };

export type WorkerResponse =
  | { id: number; ok: true; px?: Px; blob?: Blob }
  | { id: number; ok: false; error: string };

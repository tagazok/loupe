/// <reference lib="webworker" />
/**
 * Image-processing worker. All heavy pixel work happens here so the UI never
 * freezes, even on 20+ MB photos. Buffers are transferred (zero-copy) in and out.
 */
import * as P from './pixels';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

function pxToImageData(px: P.Px): ImageData {
  return new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height);
}

async function handle(req: WorkerRequest): Promise<{ px?: P.Px; blob?: Blob }> {
  switch (req.op) {
    case 'decode': {
      // 'from-image' applies EXIF orientation so phone photos are upright.
      const bmp = await createImageBitmap(req.file, { imageOrientation: 'from-image' });
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas unavailable in worker');
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { px: { width: id.width, height: id.height, data: id.data } };
    }
    case 'encode': {
      const px = req.px;
      if (req.mime === 'image/jpeg') P.flatten(px, [255, 255, 255]);
      const canvas = new OffscreenCanvas(px.width, px.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable in worker');
      ctx.putImageData(pxToImageData(px), 0, 0);
      const blob = await canvas.convertToBlob({ type: req.mime, quality: req.quality });
      return { blob };
    }
    case 'grayscale':
      P.grayscale(req.px, req.region, req.shape);
      return { px: req.px };
    case 'invert':
      P.invert(req.px, req.region, req.shape);
      return { px: req.px };
    case 'brightnessContrast':
      P.brightnessContrast(req.px, req.brightness, req.contrast, req.region, req.shape);
      return { px: req.px };
    case 'blur':
      P.blurRegion(req.px, req.region, req.shape, req.radius);
      return { px: req.px };
    case 'pixelate':
      P.pixelate(req.px, req.region, req.shape, req.block);
      return { px: req.px };
    case 'fill':
      P.fill(req.px, req.region, req.shape, req.rgba);
      return { px: req.px };
    case 'resize':
      return { px: P.resizeLanczos(req.px, req.width, req.height) };
    case 'crop':
      return { px: P.crop(req.px, req.rect) };
    case 'rotate':
      return { px: P.rotate90(req.px, req.cw) };
    case 'flip':
      P.flip(req.px, req.axis);
      return { px: req.px };
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = e.data;
  try {
    const result = await handle(req);
    const msg: WorkerResponse = { id, ok: true, ...result };
    self.postMessage(msg, result.px ? [result.px.data.buffer as ArrayBuffer] : []);
  } catch (err) {
    const msg: WorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(msg);
  }
};

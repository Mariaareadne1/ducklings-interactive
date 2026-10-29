/// <reference lib="webworker" />
import { buildAllShapes } from './shapes';
import { serializeSet, transferables } from './serialize';

// Meshing the signed-distance bodies takes a moment of CPU; it runs here so the pond keeps rendering.
self.onmessage = () => {
  try {
    const packed = serializeSet(buildAllShapes());
    (self as unknown as Worker).postMessage({ packed }, transferables(packed));
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  }
};

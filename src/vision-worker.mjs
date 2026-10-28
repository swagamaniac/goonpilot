// Runs the tagger model off the main thread, so inference (~2 s on a slow CPU) doesn't freeze the server.
import { parentPort, workerData } from 'node:worker_threads';

const ort = await import('onnxruntime-node');
const s = await ort.InferenceSession.create(workerData.model, { intraOpNumThreads: 1, interOpNumThreads: 1 });
parentPort.postMessage({ ready: true });
parentPort.on('message', async ({ id, input }) => {
  try {
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 448, 448, 3]) });
    parentPort.postMessage({ id, p: Float32Array.from(out[s.outputNames[0]].data) });
  } catch (e) { parentPort.postMessage({ id, error: e.message }); }
});

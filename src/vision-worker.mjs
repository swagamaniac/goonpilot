// Runs the tagger model off the main thread, so inference (~2 s on a slow CPU) doesn't freeze the server.
// workerData.device: 'gpu' (DirectML, any DX12 card on Windows), 'cpu' (1 thread), or 'auto' (time one dummy image on both, keep the faster).
import { parentPort, workerData } from 'node:worker_threads';
const ort = await import('onnxruntime-node');
const model = workerData.model;
const make = (kind) => ort.InferenceSession.create(model, kind === 'gpu' ? { executionProviders: ['dml'] } : { intraOpNumThreads: 1, interOpNumThreads: 1 });
const feed = (s, input) => ({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 448, 448, 3]) });
async function time(s) { const x = new Float32Array(448 * 448 * 3).fill(128); await s.run(feed(s, x)); const t = Date.now(); await s.run(feed(s, x)); return Date.now() - t; }

const want = ['gpu', 'cpu', 'auto'].includes(workerData.device) ? workerData.device : 'auto';
const gpuOk = process.platform === 'win32';
let s = null, ep = 'cpu', note = '';
if (want === 'gpu' && gpuOk) { try { s = await make('gpu'); ep = 'gpu'; } catch (e) { note = 'GPU failed, using CPU: ' + e.message.slice(0, 120); } }
if (want === 'auto' && gpuOk) {
  try {
    const g = await make('gpu'), tg = await time(g), c = await make('cpu'), tc = await time(c);
    if (tg <= tc) { s = g; ep = 'gpu'; await c.release?.(); } else { s = c; await g.release?.(); }
    note = `auto: gpu ${tg} ms, cpu ${tc} ms`;
  } catch (e) { note = 'auto: GPU failed, using CPU'; }
}
if (!s) s = await make('cpu');
parentPort.postMessage({ ready: true, ep: ep === 'gpu' ? 'gpu (DirectML)' : 'cpu', note });
parentPort.on('message', async ({ id, input }) => {
  try {
    const out = await s.run(feed(s, input));
    parentPort.postMessage({ id, p: Float32Array.from(out[s.outputNames[0]].data) });
  } catch (e) { parentPort.postMessage({ id, error: e.message }); }
});

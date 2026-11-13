import { analyzeSamples } from './analyze';

self.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  const { samples, sampleRate } = e.data;
  let last = 0;
  const result = analyzeSamples(samples, sampleRate, (f) => {
    if (f - last >= 0.02 || f === 1) {
      last = f;
      (self as unknown as Worker).postMessage({ type: 'progress', value: f });
    }
  });
  (self as unknown as Worker).postMessage({ type: 'done', result });
};

import { optimize } from './engine.js';

self.onmessage = ({ data: { pieces, sheetSize } }) => {
  try {
    let lastPercent = -1;
    const result = optimize(pieces, (label, fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      self.postMessage({ type: 'progress', label, percent });
    }, sheetSize);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};

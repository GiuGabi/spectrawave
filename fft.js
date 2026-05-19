/* ============================================================
   FFT.JS - Transformada Rápida de Fourier (Cooley-Tukey Radix-2)
   IMPLEMENTAÇÃO NATIVA (1D)
   ============================================================ */

(function () {
  'use strict';

  function isPowerOfTwo(n) {
    return n > 0 && (n & (n - 1)) === 0;
  }

  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function fft(real, imag) {
    const n = real.length;
    if (n <= 1) return;
    if (!isPowerOfTwo(n)) {
      throw new Error("A FFT Radix-2 exige potência de 2. Recebido: " + n);
    }

    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const angle = -2 * Math.PI / len;
      
      const wRealStep = Math.cos(angle);
      const wImagStep = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let wReal = 1;
        let wImag = 0;

        for (let k = 0; k < half; k++) {
          const idxA = i + k;
          const idxB = i + k + half;

          const tReal = wReal * real[idxB] - wImag * imag[idxB];
          const tImag = wReal * imag[idxB] + wImag * real[idxB];

          real[idxB] = real[idxA] - tReal;
          imag[idxB] = imag[idxA] - tImag;

          real[idxA] += tReal;
          imag[idxA] += tImag;

          const newWReal = wReal * wRealStep - wImag * wImagStep;
          const newWImag = wReal * wImagStep + wImag * wRealStep;
          wReal = newWReal;
          wImag = newWImag;
        }
      }
    }
  }

  function magnitudes(real, imag) {
    const n = real.length;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return out;
  }

  function applyHannWindow(signal) {
    const n = signal.length;
    for (let i = 0; i < n; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
      signal[i] *= w;
    }
  }

  window.FourierLib = {
    fft,
    magnitudes,
    applyHannWindow,
    isPowerOfTwo,
    nextPowerOfTwo,
  };
})();
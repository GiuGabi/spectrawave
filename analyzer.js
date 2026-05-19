/* ============================================================
   ANALYZER.JS - Analisador Acústico (Implementação Matemática)
   ============================================================ */

if (!window.FourierLib) {
  alert('Erro crítico: fft.js não foi carregado.');
  throw new Error('window.FourierLib ausente.');
}

const { fft, magnitudes, applyHannWindow, nextPowerOfTwo } = window.FourierLib;

const dropZone   = document.getElementById('dropZone');
const fileInput  = document.getElementById('fileInput');
const headerTipo = document.getElementById('headerTipo');
const headerArq  = document.getElementById('headerArq');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = '#FFD600'; });
dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = '#444'; });
dropZone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = '#444'; if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', (e) => { if (e.target.files.length) { handleFile(e.target.files[0]); e.target.value = ''; }});

function showError(msg) {
  const err = document.getElementById('error');
  err.textContent = '⚠ ' + msg;
  err.classList.add('visible');
  window.setLoading(false);
}

async function handleFile(file) {
  window.setLoading(true);
  headerArq.textContent = file.name.toUpperCase();
  
  const mime = (file.type || '').toLowerCase();
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  const isAudio = mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext);

  try {
    if (isAudio) {
      headerTipo.textContent = 'SINAL ACÚSTICO';
      await processAudio(file);
    } else {
      throw new Error("Formato inválido. O SpectraWave processa apenas arquivos de áudio.");
    }
  } catch (err) {
    console.error(err);
    showError('Falha de processamento: ' + (err.message || err));
  }
}

// ==========================================
// PROCESSAMENTO ÁUDIO 1D
// ==========================================
async function processAudio(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let audioBuffer;
  try { audioBuffer = await ctx.decodeAudioData(arrayBuffer); } catch (e) { throw new Error("Não foi possível decodificar os dados de áudio."); }

  const sampleRate = audioBuffer.sampleRate;
  const length     = audioBuffer.length;
  
  const mono = new Float32Array(length);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= audioBuffer.numberOfChannels;

  const fftSize = Math.min(32768, nextPowerOfTwo(Math.min(length, 32768)));
  
  // Identificação do trecho RMS máximo
  let maxRms = -1;
  let bestStartIdx = 0;
  const stepSize = Math.floor(sampleRate / 4); 
  
  for (let i = 0; i <= length - fftSize; i += stepSize) {
    let sumSq = 0;
    for (let j = 0; j < fftSize; j += 10) { 
      sumSq += mono[i + j] * mono[i + j];
    }
    if (sumSq > maxRms) {
      maxRms = sumSq;
      bestStartIdx = i;
    }
  }

  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize); 
  let totalEnergyTime = 0;
  
  for (let i = 0; i < fftSize; i++) {
    real[i] = mono[bestStartIdx + i] || 0;
    totalEnergyTime += (real[i] * real[i]);
  }

  drawWaveform(real, sampleRate);

  applyHannWindow(real);   
  fft(real, imag);
  const mags = magnitudes(real, imag);
  const halfBins = fftSize / 2;
  
  drawSpectrum(mags, halfBins, sampleRate, fftSize);

  const freqResolution = sampleRate / fftSize;
  const minBinIndex = Math.ceil(20 / freqResolution); 

  // Extração de magnitude e fase
  let peaks = [];
  for (let i = minBinIndex; i < halfBins; i++) {
    const phaseRad = Math.atan2(imag[i], real[i]);
    peaks.push({ 
        index: i, 
        hz: i * freqResolution,
        mag: mags[i], 
        r: real[i], 
        i: imag[i],
        phase: phaseRad
    });
  }
  
  peaks.sort((a, b) => b.mag - a.mag);
  
  const top5Peaks = peaks.slice(0, 5);
  const fundamental = top5Peaks[0];
  const nyquist = sampleRate / 2;

  // Cálculo por integração numérica da Série de Fourier
  const fourierData = calculateFourierSeries(mono, sampleRate, fundamental.hz, 3);

  const opsO2 = Math.pow(fftSize, 2);
  const opsRadix = fftSize * Math.log2(fftSize);

  fillInfo([
    ['Arquivo', file.name, false],
    ['Tamanho', formatBytes(file.size), false],
    ['Taxa de Amostragem ($f_s$)', sampleRate + ' Hz', false],
    ['Resolução ($f_s/N$)', freqResolution.toFixed(2) + ' Hz', false],
    ['Freq. Nyquist', nyquist + ' Hz', false],
    ['Freq. Fundamental ($f_0$)', fundamental.hz.toFixed(2) + ' Hz', true],
    ['Componente DC', fourierData.a0.toFixed(4), false],
    ['Operações Radix-2', opsRadix.toLocaleString(), false],
    ['Otimização vs O(N²)', `${((opsO2 - opsRadix) / 1000000).toFixed(0)} Mi Op. Poupadas`, true]
  ]);

  showAudioFormula({ 
      fftSize, freqResolution, 
      top5Peaks, 
      fourierCoeffs: fourierData.coeffs, 
      a0: fourierData.a0,
      fundamentalHz: fundamental.hz, 
      fileName: file.name
  });

  ctx.close();
  window.showResults();
}

// ==========================================
// RENDERIZAÇÃO GRÁFICA
// ==========================================
function drawWaveform(samples, sampleRate) {
  const canvas = document.getElementById('canvasOriginal');
  const duration = samples.length / sampleRate;
  document.getElementById('panelOriginalTitle').textContent = 'TRECHO ANALISADO (DOMÍNIO DO TEMPO)';
  document.getElementById('panelOriginalMeta').textContent = `${(duration * 1000).toFixed(0)} ms (Clímax RMS)`;
  setupCanvas(canvas, 1000, 300); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#050505'; ctx.fillRect(0,0, canvas.width, canvas.height);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, canvas.height/2); ctx.lineTo(canvas.width, canvas.height/2); ctx.stroke();
  ctx.fillStyle = '#666'; ctx.font = '10px "Fira Code"'; ctx.textAlign = 'center';
  for(let i=1; i<5; i++) { let x = (i/5) * canvas.width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); ctx.fillText(((i/5) * duration).toFixed(3) + 's', x, canvas.height - 10); }
  const step = Math.max(1, Math.floor(samples.length / canvas.width));
  ctx.strokeStyle = '#FFD600'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const i = x * step; let min = 1, max = -1;
    for (let j = 0; j < step && i + j < samples.length; j++) {
      const v = samples[i + j]; if (v < min) min = v; if (v > max) max = v;
    }
    let yMin = (1 - max) * (canvas.height/2 - 20) + 20; let yMax = (1 - min) * (canvas.height/2 - 20) + 20;
    ctx.moveTo(x, yMin); ctx.lineTo(x, yMax);
  }
  ctx.stroke();
}

function drawSpectrum(mags, halfBins, sampleRate, fftSize) {
  const canvas = document.getElementById('canvasSpectrum');
  document.getElementById('panelSpectrumTitle').textContent = 'DENSIDADE ESPECTRAL DE POTÊNCIA';
  document.getElementById('panelSpectrumMeta').textContent = 'Log-X (Hz) / Log-Y (dB)';
  setupCanvas(canvas, 1000, 300); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#050505'; ctx.fillRect(0,0, canvas.width, canvas.height);
  let maxMag = 1e-9; for (let i = 1; i < halfBins; i++) if (mags[i] > maxMag) maxMag = mags[i];
  const logMin = Math.log10(20), logMax = Math.log10(sampleRate / 2);
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#666'; ctx.font = '10px "Fira Code"'; ctx.textAlign = 'center';
  const markersHz = [50, 100, 500, 1000, 5000, 10000, 20000];
  markersHz.forEach(hz => {
      if(hz > sampleRate/2) return;
      const x = ((Math.log10(hz) - logMin) / (logMax - logMin)) * canvas.width;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      ctx.fillText(hz >= 1000 ? (hz/1000)+'k' : hz, x, canvas.height - 10);
  });
  ctx.textAlign = 'left';
  const markersDb = [0, -20, -40, -60];
  markersDb.forEach(db => {
      const norm = Math.max(0, (db + 80) / 80);
      const y = canvas.height - norm * (canvas.height - 40) - 20;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      ctx.fillText(db+'dB', 5, y - 5);
  });
  ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1.5; ctx.beginPath();
  let firstPoint = true;
  for (let i = 1; i < halfBins; i++) {
    const hz = (i * sampleRate) / fftSize; if (hz < 20) continue;
    const x = ((Math.log10(hz) - logMin) / (logMax - logMin)) * canvas.width;
    const db = 20 * Math.log10(mags[i] / maxMag + 1e-9);
    const norm = Math.max(0, (db + 80) / 80);
    const y = canvas.height - norm * (canvas.height - 40) - 20;
    firstPoint ? ctx.moveTo(x, y) : ctx.lineTo(x, y); firstPoint = false;
  }
  ctx.stroke();
}

function setupCanvas(canvas, w, h) { canvas.width = w; canvas.height = h; }
function formatBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(2) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; }

function fillInfo(rows) {
  const grid = document.getElementById('infoGrid'); grid.innerHTML = '';
  rows.forEach(([label, value, highlight]) => {
    grid.innerHTML += `<div class="info-cell"><div class="label">${label}</div><div class="value${highlight ? ' highlight' : ''}">${value}</div></div>`;
  });
}

function renderKatex(container) {
  if (window.renderMathInElement) {
    window.renderMathInElement(container, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
  }
}

/* ============================================================
   GERAÇÃO DINÂMICA DE FÓRMULAS
   ============================================================ */
function showAudioFormula({ fftSize, freqResolution, top5Peaks, fourierCoeffs, a0, fundamentalHz, fileName }) {
  document.getElementById('formulaMetaInfo').textContent = 'Equações Algébricas Geradas';
  const body = document.getElementById('formulaBody');
  
  let dftEquationTex = `\\begin{aligned}\n`;
  top5Peaks.slice(0, 3).forEach((p, idx) => {
    let signI = p.i >= 0 ? '+' : '-';
    dftEquationTex += `X[${p.index}] &\\approx ${p.r.toFixed(5)} ${signI} ${Math.abs(p.i).toFixed(5)}i = ${p.mag.toFixed(3)} e^{i(${p.phase.toFixed(3)})}\\\\\n`;
  });
  dftEquationTex += `\\end{aligned}`;

  let fourierEquationTex = `\\begin{aligned}\nf(t) &\\approx ${(a0/2).toFixed(6)} \\\\\n`;
  fourierCoeffs.forEach((c) => {
    let termAn = c.an >= 0 ? `+ ${c.an.toFixed(6)}` : `- ${Math.abs(c.an).toFixed(6)}`;
    let termBn = c.bn >= 0 ? `+ ${c.bn.toFixed(6)}` : `- ${Math.abs(c.bn).toFixed(6)}`;
    let freq = (c.n * fundamentalHz).toFixed(1);
    fourierEquationTex += `&\\quad ${termAn} \\cos(2\\pi \\cdot ${freq} t) ${termBn} \\sin(2\\pi \\cdot ${freq} t) \\\\\n`;
  });
  fourierEquationTex += `\\end{aligned}`;

  let dftRows = '';
  top5Peaks.forEach((p, index) => {
    const isFund = index === 0 ? '<span class="formula-tag">FUNDAMENTAL</span>' : `HARMÔNICA ${index}`;
    dftRows += `<tr>
        <td>${p.index}</td>
        <td style="color:#fff; font-weight:bold;">${p.hz.toFixed(2)} Hz</td>
        <td class="val-real">${p.r.toFixed(5)}</td><td class="val-imag">${p.i.toFixed(5)}</td>
        <td class="val-mag">${p.mag.toFixed(5)}</td><td>${p.phase.toFixed(3)} rad</td>
        <td>${isFund}</td>
      </tr>`;
  });

  let fourierRows = '';
  fourierCoeffs.forEach((c) => {
    const freqVal = c.n * fundamentalHz;
    const isFund = c.n === 1 ? '<span class="formula-tag">FUNDAMENTAL</span>' : `HARMÔNICA ${c.n}`;
    fourierRows += `<tr>
        <td>${c.n}</td>
        <td style="color:#fff; font-weight:bold;">${freqVal.toFixed(2)} Hz</td>
        <td class="val-real">${c.an.toFixed(6)}</td><td class="val-imag">${c.bn.toFixed(6)}</td>
        <td class="val-mag">${c.mag.toFixed(6)}</td><td>${isFund}</td>
      </tr>`;
  });

  body.innerHTML = `
    <div class="formula-step">
      <div class="step-title">[00] DESCRIÇÃO DO SISTEMA E PROCESSAMENTO</div>
      <p>O <strong>SpectraWave</strong> é um analisador de processamento de sinais executado localmente no navegador. Ele escaneia o arquivo de áudio para identificar o trecho de maior amplitude (pico RMS) e aplica métodos de análise harmônica para decompor a onda acústica em suas componentes estruturais de frequência e fase.</p>
    </div>

    <div class="formula-step">
      <div class="step-title">[01] TRANSFORMADA DISCRETA DE FOURIER (DFT)</div>
      <p>A <strong>Transformada Discreta de Fourier (DFT)</strong> converte o vetor de dados de amplitude do "Domínio do Tempo" para o "Domínio da Frequência", isolando quantitativamente o espectro de frequências do sinal.</p>
      <p>A equação abaixo descreve a correlação discreta do vetor de amostras $x[n]$ com um conjunto de bases ortogonais complexas. Utilizando a Identidade de Euler, calcula-se com precisão a magnitude (amplitude absoluta) e a fase (deslocamento angular) correspondentes a cada bin de frequência $k$.</p>
      <div class="formula-block">$$ X[k] = \\sum_{n=0}^{N-1} x[n] \\cdot \\left[ \\cos\\left(\\frac{2\\pi k n}{N}\\right) - i\\sin\\left(\\frac{2\\pi k n}{N}\\right) \\right] $$</div>
      <div class="sub-info">Nota: $X[k]$ representa a componente complexa no bin de frequência $k$, possuindo partes Real ($a$) e Imaginária ($b$).</div>
    </div>
    
    <div class="formula-step">
      <div class="step-title">[02] SÉRIE DE FOURIER CONTÍNUA (EQUAÇÃO BASE)</div>
      <p>A Série Trigonométrica de Fourier estabelece que um sinal periódico no tempo contínuo $f(t)$ pode ser representado linearmente pela soma de uma componente de corrente contínua (nível DC, $a_0$) com infinitas funções harmônicas seno e cosseno:</p>
      <div class="formula-block">$$ f(t) = \\frac{a_0}{2} + \\sum_{n=1}^{\\infty} \\left[ a_n \\cos(2\\pi n f_0 t) + b_n \\sin(2\\pi n f_0 t) \\right] $$</div>
    </div>

    <div class="formula-step">
      <div class="step-title" style="color:var(--term-green);">[03] EQUAÇÃO POLAR APLICADA (DFT) PARA "${fileName}"</div>
      <p>Substituição dos valores espectrais dominantes extraídos do arquivo, utilizando a notação polar complexa ($X[k] = a + bi = |X|e^{i\\phi}$):</p>
      <div class="formula-block" style="border-left-color:var(--term-green);">$$ ${dftEquationTex} $$</div>
      
      <div class="coef-table-wrapper">
        <table class="coef-table">
          <thead><tr><th>Bin ($k$)</th><th>Frequência ($f_k$)</th><th>Real ($a_k$)</th><th>Imag ($b_k$)</th><th>Mag ($|X|$)</th><th>Fase ($\\phi$)</th><th>Classificação</th></tr></thead>
          <tbody>${dftRows}</tbody>
        </table>
      </div>
    </div>

    <div class="formula-step">
      <div class="step-title" style="color:var(--term-green);">[04] SÉRIE TRIGONOMÉTRICA EXPANDIDA PARA "${fileName}"</div>
      <p>Substituição da componente DC ($a_0$) e dos coeficientes numéricos $a_n$ e $b_n$ obtidos por integração numérica para a expansão algébrica dos primeiros termos do sinal:</p>
      <div class="formula-block" style="border-left-color:var(--term-green);">$$ ${fourierEquationTex} $$</div>
      
      <div class="coef-table-wrapper">
        <table class="coef-table">
          <thead><tr><th>$n$</th><th>Freq. ($n \\cdot f_0$)</th><th>$a_n$ (Cosseno)</th><th>$b_n$ (Seno)</th><th>Magnitude</th><th>Classificação</th></tr></thead>
          <tbody>${fourierRows}</tbody>
        </table>
      </div>
    </div>
  `;
  renderKatex(body);
}

// ==========================================
// CÁLCULO DA SÉRIE DE FOURIER (NATIVA)
// ==========================================
function calculateFourierSeries(samples, sampleRate, fundamentalHz, numHarmonics = 3) {
  const periodSamples = Math.floor(sampleRate / fundamentalHz);
  const coefficients = [];

  if (periodSamples <= 0) return { a0: 0, coeffs: [] };

  // Componente DC (a0)
  let a0 = 0;
  for (let i = 0; i < periodSamples; i++) {
    if (i < samples.length) a0 += samples[i];
  }
  a0 = (2 / periodSamples) * a0;

  // Calculando an e bn 
  for (let n = 1; n <= numHarmonics; n++) {
    let an = 0, bn = 0;
    
    for (let i = 0; i < periodSamples; i++) {
      if (i >= samples.length) break; 
      const t = i / sampleRate;
      const omega = 2 * Math.PI * n * fundamentalHz * t;
      an += samples[i] * Math.cos(omega);
      bn += samples[i] * Math.sin(omega);
    }
    
    an = (2 / periodSamples) * an;
    bn = (2 / periodSamples) * bn;
    
    coefficients.push({ n, an, bn, mag: Math.sqrt(an*an + bn*bn) });
  }
  return { a0, coeffs: coefficients };
}
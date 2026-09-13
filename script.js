const canvas = document.getElementById('graph-canvas');
const ctx = canvas.getContext('2d');
const funcInput = document.getElementById('func-input');
const showDerivativeCheckbox = document.getElementById('show-derivative');
const paramSlider = document.getElementById('param-a');
const paramValLabel = document.getElementById('param-val');
const animateBtn = document.getElementById('animate-btn');
const resetBtn = document.getElementById('reset-view-btn');
const coordHud = document.getElementById('coord-hud');
const presetButtons = document.querySelectorAll('.preset-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const analysisPanel = document.getElementById('analysis-panel');
const analysisContent = document.getElementById('analysis-content');

// Durum
let width, height;
let scale = 60;
let origin = { x: 0, y: 0 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let isAnimating = false;
let animSpeed = 0.02;

// Analiz & Animasyon Durumu
let detectedRoots = [];
let detectedExtrema = [];
let scanProgress = -1;
let isAnalyzing = false;

// Matematiksel İfadeyi Saf JS Fonksiyonuna Dönüştürücü (Parser)
function parseMathExpression(str) {
  let expr = str.toLowerCase();
  
  // ^ işaretini ** ile değiştir
  expr = expr.replace(/\^/g, '**');

  // Standart matematik fonksiyonlarını JS Math nesnesine eşle
  const funcs = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp', 'log', 'ln'];
  funcs.forEach(fn => {
    const target = fn === 'ln' ? 'Math.log' : `Math.${fn}`;
    const regex = new RegExp(`\\b${fn}\\b`, 'g');
    expr = expr.replace(regex, target);
  });

  // pi ve e sabitleri
  expr = expr.replace(/\bpi\b/g, 'Math.PI');
  expr = expr.replace(/\be\b/g, 'Math.E');

  // Örtük çarpımları düzelt (Örn: 2x -> 2*x, 3sin -> 3*Math.sin, x(x) -> x*(x))
  expr = expr.replace(/(\d)([a-zA-Z(])/g, '$1*$2');
  expr = expr.replace(/([a-zA-Z)])(\d)/g, '$1*$2');
  expr = expr.replace(/(\))(\()/g, '$1*$2');

  try {
    const fn = new Function('x', 'a', `try { return ${expr}; } catch(e) { return NaN; }`);
    // Test et
    const testVal = fn(1, 1);
    if (typeof testVal !== 'number') throw new Error('Invalid');
    funcInput.style.borderColor = "var(--border-color)";
    return fn;
  } catch (err) {
    funcInput.style.borderColor = "var(--derivative-color)";
    return null;
  }
}

let currentFunc = parseMathExpression(funcInput.value);

function resizeCanvas() {
  width = canvas.parentElement.clientWidth;
  height = canvas.parentElement.clientHeight;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  if (origin.x === 0 && origin.y === 0) {
    origin.x = width / 2;
    origin.y = height / 2;
  }
  draw();
}

const toScreenX = (x) => origin.x + x * scale;
const toScreenY = (y) => origin.y - y * scale;
const toMathX = (px) => (px - origin.x) / scale;
const toMathY = (py) => (origin.y - py) / scale;

function evaluateFunc(xVal, paramA) {
  if (!currentFunc) return NaN;
  try {
    return currentFunc(xVal, paramA);
  } catch {
    return NaN;
  }
}

// Analiz Fonksiyonu
function runFunctionAnalysis() {
  if (!currentFunc) return;

  const a = parseFloat(paramSlider.value);
  const exprStr = funcInput.value.toLowerCase();
  
  // Tür Tespiti
  let typeStr = "Genel Fonksiyon";
  if (exprStr.includes("sin") || exprStr.includes("cos") || exprStr.includes("tan")) typeStr = "Trigonometrik Fonksiyon";
  else if (exprStr.includes("exp") || exprStr.includes("e^")) typeStr = "Üstel Fonksiyon";
  else if (exprStr.includes("log") || exprStr.includes("ln")) typeStr = "Logaritmik Fonksiyon";
  else if (exprStr.includes("^3")) typeStr = "3. Dereceden Polinom (Kübik)";
  else if (exprStr.includes("^2")) typeStr = "2. Dereceden Polinom (Parabol)";
  else if (exprStr.includes("x") && !exprStr.includes("^")) typeStr = "Doğrusal (Lineer) Fonksiyon";

  // Simetri Kontrolü
  let isEven = true, isOdd = true;
  for (let testX of [0.5, 1.2, 2.5]) {
    let f_pos = evaluateFunc(testX, a);
    let f_neg = evaluateFunc(-testX, a);
    if (isNaN(f_pos) || isNaN(f_neg)) { isEven = false; isOdd = false; break; }
    if (Math.abs(f_pos - f_neg) > 1e-3) isEven = false;
    if (Math.abs(f_pos + f_neg) > 1e-3) isOdd = false;
  }
  let symmetryStr = isEven ? "Çift Fonksiyon (y-eksenine göre simetrik)" : (isOdd ? "Tek Fonksiyon (orijine göre simetrik)" : "Simetrisi Yok");

  // y-kesim f(0)
  let yIntercept = evaluateFunc(0, a);
  let yIntStr = (!isNaN(yIntercept) && isFinite(yIntercept)) ? `(0, ${yIntercept.toFixed(2)})` : "Tanımsız";

  // Kökler ve Ekstremum Noktaları
  detectedRoots = [];
  detectedExtrema = [];
  const minX = toMathX(0);
  const maxX = toMathX(width);
  const step = (maxX - minX) / 1000;
  const h = 1e-5;

  let prevY = evaluateFunc(minX, a);
  let prevDy = (evaluateFunc(minX + h, a) - evaluateFunc(minX - h, a)) / (2 * h);

  for (let x = minX; x <= maxX; x += step) {
    let y = evaluateFunc(x, a);
    let dy = (evaluateFunc(x + h, a) - evaluateFunc(x - h, a)) / (2 * h);

    if (prevY * y < 0 && Math.abs(y - prevY) < 10) {
      let rootX = x - y * (step / (y - prevY));
      if (!detectedRoots.some(r => Math.abs(r - rootX) < 0.2)) {
        detectedRoots.push(rootX);
      }
    }

    if (prevDy * dy < 0 && Math.abs(dy - prevDy) < 5) {
      let extX = x;
      let extY = evaluateFunc(extX, a);
      let extType = prevDy > 0 ? "Yerel Maksimum" : "Yerel Minimum";
      if (!detectedExtrema.some(e => Math.abs(e.x - extX) < 0.2)) {
        detectedExtrema.push({ x: extX, y: extY, type: extType });
      }
    }

    prevY = y;
    prevDy = dy;
  }

  // UI Güncelle
  analysisContent.innerHTML = `
    <p><strong>Tür:</strong> ${typeStr}</p>
    <p><strong>Simetri:</strong> ${symmetryStr}</p>
    <p><strong>y-Kesim:</strong> ${yIntStr}</p>
    <p><strong>Kökler:</strong> ${detectedRoots.length > 0 ? detectedRoots.map(r => r.toFixed(2)).join(', ') : 'Görünür alanda yok'}</p>
    <p><strong>Kritik Noktalar:</strong> ${detectedExtrema.length > 0 ? detectedExtrema.map(e => `${e.type}: (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`).join('<br>') : 'Yok'}</p>
  `;
  analysisPanel.classList.remove('hidden');

  scanProgress = 0;
  isAnalyzing = true;
}

function drawGrid() {
  ctx.clearRect(0, 0, width, height);
  const roughGridSize = 60;
  let unit = Math.pow(10, Math.floor(Math.log10(roughGridSize / scale)));
  if (scale * unit < 30) unit *= 2;
  if (scale * unit < 30) unit *= 2.5;

  const step = unit * scale;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#64748b';
  ctx.font = '10px monospace';

  const startX = origin.x % step;
  for (let x = startX; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    const mathX = Number(toMathX(x).toFixed(2));
    if (Math.abs(mathX) > 1e-4) ctx.fillText(mathX, x + 4, origin.y - 4);
  }

  const startY = origin.y % step;
  for (let y = startY; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    const mathY = Number(toMathY(y).toFixed(2));
    if (Math.abs(mathY) > 1e-4) ctx.fillText(mathY, origin.x + 4, y - 4);
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(0, origin.y); ctx.lineTo(width, origin.y);
  ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, height);
  ctx.stroke();
}

function drawCurves() {
  if (!currentFunc) return;

  const a = parseFloat(paramSlider.value);
  const showDerivative = showDerivativeCheckbox.checked;
  const h = 1e-5;

  // Ana Fonksiyon f(x)
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#38bdf8';
  ctx.beginPath();

  let started = false;
  for (let px = 0; px <= width; px += 1) {
    const x = toMathX(px);
    const y = evaluateFunc(x, a);

    if (isNaN(y) || !isFinite(y) || Math.abs(y) > 1e4) {
      started = false;
      continue;
    }

    const py = toScreenY(y);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();

  // Türev f'(x)
  if (showDerivative) {
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#f43f5e';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    started = false;
    for (let px = 0; px <= width; px += 2) {
      const x = toMathX(px);
      const dy = (evaluateFunc(x + h, a) - evaluateFunc(x - h, a)) / (2 * h);
      if (isNaN(dy) || !isFinite(dy) || Math.abs(dy) > 1e4) {
        started = false;
        continue;
      }
      const py = toScreenY(dy);
      if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Analiz Vurguları & Lazer Taraması
  if (isAnalyzing) {
    const currentScanPx = scanProgress * width;

    if (scanProgress <= 1.0) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(currentScanPx, 0);
      ctx.lineTo(currentScanPx, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Kök Noktaları (Yeşil)
    detectedRoots.forEach(r => {
      const px = toScreenX(r);
      if (px <= currentScanPx || scanProgress > 1.0) {
        const py = toScreenY(0);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '11px monospace';
        ctx.fillText(`Kök: ${r.toFixed(2)}`, px - 25, py - 12);
      }
    });

    // Ekstremum Noktaları (Turuncu)
    detectedExtrema.forEach(e => {
      const px = toScreenX(e.x);
      if (px <= currentScanPx || scanProgress > 1.0) {
        const py = toScreenY(e.y);
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '11px monospace';
        ctx.fillText(`${e.type.split(' ')[1]}: (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`, px + 8, py - 6);
      }
    });
  }
}

function draw() {
  drawGrid();
  drawCurves();
}

// Olay Dinleyicileri
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  origin.x = e.offsetX - (e.offsetX - origin.x) * zoomFactor;
  origin.y = e.offsetY - (e.offsetY - origin.y) * zoomFactor;
  scale *= zoomFactor;
  if (isAnalyzing) runFunctionAnalysis();
  draw();
});

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStart = { x: e.clientX - origin.x, y: e.clientY - origin.y };
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    origin.x = e.clientX - dragStart.x;
    origin.y = e.clientY - dragStart.y;
    draw();
  }
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (mx >= 0 && mx <= width && my >= 0 && my <= height) {
    coordHud.textContent = `x: ${toMathX(mx).toFixed(2)}, y: ${toMathY(my).toFixed(2)}`;
  }
});

window.addEventListener('mouseup', () => isDragging = false);

funcInput.addEventListener('input', () => {
  currentFunc = parseMathExpression(funcInput.value);
  isAnalyzing = false;
  analysisPanel.classList.add('hidden');
  draw();
});

paramSlider.addEventListener('input', () => {
  paramValLabel.textContent = parseFloat(paramSlider.value).toFixed(1);
  if (isAnalyzing) runFunctionAnalysis();
  draw();
});

showDerivativeCheckbox.addEventListener('change', draw);

resetBtn.addEventListener('click', () => {
  scale = 60;
  origin = { x: width / 2, y: height / 2 };
  draw();
});

analyzeBtn.addEventListener('click', runFunctionAnalysis);

presetButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    funcInput.value = btn.dataset.expr;
    currentFunc = parseMathExpression(funcInput.value);
    runFunctionAnalysis();
    draw();
  });
});

function loop() {
  let needsRedraw = false;

  if (isAnimating) {
    let val = parseFloat(paramSlider.value) + animSpeed;
    if (val > parseFloat(paramSlider.max) || val < parseFloat(paramSlider.min)) {
      animSpeed = -animSpeed;
    }
    paramSlider.value = val;
    paramValLabel.textContent = val.toFixed(1);
    if (isAnalyzing) runFunctionAnalysis();
    needsRedraw = true;
  }

  if (isAnalyzing && scanProgress >= 0 && scanProgress <= 1.05) {
    scanProgress += 0.02;
    needsRedraw = true;
  }

  if (needsRedraw) {
    draw();
  }

  requestAnimationFrame(loop);
}

animateBtn.addEventListener('click', () => {
  isAnimating = !isAnimating;
  animateBtn.textContent = isAnimating ? "⏸ Duraklat" : "▶ Oynat";
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
loop();
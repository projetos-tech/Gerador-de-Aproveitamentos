import { DEFAULT_SHEET, MAX_PIECES, makePiece, rotatePiece, serialPiece, sheetDimensions, pointDistance2 } from './geometry.js';
import { STRATEGIES, planStock, validateLayout, freeRectangle, refreshPatterns } from './engine.js';
import { EXAMPLE, readFile, exportDxf } from './formats.js';

const svgNS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const sizeNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, style: 'percent' });
const storageKey = 'polionda.lote.v1';
const palette = [
  ['#beb4fa', '#6550ca', '#402e99', '#f0eaff'],
  ['#a0e0d1', '#3d987e', '#185843', '#e6f8f2'],
  ['#ffd59f', '#bd791f', '#744812', '#fff2de'],
  ['#a8cdf9', '#4d80be', '#284d82', '#e9f3ff'],
  ['#f2aaca', '#ad4a76', '#7b2851', '#fff0f6'],
  ['#c6de93', '#77973a', '#485d24', '#f2f8e4'],
  ['#a8d6e6', '#54788f', '#335065', '#e6f4f9'],
  ['#e4b8fa', '#945fb2', '#673487', '#f7ecfe']
];

const icons = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8 10.5v-4a4 4 0 0 1 8 0v4M12 14.5v2.5"/>',
  flask: '<path d="M9 3h6m-5 0v7l-5.4 8.1A1.8 1.8 0 0 0 6.1 21h11.8a1.8 1.8 0 0 0 1.5-2.9L14 10V3M8 14h8"/>',
  sheet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7.5h7m-7 4.5h7m-7 4.5h4"/>',
  area: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16m-9 0v10"/>',
  chart: '<path d="M4 19h16M7 15v-3m5 3V8m5 7V5"/>',
  scrap: '<path d="M12 4a8 8 0 1 0 8 8h-8V4Z"/><path d="M15.5 3.3a6.5 6.5 0 0 1 5.2 5.2h-5.2V3.3Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-.7 13H6.7L6 7m4 3v6m4-6v6"/>',
  edit: '<path d="M13.5 6.5l4 4M5 19l4.6-.9L20 7.7a1.4 1.4 0 0 0 0-2L18.3 4a1.4 1.4 0 0 0-2 0L5.9 14.4 5 19Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  check: '<path d="m5 12 4 4 10-9"/>',
  nest: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h8v10m0-7h10m-5 0v7"/>',
  file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h4m-9 4h6m-6 4h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  ruler: '<path d="m3 16 13-13 5 5L8 21l-5-5Z"/><path d="m7 12 2 2m1-5 2 2m1-5 2 2"/>'
};

function showIcons(root = document) {
  for (const target of root.querySelectorAll('[data-icon]')) {
    const svg = vector('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' });
    svg.innerHTML = icons[target.dataset.icon];
    target.replaceChildren(svg);
  }
}

function node(tag, text, className) {
  const elem = document.createElement(tag);
  if (text != null) elem.textContent = text;
  if (className) elem.className = className;
  return elem;
}

function vector(tag, attrs = {}, text) {
  const elem = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) elem.setAttribute(key, value);
  if (text) elem.textContent = text;
  return elem;
}

function newId() {
  return crypto.randomUUID();
}

function example() { return EXAMPLE.map(raw => makePiece(raw, newId())); }

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.pieces)) {
      let sheetSize = DEFAULT_SHEET;
      try { sheetSize = sheetDimensions(saved.sheetSize ?? DEFAULT_SHEET); }
      catch {}
      return { pieces: saved.pieces.map(raw => makePiece(raw)), demo: Boolean(saved.demo), sheetSize };
    }
  } catch {}
  return { pieces: example(), demo: true, sheetSize: DEFAULT_SHEET };
}

let { pieces, demo, sheetSize } = restore();
let result = null, active = null, sheetIndex = 0, worker = null, busy = false, message = '', failed = false;
let runId = 0, startupTimer = 0;
let zoom = 1, editing = null, importFile = null;
let canSave = true;

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({ pieces: pieces.map(serialPiece), demo, sheetSize })); }
  catch { canSave = false; }
}

function color(id) {
  return palette[Math.max(0, pieces.findIndex(p => p.id === id)) % palette.length];
}
const squareMetres = n => decimal.format(n / 1e6) + ' m²';
const sheetArea = s => s.size.width * s.size.height;
const grossArea = p => p.sheets.reduce((sum,s)=>sum+sheetArea(s),0);
let stock = [], roles = {}, pending = [], selected = null;
const objective = () => $('objective').value;
const lotQuantity = () => pieces.reduce((sum, piece) => sum + piece.quantity, 0);
const plan = () => result?.plans.find(p => p.id === active);

function setUnit(id, value, unit) {
  const target = $(id);
  target.textContent = value;
  if (unit) target.append(node('span', unit, 'metric-unit'));
}

function pathOf(rings, closed = true) {
  return rings.map(points => 'M' + points.map(([x, y]) => x + ',' + y).join('L') + (closed ? 'Z' : '')).join(' ');
}

function thumb(piece) {
  const box = node('span', null, 'piece-thumb');
  const [fill, stroke, , background] = color(piece.id);
  box.style.backgroundColor = background;
  const pad = Math.max(piece.width, piece.height) * 0.11;
  const svg = vector('svg', {
    viewBox: [-pad, -pad, piece.width + pad * 2, piece.height + pad * 2].join(' '),
    'aria-hidden': 'true'
  });
  svg.append(vector('path', {
    d: pathOf([piece.outer, ...piece.holes]), fill, stroke, 'fill-rule': 'evenodd', 'stroke-width': 1.1,
    'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round'
  }));
  if (piece.paths?.length) svg.append(vector('path', {
    d: pathOf(piece.paths, false), fill: 'none', stroke, 'stroke-width': 1.1, 'vector-effect': 'non-scaling-stroke'
  }));
  box.append(svg);
  return box;
}

function renderLot() {
  $('material-size').textContent = sizeNumber.format(sheetSize.width) + ' × ' + sizeNumber.format(sheetSize.height);
  $('material-border').textContent = sizeNumber.format(sheetSize.border) + ' mm';
  $('material-gap').textContent = sizeNumber.format(sheetSize.gap) + ' mm';
  $('material-step').textContent = sizeNumber.format(sheetSize.rotationStep) + '°';
  $('border-legend').hidden = sheetSize.border === 0;
  const list = $('pieces');
  list.replaceChildren();
  for (const piece of pieces) {
    const button = node('button', null, 'piece-row');
    button.type = 'button';
    button.setAttribute('aria-label', 'Editar ' + piece.name + ', quantidade ' + piece.quantity);
    const info = node('span', null, 'piece-info');
    info.append(
      node('strong', piece.name),
      node('small', int.format(piece.width) + ' × ' + int.format(piece.height) + ' mm · ' + (piece.orientation === 'fixed' ? '0°/180°' : 'Livre'))
    );
    button.append(thumb(piece), info, node('span', '×' + piece.quantity, 'quantity'));
    button.addEventListener('click', () => openPiece(piece));
    const li = node('li');
    li.append(button);
    list.append(li);
  }
  if (!pieces.length) list.append(node('li', 'Adicione uma peça ou importe um arquivo para começar.', 'empty-lot'));
  const total = lotQuantity();
  $('lot-source').textContent = (demo ? 'Exemplo · ' : '') + (total === 1 ? '1 peça' : total + ' peças');
  $('clear-lot').disabled = !pieces.length;
  $('optimize').disabled = !pieces.length || busy;
  $('optimize-label').textContent = busy ? 'Calculando…' : 'Otimizar encaixe';
  $('lot-status').textContent = message || (!canSave ? 'O navegador impediu o salvamento do lote e do tamanho da chapa.' : '');
  $('lot-status').classList.toggle('fail', failed || !canSave);
}

function renderStrategies() {
  $('ranking-note').textContent = objective() === 'repeat'
    ? 'Recomendado pela menor quantidade de padrões de corte. Em caso de empate, prioriza menos chapas.'
    : 'Recomendado pela menor quantidade de chapas. O desempate considera a sobra reta e depois a quantidade de padrões.';
  const tbody = $('strategies');
  tbody.replaceChildren();
  for (const [id, strategy] of Object.entries(STRATEGIES)) {
    const candidate = result?.plans.find(p => p.id === id);
    const row = node('tr', null, id === active && candidate ? 'current' : '');
    const name = node('td');
    const button = node('button', null, 'strategy-button');
    button.type = 'button';
    button.title = strategy.description;
    button.disabled = !candidate;
    button.setAttribute('aria-pressed', String(id === active));
    button.append(node('span', null, 'strategy-dot'), node('span', strategy.name));
    button.addEventListener('click', () => {
      if (active === id) return;
      active = id; sheetIndex = 0; zoom = 1;
      renderResults();
      $('strategies').querySelector('[aria-pressed="true"]')?.focus();
    });
    name.append(button);
    if (result?.bestId === id) name.append(node('span', 'Recomendado', 'strategy-mark'));
    row.append(name);
    const used = candidate?.sheets.reduce((sum, sheet) => sum + sheet.used, 0);
    for (const value of [candidate?.sheets.length, candidate && percent.format(used / (grossArea(candidate))),
      candidate && squareMetres(candidate.offcut), candidate?.patterns]) row.append(node('td', value ?? '—'));
    tbody.append(row);
  }
}

function drawSheet(sheet) {
  const { width, height, border } = sheet.size;
  const guide = Math.max(width / DEFAULT_SHEET.width, height / DEFAULT_SHEET.height);
  const widthLabel = sizeNumber.format(width) + ' mm', heightLabel = sizeNumber.format(height) + ' mm';
  const widthTag = Math.max(294, widthLabel.length * 32) * guide;
  const heightTag = Math.max(304, heightLabel.length * 32) * guide;
  const left = Math.max(105 * guide, (widthTag - width) / 2 + 10 * guide);
  const right = Math.max(75 * guide, (widthTag - width) / 2 + 10 * guide);
  const vertical = Math.max(126 * guide, (heightTag - height) / 2 + 10 * guide);
  const drawing = vector('svg', {
    viewBox: [-left, -vertical, width + left + right, height + 2 * vertical].join(' '), class: 'drawing', role: 'img',
    'aria-label': 'Plano de corte em escala proporcional da chapa ' + (sheetIndex + 1) + ', com ' + sheet.placements.length + ' peças' });
  const gx = -53 * guide, gy = -55 * guide;
  const horizontalGuide = 'M0 ' + (-82 * guide) + 'V' + (-19 * guide) + ' M0 ' + gy + 'H' + width +
    ' M' + width + ' ' + (-82 * guide) + 'V' + (-19 * guide);
  const verticalGuide = 'M' + (-83 * guide) + ' 0H' + (-20 * guide) + ' M' + gx + ' 0V' + height +
    ' M' + (-83 * guide) + ' ' + height + 'H' + (-20 * guide);
  drawing.append(vector('path', { d: horizontalGuide + ' ' + verticalGuide, stroke: '#747d9a', 'stroke-width': 4 * guide, fill: 'none' }));
  drawing.append(vector('rect', { x: (width - widthTag) / 2, y: gy - 30 * guide, width: widthTag, height: 60 * guide, rx: 10 * guide, fill: '#f4f5fb' }));
  drawing.append(vector('rect', { x: gx - 30 * guide, y: (height - heightTag) / 2, width: 60 * guide, height: heightTag, rx: 10 * guide, fill: '#f4f5fb' }));
  drawing.append(
    vector('text', { x: width / 2, y: gy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 51 * guide }, widthLabel),
    vector('text', { x: gx, y: height / 2, transform: 'rotate(-90 ' + gx + ' ' + (height / 2) + ')',
      'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 51 * guide }, heightLabel)
  );
  const useful = { x: border, y: border, width: width - border * 2, height: height - border * 2 };
  drawing.append(vector('rect', { x: 0, y: 0, width, height, fill: '#fff', stroke: '#838caf', 'stroke-width': 5 * guide }));
  if (border > 0) drawing.append(vector('rect', { ...useful, fill: '#fdfdff' }));
  const parts = vector('g');
  for (const part of sheet.placements) {
    const [fill, stroke, text] = color(part.id);
    const group = vector('g', { transform: 'translate(' + part.x + ' ' + part.y + ')' });
    const path = vector('path', {
      d: pathOf([part.outer, ...part.holes]), class: 'piece-path', fill, stroke, 'fill-rule': 'evenodd',
      'stroke-width': 4.5, 'stroke-linejoin': 'round'
    });
    const dimensions = int.format(part.width) + ' × ' + int.format(part.height) + ' mm após giro';
    path.append(vector('title', {}, part.name + ' · ' + dimensions + ' · ' + int.format(part.angle) + '°'));
    group.append(path);
    if (part.paths?.length) {
      const open = vector('path', { d: pathOf(part.paths, false), fill: 'none', stroke: text,
        'stroke-width': 5, 'stroke-linecap': 'round' });
      open.append(vector('title', {}, part.name + ' · Linhas abertas'));
      group.append(open);
    }
    const isRect = part.outer.length === 4 && part.outer.every(([x,y]) =>
      [0, part.width].some(target => Math.abs(x - target) < 1e-5) && [0, part.height].some(target => Math.abs(y - target) < 1e-5));
    if (isRect && !part.holes.length && !part.paths?.length && part.width >= 360 && part.height >= 180) {
      const shortName = part.name.length > 17 ? part.name.slice(0, 15) + '…' : part.name;
      const size = Math.min(42, part.width / Math.max(1, shortName.length * .64 + 1.6));
      const label = vector('text', {
        class: 'piece-text', x: part.width / 2, y: part.height / 2 - 17, 'text-anchor': 'middle',
        'dominant-baseline': 'middle', 'font-size': size, 'pointer-events': 'none', style: 'fill:' + text
      }, shortName);
      const angle = vector('text', {
        x: part.width / 2, y: part.height / 2 + 32, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 35, 'pointer-events': 'none', style: 'fill:' + text
      }, int.format(part.angle) + '°');
      group.append(label, angle);
    }
    bindPart(group, drawing, part, sheet);
    parts.append(group);
  }
  drawing.append(parts);
  if (border > 0) drawing.append(vector('rect', {
    ...useful, fill: 'none', stroke: '#7269b6', 'stroke-width': 4 * guide,
    'stroke-dasharray': (16 * guide) + ' ' + (12 * guide), 'pointer-events': 'none'
  }));
  $('canvas').replaceChildren(drawing);
  updateZoom();
}

function updateZoom() {
  const canvas = $('canvas');
  const drawing = canvas.querySelector('.drawing');
  if (drawing) {
    const view = drawing.viewBox.baseVal;
    const styles = getComputedStyle(canvas);
    const inset = edge => parseFloat(styles['padding' + edge]);
    const availableWidth = canvas.clientWidth - inset('Left') - inset('Right');
    const availableHeight = canvas.clientHeight - inset('Top') - inset('Bottom');
    const base = Math.min(availableWidth, availableHeight * view.width / view.height);
    canvas.style.setProperty('--drawing-width', Math.max(1, Math.floor(base * zoom)) + 'px');
  }
  $('zoom-reset').textContent = Math.round(zoom * 100) + '%';
  $('zoom-in').disabled = !plan() || zoom >= 2.5;
  $('zoom-out').disabled = !plan() || zoom <= 0.6;
  $('zoom-reset').disabled = !plan();
}

function renderSheet() {
  const sheet = plan()?.sheets[sheetIndex];
  const bar = $('sheet-bar');
  const legend = $('legend');
  legend.replaceChildren();
  if (!sheet) {
    $('details').textContent='';
    $('sheet-yield').textContent = '—'; $('sheet-used').textContent = '—'; $('sheet-pattern').hidden = true;
    bar.setAttribute('aria-valuenow', '0'); bar.firstElementChild.style.width = '0%';
    const empty = node('div', null, 'empty-canvas');
    const icon = node('span', null, 'section-icon');
    icon.dataset.icon = 'sheet';
    empty.append(icon, node('p', busy ? 'Calculando posições e folgas…' : 'Otimize o lote para visualizar as chapas.'));
    showIcons(empty);
    $('canvas').replaceChildren(empty);
    updateZoom();
    return;
  }
  const ratio = sheet.used / sheetArea(sheet);
  $('sheet-yield').textContent = percent.format(ratio);
  $('sheet-used').textContent = squareMetres(sheet.used) + ' / ' + squareMetres(sheetArea(sheet));
  $('sheet-pattern').hidden = sheet.copies === 1;
  $('sheet-pattern').textContent = 'Padrão ' + sheet.pattern + ' · ' + sheet.copies + ' chapas iguais';
  bar.firstElementChild.style.width = (ratio * 100) + '%';
  bar.setAttribute('aria-valuenow', String(Math.round(ratio * 1000) / 10));
  const counts = new Map();
  for (const part of sheet.placements) counts.set(part.id, (counts.get(part.id) ?? 0) + 1);
  for (const piece of pieces) {
    if (!counts.has(piece.id)) continue;
    const [fill, stroke] = color(piece.id);
    const item = node('li');
    const swatch = node('span', null, 'swatch');
    swatch.style.backgroundColor = fill; swatch.style.borderColor = stroke;
    item.append(swatch, node('span', piece.name), node('span', '×' + counts.get(piece.id), 'legend-count'));
    legend.append(item);
  }
  drawSheet(sheet);
  sheetDetails(sheet);
}

function renderResults() {
  const current = plan();
  const used = current?.sheets.reduce((sum, sheet) => sum + sheet.used, 0);
  const gross = current ? grossArea(current) : 0;
  setUnit('metric-sheets', current ? current.sheets.length : '—');
  setUnit('metric-area', current ? decimal.format(used / 1e6) : '—', current ? 'm²' : '');
  setUnit('metric-yield', current ? percent.format(used / gross) : '—');
  setUnit('metric-waste', current ? decimal.format((gross - used) / 1e6) : '—', current ? 'm²' : '');
  $('plan-badge').hidden = !current || current.id !== result.bestId;
  $('plan-caption').textContent = current ? STRATEGIES[current.id].name : busy ? 'Comparando estratégias…' : 'Aguardando cálculo';
  $('export').disabled = !result;
  $('export').title = result ? 'Conferir o plano selecionado: ' + STRATEGIES[active].name + ' · DXF em milímetros' : 'Otimize o lote para exportar o DXF.';
  const select = $('sheet-select');
  select.replaceChildren();
  select.disabled = !current;
  if (current) {
    current.sheets.forEach((sheet, index) => {
      const opt = node('option', 'Chapa ' + String(index + 1).padStart(2, '0') + ' · ' + percent.format(sheet.used / sheetArea(sheet)));
      opt.value = index;
      select.append(opt);
    });
    select.value = sheetIndex;
  } else select.append(node('option', '—'));
  renderSheet();
  renderStrategies();
}

function clearResult() {
  runId++;
  clearTimeout(startupTimer);
  worker?.terminate(); worker = null;
  busy = false; failed = false; message = '';
  result = null; active = null; sheetIndex = 0; zoom = 1;
}

function run() {
  if (!pieces.length) return;
  clearResult();
  busy = true;
  message = 'Iniciando cálculo…';
  renderLot(); renderResults();
  const ticket = runId;
  function finish(error, output) {
    if (ticket !== runId) return;
    clearTimeout(startupTimer);
    worker?.terminate();
    worker = null; busy = false; failed = Boolean(error);
    if (output) { result = output; active = output.bestId; }
    message = error || 'Folgas e quantidades verificadas.';
    renderLot(); renderResults();
  }
  function fallback() {
    clearTimeout(startupTimer);
    worker?.terminate();
    worker = null;
    setTimeout(() => {
      if (ticket !== runId) return;
      try { finish(null, planStock(pieces, undefined, sheetSize, stock, objective())); }
      catch (error) { finish(error.message); }
    }, 0);
  }
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const current = worker;
    startupTimer = setTimeout(fallback, 2200);
    current.onmessage = ({ data }) => {
      if (current !== worker) return;
      clearTimeout(startupTimer);
      if (data.type === 'progress') {
        message = data.label + ' · ' + data.percent + '%';
        $('lot-status').textContent = message;
      } else if (data.type === 'error') finish(data.message);
      else finish(null, data.result);
    };
    current.onerror = event => {
      if (current === worker) fallback();
      event.preventDefault();
    };
    current.onmessageerror = () => { if (current === worker) fallback(); };
    current.postMessage({ pieces, sheetSize, stock, objective: objective() });
  } catch {
    fallback();
  }
}

function setPieces(next, nextDemo = false, auto = false) {
  if (next.reduce((sum, piece) => sum + piece.quantity, 0) > MAX_PIECES) throw new Error('O lote aceita até ' + MAX_PIECES + ' peças.');
  clearResult();
  pieces = next; demo = nextDemo;
  save();
  if (auto && pieces.length) run();
  else { renderLot(); renderResults(); }
}

function errorMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

const sheetFields = { width: 'sheet-width', height: 'sheet-height', border: 'sheet-border', gap: 'sheet-gap', rotationStep: 'sheet-step' };

function showSheetFields(settings) {
  for (const [key, id] of Object.entries(sheetFields)) $(id).value = settings[key];
  errorMessage($('size-error'), '');
}

$('edit-sheet').addEventListener('click', () => {
  showSheetFields(sheetSize);
  $('sheet-dialog').showModal();
  $('sheet-width').select();
});
$('reset-sheet').addEventListener('click', () => showSheetFields(DEFAULT_SHEET));
$('size-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const updated = sheetDimensions(Object.fromEntries(Object.entries(sheetFields).map(([key, id]) => [key, $(id).value])));
    $('sheet-dialog').close();
    if (Object.keys(updated).every(key => updated[key] === sheetSize[key])) return;
    sheetSize = updated;
    save();
    if (pieces.length) run();
    else renderLot();
  } catch (error) { errorMessage($('size-error'), error.message); }
});

function parsePairs(text) {
  const value = text.trim();
  if (value.startsWith('[')) return JSON.parse(value);
  return value.split(/\r?\n/).filter(line => line.trim()).map(line =>
    line.trim().split(line.includes(';') ? /\s*;\s*/ : /\s*,\s*|\s+/).map(value => value.trim().replace(',', '.')));
}

function listPairs(ring) {
  return ring.map(p => p.join('; ')).join('\n');
}

function updateFields() {
  const rectangle = $('piece-kind').value === 'rect';
  $('rectangle-fields').hidden = !rectangle; $('polygon-fields').hidden = rectangle;
  $('piece-width').required = rectangle; $('piece-height').required = rectangle; $('piece-points').required = !rectangle;
  $('orientation-help').textContent = $('piece-orientation').value === 'fixed'
    ? 'Mantém o sentido das flautas na orientação cadastrada.'
    : 'Testa ângulos a cada ' + sizeNumber.format(sheetSize.rotationStep) + '° e alinhamentos de arestas com a chapa.';
}

function openPiece(piece) {
  editing = piece?.id ?? null;
  $('piece-form').reset();
  $('piece-title').textContent = piece ? 'Editar peça' : 'Nova peça';
  $('delete').hidden = !piece;
  $('piece-name').value = piece?.name ?? '';
  $('piece-qty').value = piece?.quantity ?? 1;
  $('piece-kind').value = piece?.shape ?? 'rect';
  $('piece-orientation').value = piece?.orientation ?? 'fixed';
  $('piece-width').value = piece ? Number(piece.width.toFixed(6)) : '';
  $('piece-height').value = piece ? Number(piece.height.toFixed(6)) : '';
  $('piece-points').value = piece ? listPairs(piece.outer) : '';
  $('piece-holes').value = piece ? piece.holes.map(listPairs).join('\n\n') : '';
  $('piece-paths').value = piece?.paths?.map(listPairs).join('\n\n') ?? '';
  errorMessage($('piece-error'), '');
  updateFields();
  $('piece-dialog').showModal();
  $('piece-name').focus();
}

$('piece-form').addEventListener('submit', event => {
  event.preventDefault();
  const raw = { name: $('piece-name').value, quantity: $('piece-qty').value, orientation: $('piece-orientation').value };
  try {
    if ($('piece-kind').value === 'rect') {
      raw.width = $('piece-width').value; raw.height = $('piece-height').value;
    } else {
      raw.points = parsePairs($('piece-points').value);
      raw.holes = $('piece-holes').value.split(/\r?\n\s*\r?\n/).filter(part => part.trim()).map(parsePairs);
    }
    raw.paths = $('piece-paths').value.split(/\r?\n\s*\r?\n/).filter(part => part.trim()).map(parsePairs);
    const piece = rotatePiece(makePiece(raw, editing ?? newId()), $('piece-turn').valueAsNumber);
    setPieces(editing ? pieces.map(old => old.id === editing ? piece : old) : [...pieces, piece]);
    $('piece-dialog').close();
  } catch (error) { errorMessage($('piece-error'), error.message); }
});
for (const [id, degrees] of [['rotate-left', -90], ['rotate-right', 90]]) {
  $(id).addEventListener('click', () => {
    const input = $('piece-turn');
    input.value = (((input.valueAsNumber || 0) % 360) + degrees) % 360;
  });
}
$('piece-kind').addEventListener('change', updateFields);
$('piece-orientation').addEventListener('change', updateFields);
$('delete').addEventListener('click', () => {
  setPieces(pieces.filter(piece => piece.id !== editing));
  $('piece-dialog').close();
});
$('add').addEventListener('click', () => openPiece());

function confirmChange(title, message, action, label) {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = message;
  $('confirm-button').textContent = label;
  dialog.returnValue = '';
  dialog.addEventListener('close', () => { if (dialog.returnValue === 'confirm') action(); }, { once: true });
  dialog.showModal();
}
$('example').addEventListener('click', () => {
  const load = () => setPieces(example(), true, true);
  if (demo || !pieces.length) load();
  else confirmChange('Carregar o lote de exemplo?', 'O exemplo vai substituir as peças do lote atual.', load, 'Carregar exemplo');
});
$('clear-lot').addEventListener('click', () =>
  confirmChange('Esvaziar o lote?', 'As peças cadastradas e o plano atual serão removidos.', () => setPieces([]), 'Esvaziar lote'));

function download(name, content, mediaType) {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const link = node('a');
  link.href = url; link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('import').addEventListener('click', () => {
  $('import-form').reset();
  chooseFile(null);
  $('import-dialog').showModal();
});
function chooseFile(file) {
  importFile = file;
  $('import-name').textContent = file?.name ?? 'Selecionar ou arrastar arquivo';
  $('import-submit').disabled = !file;
  errorMessage($('import-error'), '');
}

$('import-file').addEventListener('change', event => chooseFile(event.target.files[0]));
const drop = $('drop-zone');
drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', event => {
  event.preventDefault();
  drop.classList.remove('dragging');
  chooseFile(event.dataTransfer.files[0]);
});
$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = importFile;
  if (!file) return;
  $('import-submit').disabled = true;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo ultrapassa 5 MB.');
    const source = await file.text();
    if (!$('import-dialog').open || file !== importFile) return;
    const incoming = readFile(source, file.name).map(piece => ({ ...piece, id: newId() }));
    pending = incoming;
    $('import-dialog').close(); reviewImport();
  } catch (error) {
    if (file !== importFile) return;
    errorMessage($('import-error'), error.message);
    $('import-submit').disabled = false;
  }
});
$('template-csv').addEventListener('click', () => download('modelo-pecas.csv',
  '\uFEFFnome;largura;altura;quantidade;orientacao;pontos\r\nPainel;500;790;8;fixa;\r\nReforço;;;12;livre;"[[0,0],[310,0],[0,260]]"\r\n', 'text/csv;charset=utf-8'));
$('template-json').addEventListener('click', () => download('modelo-pecas.json', JSON.stringify({ pieces: EXAMPLE }, null, 2), 'application/json'));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());

$('optimize').addEventListener('click', run);
$('sheet-select').addEventListener('change', event => { sheetIndex = Number(event.target.value); zoom = 1; renderSheet(); });
$('zoom-in').addEventListener('click', () => { zoom = Math.min(2.5, zoom + .25); updateZoom(); });
$('zoom-out').addEventListener('click', () => { zoom = Math.max(.6, zoom - .25); updateZoom(); });
$('zoom-reset').addEventListener('click', () => { zoom = 1; updateZoom(); $('canvas').scrollTo(0, 0); });
new ResizeObserver(updateZoom).observe($('canvas'));

showIcons();
restoreSettings();
if (pieces.length) run();
else { renderLot(); renderResults(); }

function report(title, label, action) {
  $('extra-title').textContent=title;
  $('extra-error').textContent='';
  const body=$('extra-body'); body.replaceChildren();
  $('extra-close').onclick=()=>$('extra').close();
  $('extra-ok').textContent=label;
  $('extra-ok').onclick=()=>{try{action();$('extra').close()}catch(e){$('extra-error').textContent=e.message}};
  if (!$('extra').open) $('extra').showModal();
  return body;
}
function field(parent,title,element) {
  const label=node('label',title); label.append(element); parent.append(label); return element;
}
function numberInput(value) {
  const el=node('input');el.type='number';el.step='any';el.value=value;return el;
}
function options(items,value) {
  const el=node('select');
  for(const [key,name] of items){const opt=node('option',name);opt.value=key;el.append(opt)}
  el.value=value;return el;
}
function reviewImport() {
  const chosen=[];
  const body=report('Conferir peças importadas','Adicionar ao lote',()=>{
    const add=chosen.filter(r=>r.check.checked);
    if(!add.length) throw Error('Selecione pelo menos uma peça.');
    setPieces([...pieces,...add.map(r=>r.p)]);
    for(const r of add) roles[r.p.id]=r.paths.map(el=>el.value);
    saveSettings();
  });
  pending.forEach((p,i)=>{
    const row=node('div',null,'test-row'),check=node('input');check.type='checkbox';check.checked=true;
    row.append(check,thumb(p),node('strong',(i+1)+'. '+p.name),node('span',int.format(p.width)+' × '+int.format(p.height)+' mm'));
    const paths=p.paths.map((_,j)=>field(row,'Linha '+(j+1),options([['CORTE_ABERTO','Corte aberto'],['VINCO','Vinco'],['REFERENCIA','Referência']],'CORTE_ABERTO')));
    chosen.push({p,check,paths});body.append(row);
  });
}
function sheetDetails(sheet) {
  const cut=freeRectangle(sheet);
  $('details').textContent=(sheet.stock?'Retalho':'Chapa')+' · '+int.format(sheet.size.width)+' × '+int.format(sheet.size.height)+' mm'+
    ($('grain').value?' · '+($('grain').value==='v'?'↕ Vertical':'↔ Horizontal'):'')+
    '\nÁrea livre bruta: '+squareMetres(sheetArea(sheet)-sheet.used)+'\nRetalho retangular conservador: '+int.format(cut.width)+' × '+int.format(cut.height)+' mm.\nClique ou arraste uma peça para ajustar.';
}
function checkPlan(current, types=pieces) {
  const counts=new Map(types.map(p=>[p.id,0]));
  for(const sheet of current.sheets){
    const local=new Map();
    for(const p of sheet.placements){
      if(!counts.has(p.id)) throw Error('Peça desconhecida.');
      counts.set(p.id,counts.get(p.id)+1);local.set(p.id,(local.get(p.id)||0)+1);
    }
    validateLayout([sheet],Array.from(local,([id,quantity])=>({id,quantity})),sheet.size);
  }
  if(types.some(p=>counts.get(p.id)!==p.quantity))throw Error('Quantidade divergente no plano.');
  return counts;
}
function minimumGap(sheet) {
  let min=Infinity;
  const rings=sheet.placements.map(p=>p.outer.map(([x,y])=>[x+p.x,y+p.y]));
  for(let i=0;i<rings.length;i++)for(let j=0;j<i;j++){
    const a=sheet.placements[i],b=sheet.placements[j];
    if(Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width)**2+Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height)**2>=min)continue;
    for(const [first,second] of [[rings[i],rings[j]],[rings[j],rings[i]]])
      for(const point of first)for(let k=0;k<second.length;k++)min=Math.min(min,pointDistance2(point,second[k],second[(k+1)%second.length]));
  }
  return Number.isFinite(min)?int.format(Math.sqrt(min))+' mm':'uma peça';
}
$('export').title='Conferir o plano em exibição';
$('export').onclick=()=>{
  const current=plan();if(!current)return;
  const scope=options([['all','Todas as chapas'],['one','Somente a chapa em exibição']],'all');
  const guides=options([['no','Cortes e vincos'],['yes','Incluir guias e referências']],'no');
  const body=report('Conferência para exportação','Baixar DXF R12',()=>{
    checkPlan(current);
    const all=scope.value==='all';
    download('plano-'+current.id+'-'+(all?'completo':'chapa-'+(sheetIndex+1))+'.dxf',exportDxf(all?current.sheets:[current.sheets[sheetIndex]],sheetSize,guides.value==='yes',roles),'application/dxf');
  });
  const counts=checkPlan(current);
  body.append(node('strong',STRATEGIES[current.id].name),node('p','Lote completo · encaixadas / solicitadas'));
  pieces.forEach(p=>body.append(node('div',p.name+' · '+counts.get(p.id)+' / '+p.quantity)));
  current.sheets.forEach((s,i)=>body.append(node('p','Chapa '+(i+1)+' · '+s.placements.length+' peças · Menor distância: '+minimumGap(s))));
  field(body,'Exportar',scope);field(body,'Camadas',guides);
};
function reconstruct(piece, pose) {
  const {x,y,angle}=pose;
  if(![x,y,angle].every(Number.isFinite)||piece.orientation==='fixed' && Math.abs(angle%180)>1e-7)throw Error('Confira a posição e o ângulo permitido.');
  const rotated=rotatePiece(piece,angle);
  return {...rotated,x,y,angle,locked:!!pose.locked};
}
function bindPart(group,drawing,part,sheet) {
  group.dataset.part=part.id; group.tabIndex=0;
  group.setAttribute('aria-label','Ajustar '+part.name);
  group.onkeydown=e=>{if(e.key==='Enter')editPose(part,sheet,part.x,part.y)};
  if($('grain').value && pieces.find(p=>p.id===part.id)?.orientation==='fixed'){
    group.append(vector('text',{x:part.width/2,y:part.height*.8,'text-anchor':'middle','font-size':Math.min(55,part.height*.18),'pointer-events':'none'},$('grain').value==='v'?'↕':'↔'));
  }
  group.onpointerdown=e=>{
    if(e.button!==0)return;
    const point=ev=>new DOMPoint(ev.clientX,ev.clientY).matrixTransform(drawing.getScreenCTM().inverse());
    const start=point(e);group.setPointerCapture(e.pointerId);
    const reset=()=>{group.onpointermove=null;group.onpointerup=null;group.setAttribute('transform','translate('+part.x+' '+part.y+')')};
    group.onpointercancel=reset;
    group.onpointermove=ev=>{if(!part.locked){const end=point(ev);group.setAttribute('transform','translate('+(part.x+end.x-start.x)+' '+(part.y+end.y-start.y)+')')}};
    group.onpointerup=ev=>{const end=point(ev);reset();editPose(part,sheet,part.x+(part.locked?0:end.x-start.x),part.y+(part.locked?0:end.y-start.y))};
  };
}
function editPose(part,sheet,newX,newY){
  const x=numberInput(+newX.toFixed(5)),y=numberInput(+newY.toFixed(5)),angle=numberInput(part.angle);
  const lock=node('input');lock.type='checkbox';lock.checked=!!part.locked;
  const enable=()=>{for(const el of [x,y,angle])el.disabled=lock.checked};lock.onchange=enable;enable();
  const body=report('Ajustar '+part.name,'Aplicar posição',()=>{
    const piece=pieces.find(p=>p.id===part.id);
    const updated=reconstruct(piece,{x:x.valueAsNumber,y:y.valueAsNumber,angle:angle.valueAsNumber,locked:lock.checked});
    const index=sheet.placements.indexOf(part);
    sheet.placements[index]=updated;
    try{checkPlan(plan())}catch(e){sheet.placements[index]=part;throw e}
    refreshPatterns(plan());renderResults();
  });
  body.append(node('p','Coordenadas em mm a partir do canto superior esquerdo. A trava vale para este plano. Um novo cálculo gera outros planos.'));
  field(body,'X',x);field(body,'Y',y);field(body,'Giro (°)',angle);field(body,'Travar posição',lock);
}
function stockRows(raw, base=sheetSize) {
  if(!Array.isArray(raw)||raw.length>100)throw Error('Use até 100 formatos.');
  return raw.map(r=>{const {width,height}=sheetDimensions({...base,width:r.width,height:r.height});
    if(!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>500)throw Error('Quantidade de retalhos inválida.');
    return {width,height,quantity:r.quantity};});
}
$('stock').onclick=()=>{
  const rows=[];
  const body=report('Chapas e retalhos disponíveis','Aplicar estoque',()=>{
    stock=stockRows(rows.filter(r=>r.row.isConnected).map(r=>({width:r.w.valueAsNumber,height:r.h.valueAsNumber,quantity:r.q.valueAsNumber})));
    saveSettings();if(pieces.length)run();
  });
  body.append(node('p','Os retalhos são usados na ordem cadastrada. O saldo do lote usa a chapa principal.'));
  const list=node('div');body.append(list);
  function add(r){const row=node('div',null,'test-row');const w=field(row,'L mm',numberInput(r.width)),h=field(row,'A mm',numberInput(r.height)),q=field(row,'Qtd.',numberInput(r.quantity));
    const del=node('button','Remover');del.onclick=()=>row.remove();row.append(del);list.append(row);rows.push({row,w,h,q});}
  stock.forEach(add);const button=node('button','Adicionar formato');button.onclick=()=>add({width:600,height:900,quantity:1});body.append(button);
};
function saveSettings(){try{localStorage.setItem(storageKey+'.settings',JSON.stringify({stock,roles,grain:$('grain').value,objective:objective()}))}catch{}}
function restoreSettings(){try{const s=JSON.parse(localStorage.getItem(storageKey+'.settings'));if(s){stock=stockRows(s.stock);roles=s.roles||{};$('grain').value=s.grain;$('objective').value=s.objective}}catch{}}
$('objective').onchange=()=>{saveSettings();if(pieces.length)run()};
$('grain').onchange=()=>{saveSettings();renderSheet()};
$('save-project').onclick=()=>download('projeto-de-corte.json',JSON.stringify({format:'chapas-teste-1',sheetSize,stock,objective:objective(),grain:$('grain').value,roles,pieces:pieces.map(serialPiece),active,sheetIndex,
  layouts:result?.plans.map(p=>({id:p.id,sheets:p.sheets.map(s=>({size:s.size,stock:s.stock,poses:s.placements.map(({id,x,y,angle,locked})=>({id,x,y,angle,locked}))}))})),best:result?.bestId}), 'application/json');
$('load-project').onclick=()=>$('project-file').click();
$('project-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const s=JSON.parse(await file.text());
    if(s.format!=='chapas-teste-1')throw Error('Selecione um projeto salvo nesta versão.');
    const next=s.pieces.map(p=>makePiece(p)),dims=sheetDimensions(s.sheetSize);
    if(new Set(next.map(p=>p.id)).size!==next.length||next.reduce((n,p)=>n+p.quantity,0)>MAX_PIECES)throw Error('Lote inválido.');
    const inventory=stockRows(s.stock.map(r=>({...r})),dims);
    const plans=s.layouts?.map(p=>{
      if(!Object.hasOwn(STRATEGIES,p.id))throw Error('Estratégia inválida.');
      const sheets=p.sheets.map(raw=>({size:sheetDimensions(raw.size),stock:!!raw.stock,placements:raw.poses.map(pose=>reconstruct(next.find(piece=>piece.id===pose.id),pose))}));
      const candidate={id:p.id,sheets};checkPlan(candidate,next);refreshPatterns(candidate);return candidate;
    });
    if(plans && (!plans.some(p=>p.id===s.active)||!plans.some(p=>p.id===s.best)))throw Error('Plano inválido.');
    const restoredRoles={};
    for(const p of next)restoredRoles[p.id]=p.paths.map((_,i)=>['VINCO','REFERENCIA'].includes(s.roles?.[p.id]?.[i])?s.roles[p.id][i]:'CORTE_ABERTO');
    sheetSize=dims;stock=inventory;roles=restoredRoles;
    $('objective').value=s.objective==='repeat'?'repeat':'lot';$('grain').value=['h','v'].includes(s.grain)?s.grain:'';
    setPieces(next);saveSettings();
    if(plans){result={plans,bestId:s.best};active=s.active;sheetIndex=Math.max(0,Math.min(Number(s.sheetIndex)||0,plan().sheets.length-1));renderResults()}
  }catch(err){alert('Falha ao abrir projeto: '+err.message)}
};

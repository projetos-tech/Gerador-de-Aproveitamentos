import { EPS, MAX_PIECES, bounds, edges, conflict, signedArea, sheetDimensions } from './geometry.js';

export const STRATEGIES = {
  grid: { name: 'Grade por dimensões', description: 'Prioriza peças grandes e alinha pelas bordas das caixas envolventes.' },
  contour: { name: 'Encaixe por contorno', description: 'Testa várias ordens e aproxima vértices para ocupar reentrâncias.' },
  repeat: { name: 'Chapa modelo repetida', description: 'Busca uma chapa modelo para replicar a proporção do lote.' }
};

const formatSize = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const normAngle = angle => ((angle % 360) + 360) % 360;
const round = value => Math.round(value * 1e6) / 1e6;

function usableArea(size) {
  const { width, height, border, gap, rotationStep } = sheetDimensions(size);
  return { width: width - border * 2, height: height - border * 2, border, gap, rotationStep };
}

function getAngles(piece, step) {
  if (piece.orientation === 'fixed') return [0, 180];
  const regular = Array.from({ length: Math.ceil(360 / step) }, (_, i) => i * step);
  const segments = edges(piece.outer).map(({ a, b }) => ({
    length: Math.hypot(b[0] - a[0], b[1] - a[1]),
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI
  })).sort((a, b) => b.length - a.length);
  const axes = [...new Set(segments.map(({ angle }) => round(normAngle(-angle) % 90)))].slice(0, 5);
  const alignment = axes.flatMap(angle => [angle, angle + 90, angle + 180, angle + 270]);
  return [...new Set([...regular, ...alignment])].sort((a, b) => a - b);
}

// Canonical counterclockwise traversal gives each edge an outward right normal.
function diagonalEdges(ring) {
  const points = signedArea(ring) > 0 ? ring : [...ring].reverse();
  return edges(points).flatMap(({ a, b }) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (Math.abs(dx) < EPS || Math.abs(dy) < EPS || length < EPS) return [];
    return [{ a, length, tx: dx / length, ty: dy / length }];
  }).sort((a, b) => b.length - a.length).slice(0, 12);
}

function alignDiagonals(other, variant, limits, add) {
  const { border, right, bottom, gap } = limits;
  for (const fixed of other.diagonals) {
    const { tx, ty } = fixed;
    for (const moving of variant.diagonals) {
      if (Math.hypot(tx + moving.tx, ty + moving.ty) > 1e-8) continue;
      const x = other.x + fixed.a[0] - moving.a[0] + gap * ty;
      const y = other.y + fixed.a[1] - moving.a[1] - gap * tx;
      // Slide along the offset line, including flush positions and sheet boundaries.
      const stops = [moving.length, fixed.length, (moving.length + fixed.length) / 2,
        (border - x) / tx, (right - x) / tx, (border - y) / ty, (bottom - y) / ty,
        (other.x - x) / tx, (other.x + other.width - variant.width - x) / tx,
        (other.y - y) / ty, (other.y + other.height - variant.height - y) / ty];
      for (const t of stops) {
        if (t > EPS && t < fixed.length + moving.length - EPS) add(x + t * tx, y + t * ty);
      }
    }
  }
}

function makeVariants(piece, usable) {
  const seen = new Set();
  return getAngles(piece, usable.rotationStep).flatMap(angle => {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotate = ring => ring.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    const raw = rotate(piece.outer);
    const { x, y, width, height } = bounds(raw);
    if (width > usable.width + EPS || height > usable.height + EPS) return [];
    const normalize = ring => ring.map(([u, v]) => [Math.max(0, u - x), Math.max(0, v - y)]);
    const outer = normalize(raw), holes = piece.holes.map(hole => normalize(rotate(hole)));
    const paths = (piece.paths ?? []).map(path => normalize(rotate(path)));
    const pointKey = p => p.map(round).join(',');
    const ringKey = [outer, ...holes].map(ring => ring.map(pointKey).sort().join(';')).join('|');
    const pathKey = paths.map(path => {
      const points = path.map(pointKey);
      const forward = points.join(';'), reverse = points.reverse().join(';');
      return forward < reverse ? forward : reverse;
    }).sort().join('|');
    const key = ringKey + '#' + pathKey;
    if (seen.has(key)) return [];
    seen.add(key);
    const rect = outer.length === 4 && outer.every(([u, v]) =>
      (u < EPS || Math.abs(u - width) < EPS) && (v < EPS || Math.abs(v - height) < EPS));
    const step = Math.ceil(outer.length / 9);
    return [{
      id: piece.id, name: piece.name, angle, area: piece.area, width, height, outer, holes, paths,
      rect, diagonals: diagonalEdges(outer), edges: edges(outer), anchors: outer.filter((_, i) => i % step === 0)
    }];
  });
}

function newSheet() {
  return { placements: [], used: 0, extentX: 0, extentY: 0 };
}

function place(sheet, result, border) {
  sheet.placements.push(result);
  sheet.used += result.area;
  sheet.extentX = Math.max(sheet.extentX, result.x + result.width - border);
  sheet.extentY = Math.max(sheet.extentY, result.y + result.height - border);
}

function positions(sheet, variant, mode, usable) {
  const { border, gap } = usable;
  const right = border + usable.width - variant.width, bottom = border + usable.height - variant.height;
  const map = new Map(), xs = new Set([border, right]), ys = new Set([border, bottom]);
  function add(x, y) {
    if (x < border - EPS || x > right + EPS || y < border - EPS || y > bottom + EPS) return;
    x = Math.min(right, Math.max(border, x));
    y = Math.min(bottom, Math.max(border, y));
    map.set(Math.round(x * 1e5) + ',' + Math.round(y * 1e5), { x, y });
  }

  add(border, border);
  if (!sheet.placements.length) return [...map.values()];
  add(right, border);
  add(border, bottom);
  const touching = mode === 'grid' ? [] : sheet.placements.length <= 13 ? sheet.placements : sheet.placements.slice(-10);
  for (const other of sheet.placements) {
    if (variant.diagonals.length && other.diagonals.length) {
      alignDiagonals(other, variant, { border, right, bottom, gap }, add);
    }
    const side = other.x + other.width + gap, below = other.y + other.height + gap;
    const left = other.x - gap - variant.width, above = other.y - gap - variant.height;
    for (const x of [side, left, other.x, other.x + other.width - variant.width]) if (x >= border - EPS && x <= right + EPS) xs.add(x);
    for (const y of [below, above, other.y, other.y + other.height - variant.height]) if (y >= border - EPS && y <= bottom + EPS) ys.add(y);
    add(side, other.y); add(left, other.y); add(other.x, below); add(other.x, above);
    add(side, other.y + other.height - variant.height); add(left, other.y + other.height - variant.height);
    add(other.x + other.width - variant.width, below); add(other.x + other.width - variant.width, above);
    add(side, border); add(border, below);
  }
  const axisLimit = mode === 'grid' ? 22 : 15;
  const xList = [...xs].sort((a, b) => a - b).slice(0, axisLimit);
  const yList = [...ys].sort((a, b) => a - b).slice(0, axisLimit);
  for (const y of yList) for (const x of xList) add(x, y);
  for (const other of touching) {
    if (other.rect && variant.rect) continue;
    for (const [ax, ay] of variant.anchors) {
      for (const [bx, by] of other.anchors) {
        const x = other.x + bx - ax, y = other.y + by - ay;
        add(x + gap, y); add(x - gap, y); add(x, y + gap); add(x, y - gap);
      }
    }
  }
  return [...map.values()];
}

function findSpot(sheet, type, mode, usable) {
  const { border, gap } = usable;
  let best = null;
  const basic = type.variants.filter(v => v.angle % 90 === 0);
  const variants = mode === 'grid' && basic.length ? basic : type.variants;
  for (const variant of variants) {
    if (variant.width * variant.height < type.footprint - EPS) continue;
    const options = positions(sheet, variant, mode, usable);
    for (const { x, y } of options) {
      const extentX = Math.max(sheet.extentX, x + variant.width - border);
      const extentY = Math.max(sheet.extentY, y + variant.height - border);
      const score = mode === 'grid' ? y * (usable.width + 2 * border + 100) + x + variant.height * 0.05
        : mode === 'wide' ? extentX * 1500 + extentY * 32 + x * 4 + y
          : extentY * 1500 + extentX * 32 + y * 4 + x;
      if (best && score >= best.score - EPS) continue;
      const candidate = { ...variant, x, y, score };
      if (!sheet.placements.some(other => conflict(candidate, other, gap))) best = candidate;
    }
  }
  return best;
}

function pack(items, mode, usable, onStep = () => {}) {
  const sheets = [];
  for (let i = 0; i < items.length; i++) {
    const piece = items[i];
    let fitted = false;
    for (const sheet of sheets) {
      // The outer material of a piece cannot overlap any existing piece.
      if (sheet.used + piece.area > usable.width * usable.height + EPS) continue;
      const spot = findSpot(sheet, piece, mode, usable);
      if (!spot) continue;
      place(sheet, spot, usable.border);
      fitted = true;
      break;
    }
    if (!fitted) {
      const sheet = newSheet();
      const spot = findSpot(sheet, piece, mode, usable);
      if (!spot) throw new Error(piece.name + ' não cabe na área útil de ' + usefulDimensions(usable) + '.');
      place(sheet, spot, usable.border);
      sheets.push(sheet);
    }
    onStep((i + 1) / items.length);
  }
  return sheets;
}

function sheetKey(sheet) {
  return sheet.placements.map(p => [p.id, round(p.angle), round(p.x), round(p.y)].join(':')).sort().join('|');
}

function countPatterns(sheets) {
  return new Set(sheets.map(sheetKey)).size;
}

function usefulDimensions({ width, height }) {
  return formatSize.format(width) + ' × ' + formatSize.format(height) + ' mm';
}

function straightOffcut(sheet, usable) {
  return Math.max(0, usable.width * (usable.height - sheet.extentY), usable.height * (usable.width - sheet.extentX));
}

function largestOffcut(sheets, usable) {
  return Math.max(...sheets.map(sheet => straightOffcut(sheet, usable)));
}

function rank(a, b, usable) {
  return a.length - b.length ||
    largestOffcut(b, usable) - largestOffcut(a, usable) ||
    countPatterns(a) - countPatterns(b);
}

function ordered(types, order) {
  return [...types].sort((a, b) => order(a, b) || a.index - b.index);
}
const byFootprint = (a, b) => b.footprint - a.footprint;
const bySide = (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height);
const byWidth = (a, b) => b.width - a.width || byFootprint(a, b);
const expand = types => types.flatMap(type => Array(type.quantity).fill(type));

function repeated(types, fallback, usable, onStep) {
  const lowerBound = Math.max(1, Math.ceil(types.reduce((sum, type) => sum + type.footprint * type.quantity, 0) / (usable.width * usable.height)));
  const options = [];
  for (let count = Math.max(2, lowerBound); count <= fallback.length + 2 && options.length < 5; count++) {
    const group = types.map(type => ({ ...type, quantity: Math.floor(type.quantity / count) }));
    if (!group.some(type => type.quantity) || group.some(type => !type.quantity && type.quantity > count)) continue;
    const key = group.map(type => type.quantity).join(',');
    if (options.some(option => option.key === key)) continue;
    options.push({ group, key });
  }
  let best = null;
  for (const { group } of options) {
    const patternItems = expand(ordered(group, byFootprint));
    const model = [pack(patternItems, 'tight', usable), pack(ordered(patternItems, bySide), 'wide', usable)]
      .sort((a, b) => rank(a, b, usable))[0];
    if (model.length !== 1) continue;
    const multiplier = Math.min(...group.filter(type => type.quantity).map(type => Math.floor(types[type.index].quantity / type.quantity)));
    if (multiplier < 2) continue;
    const rest = types.map(type => ({ ...type, quantity: type.quantity - multiplier * group[type.index].quantity }));
    const balance = expand(ordered(rest, byFootprint));
    const sheets = [...Array(multiplier).fill(model[0]), ...pack(balance, 'tight', usable)];
    if (!best || rank(sheets, best, usable) < 0) best = sheets;
  }
  onStep(1);
  if (best && (countPatterns(best) < countPatterns(fallback) ||
      (countPatterns(best) === countPatterns(fallback) && rank(best, fallback, usable) <= 0))) return best;
  // Group any identical layouts the contour strategy found and keep those copies together.
  return [...fallback].sort((a, b) => a.used - b.used || (sheetKey(a) < sheetKey(b) ? -1 : sheetKey(a) > sheetKey(b) ? 1 : 0)).reverse();
}

function compact(sheets) {
  const patterns = new Map();
  for (const sheet of sheets) {
    const key = sheetKey(sheet);
    if (!patterns.has(key)) patterns.set(key, { id: patterns.size + 1, count: 0 });
    patterns.get(key).count++;
  }
  return sheets.map(sheet => {
    const pattern = patterns.get(sheetKey(sheet));
    return {
      used: sheet.used, pattern: pattern.id, copies: pattern.count,
      placements: sheet.placements.map(({ id, name, angle, area, width, height, outer, holes, paths, x, y }) =>
        ({ id, name, angle, area, width, height, outer, holes, paths, x, y }))
    };
  });
}

export function validateLayout(sheets, types, size) {
  const usable = usableArea(size);
  const { border, gap } = usable;
  const counts = new Map(types.map(type => [type.id, type.quantity]));
  for (const sheet of sheets) {
    const checked = [];
    for (const part of sheet.placements) {
      const actual = { ...part, edges: edges(part.outer) };
      if (actual.x < border - EPS || actual.y < border - EPS ||
          actual.x + actual.width > border + usable.width + EPS || actual.y + actual.height > border + usable.height + EPS ||
          checked.some(other => conflict(actual, other, gap))) throw new Error('Falha na verificação da borda livre ou da distância entre peças.');
      checked.push(actual);
      counts.set(actual.id, (counts.get(actual.id) ?? 0) - 1);
    }
  }
  if ([...counts.values()].some(count => count !== 0)) throw new Error('Falha na conferência das quantidades do plano.');
}

export function optimize(pieces, progress = () => {}, size) {
  if (!pieces.length) throw new Error('Cadastre pelo menos uma peça.');
  if (pieces.reduce((sum, piece) => sum + piece.quantity, 0) > MAX_PIECES) throw new Error('O lote aceita até ' + MAX_PIECES + ' peças.');
  const usable = usableArea(size);
  const types = pieces.map((piece, index) => ({ ...piece, index, variants: makeVariants(piece, usable) }));
  const impossible = types.filter(type => !type.variants.length);
  if (impossible.length) throw new Error('Sem encaixe na área útil de ' + usefulDimensions(usable) + ': ' + impossible.map(type => type.name).join(', ') + '. Confira as medidas e a orientação.');
  const grid = pack(expand(ordered(types, byFootprint)), 'grid', usable, fraction => progress('Grade por dimensões', fraction * 0.2));
  const runs = [[byFootprint, 'tight'], [bySide, 'tight'], [byWidth, 'wide']];
  const contour = runs.map(([order, mode], i) => pack(expand(ordered(types, order)), mode, usable,
    fraction => progress('Encaixe por contorno', 0.2 + (i + fraction) * 0.21))).sort((a, b) => rank(a, b, usable))[0];
  progress('Chapa modelo repetida', 0.84);
  const repeat = repeated(types, contour, usable, fraction => progress('Chapa modelo repetida', 0.84 + fraction * 0.15));
  const plans = [{ id: 'grid', raw: grid }, { id: 'contour', raw: contour }, { id: 'repeat', raw: repeat }];
  const bestId = [...plans].sort((a, b) => rank(a.raw, b.raw, usable))[0].id;
  for (const plan of plans) validateLayout(plan.raw, types, size);
  return {
    bestId,
    plans: plans.map(({ id, raw }) => ({
      id, sheets: compact(raw), patterns: countPatterns(raw), offcut: largestOffcut(raw, usable)
    }))
  };
}

export function planStock(pieces, progress, size, stock = [], objective = 'lot') {
  const remaining = pieces.map(p => ({ ...p }));
  const reused = [];
  for (const entry of stock) {
    const dimensions = sheetDimensions({ ...size, width: entry.width, height: entry.height });
    const usable = usableArea(dimensions);
    const types = remaining.map(p => ({ ...p, variants: makeVariants(p, usable) })).sort(byFootprint);
    for (let copy = 0; copy < entry.quantity; copy++) {
      const sheet = newSheet();
      for (const type of types) {
        const source = remaining.find(p => p.id === type.id);
        while (source.quantity && type.variants.length) {
          const spot = findSpot(sheet, type, 'tight', usable);
          if (!spot) break;
          place(sheet, spot, usable.border);
          source.quantity--;
        }
      }
      if (!sheet.placements.length) break;
      reused.push({ ...compact([sheet])[0], size: dimensions, stock: true });
    }
  }
  const balance = remaining.filter(p => p.quantity);
  const result = balance.length ? optimize(balance, progress, size) :
    { bestId: 'grid', plans: Object.keys(STRATEGIES).map(id => ({ id, sheets: [] })) };
  for (const plan of result.plans) {
    plan.sheets = [...structuredClone(reused), ...plan.sheets.map(sheet => ({ ...sheet, size }))];
    refreshPatterns(plan);
  }
  if (objective === 'repeat') result.bestId = [...result.plans].sort((a,b) =>
    a.patterns - b.patterns || a.sheets.length - b.sheets.length || Number(b.id === 'repeat') - Number(a.id === 'repeat'))[0].id;
  return result;
}

export function refreshPatterns(plan) {
  const keys = plan.sheets.map(s => [s.size.width,s.size.height,sheetKey(s)].join('/'));
  const distinct = [...new Set(keys)];
  plan.patterns = distinct.length;
  plan.offcut = 0;
  plan.sheets.forEach((s,i) => {
    s.pattern = distinct.indexOf(keys[i]) + 1;
    s.copies = keys.filter(k => k === keys[i]).length;
    s.used = s.placements.reduce((sum,p) => sum + p.area,0);
    const cut = freeRectangle(s);
    plan.offcut = Math.max(plan.offcut, cut.width * cut.height);
  });
}

// Largest axis-aligned rectangle outside the expanded part bounding boxes.
export function freeRectangle(sheet) {
  const {width,height,border,gap} = sheet.size;
  const boxes = sheet.placements.map(p => ({
    l: Math.max(border,p.x-gap), r: Math.min(width-border,p.x+p.width+gap),
    t: Math.max(border,p.y-gap), b: Math.min(height-border,p.y+p.height+gap)
  }));
  const xs = [...new Set([border,width-border,...boxes.flatMap(b=>[b.l,b.r])])].sort((a,b)=>a-b);
  const heights = xs.slice(1).map(()=>0);
  const ys = [...new Set([border,height-border,...boxes.flatMap(b=>[b.t,b.b])])].sort((a,b)=>a-b);
  let best = {width:0,height:0};
  for (let j=1;j<ys.length;j++) {
    const diff = new Int32Array(xs.length);
    const indices = new Map(xs.map((x,i)=>[x,i]));
    for (const box of boxes) if (box.t < ys[j] && box.b > ys[j-1]) {
      diff[indices.get(box.l)]++; diff[indices.get(box.r)]--;
    }
    let occupied=0;
    const stack=[];
    for(let i=0;i<=heights.length;i++) {
      occupied+=diff[i];
      const h=i===heights.length ? 0 : (heights[i]=occupied ? 0 : heights[i]+ys[j]-ys[j-1]);
      let left=i;
      while(stack.length && stack.at(-1).h>h) {
        const prev=stack.pop(); left=prev.left;
        const w=xs[i]-xs[left];
        if(w*prev.h>best.width*best.height) best={width:w,height:prev.h};
      }
      if(h && stack.at(-1)?.h!==h) stack.push({h,left});
    }
  }
  return best;
}

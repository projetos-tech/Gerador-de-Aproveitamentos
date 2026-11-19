export const DEFAULT_SHEET = Object.freeze({ width: 1300, height: 2000, border: 50, gap: 5, rotationStep: 15 });
export const MAX_PIECES = 500;
export const MAX_VERTICES = 600;
export const EPS = 1e-7;
const MAX_COORDINATE = 1e7;

export function sheetDimensions({
  width, height, border = DEFAULT_SHEET.border, gap = DEFAULT_SHEET.gap, rotationStep = DEFAULT_SHEET.rotationStep
} = DEFAULT_SHEET) {
  const dimensions = { width: Number(width), height: Number(height), border: Number(border),
    gap: Number(gap), rotationStep: Number(rotationStep) };
  if (!Number.isFinite(dimensions.border) || dimensions.border < 0) throw new Error('A borda livre deve ser maior ou igual a zero.');
  if (!Number.isFinite(dimensions.gap) || dimensions.gap < 0 || dimensions.gap > MAX_COORDINATE) {
    throw new Error('Informe uma distância entre peças válida, maior ou igual a zero.');
  }
  if (!(dimensions.rotationStep >= 1 && dimensions.rotationStep <= 90)) throw new Error('O passo do giro livre deve estar entre 1° e 90°.');
  if ([dimensions.width, dimensions.height].some(size => !Number.isFinite(size) || size <= 2 * dimensions.border)) {
    throw new Error('Cada dimensão da chapa deve ser maior que duas vezes a borda livre.');
  }
  if ([dimensions.width, dimensions.height].some(size => size > MAX_COORDINATE)) {
    throw new Error('Use dimensões de até 10.000.000 mm.');
  }
  return dimensions;
}

export function rectangle(width, height) {
  return [[0, 0], [width, 0], [width, height], [0, height]];
}

export function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - a[1] * b[0];
  }
  return sum / 2;
}

export function bounds(ring) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of ring) {
    x = Math.min(x, p[0]); y = Math.min(y, p[1]);
    right = Math.max(right, p[0]); bottom = Math.max(bottom, p[1]);
  }
  return { x, y, right, bottom, width: right - x, height: bottom - y };
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) < EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) &&
      ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return true;
  return (Math.abs(abC) < EPS && onSegment(a, b, c)) ||
         (Math.abs(abD) < EPS && onSegment(a, b, d)) ||
         (Math.abs(cdA) < EPS && onSegment(c, d, a)) ||
         (Math.abs(cdB) < EPS && onSegment(c, d, b));
}

export function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

export function ringsIntersect(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (intersects(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

function cleanPoints(raw) {
  if (!Array.isArray(raw)) throw new Error('Forneça uma lista de vértices [x, y].');
  const points = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(value => value === '' || value === null || typeof value === 'boolean')) {
      throw new Error('Cada vértice deve ter duas coordenadas numéricas.');
    }
    const point = pair.map(Number);
    if (point.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE)) throw new Error('Coordenada fora do intervalo aceito.');
    if (!points.length || Math.hypot(point[0] - points.at(-1)[0], point[1] - points.at(-1)[1]) > EPS) points.push(point);
  }
  return points;
}

export function pathInside(path, ring) {
  if (!path.every(point => inside(point, ring))) return false;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) continue;
    const stops = [0, 1];
    for (let j = 0; j < ring.length; j++) {
      const [x, y] = ring[j], [u, v] = ring[(j + 1) % ring.length];
      const ex = u - x, ey = v - y;
      const determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < EPS) {
        for (const point of [[x,y],[u,v]]) {
          if (onSegment(path[i - 1], path[i], point)) {
            stops.push(Math.abs(dx) >= Math.abs(dy) ? (point[0] - ax) / dx : (point[1] - ay) / dy);
          }
        }
        continue;
      }
      const t = ((x - ax) * ey - (y - ay) * ex) / determinant;
      const edge = ((x - ax) * dy - (y - ay) * dx) / determinant;
      if (t > 0 && t < 1 && edge >= -EPS && edge <= 1 + EPS) stops.push(t);
    }
    stops.sort((a, b) => a - b);
    for (let j = 1; j < stops.length; j++) {
      const mid = (stops[j - 1] + stops[j]) / 2;
      if (!inside([ax + mid * dx, ay + mid * dy], ring)) return false;
    }
  }
  return true;
}

function cleanRing(raw) {
  const points = cleanPoints(raw);
  if (points.length > 1 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < EPS) points.pop();
  if (points.length < 3 || points.length > MAX_VERTICES) throw new Error('Cada contorno deve ter de 3 a ' + MAX_VERTICES + ' vértices.');
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    if (Math.abs(cross(a, b, c)) < EPS && (b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]) < -EPS) {
      throw new Error('O contorno contém um segmento sobreposto.');
    }
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) throw new Error('O contorno se cruza ou se toca.');
    }
  }
  if (Math.abs(signedArea(points)) < 0.001) throw new Error('O contorno precisa ter área maior que zero.');
  return points;
}

export function makePiece(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') throw new Error('Registro de peça inválido.');
  const name = String(raw.name ?? '').trim();
  const quantity = Number(raw.quantity ?? 1);
  if (!name || name.length > 70) throw new Error('Use um nome de 1 a 70 caracteres.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PIECES) throw new Error('A quantidade deve ser um inteiro entre 1 e ' + MAX_PIECES + '.');
  const orientation = raw.orientation ?? 'fixed';
  if (!['fixed', 'free'].includes(orientation)) throw new Error('A orientação deve ser fixed (0°/180°) ou free (livre).');
  if (raw.holes != null && !Array.isArray(raw.holes)) throw new Error('Furos devem ser uma lista de contornos.');
  if (!raw.points && (!(Number(raw.width) > 0) || !(Number(raw.height) > 0))) throw new Error('Informe largura e altura positivas.');
  const source = cleanRing(raw.points ?? rectangle(Number(raw.width), Number(raw.height)));
  const origin = bounds(source);
  const toOrigin = ring => ring.map(([x, y]) => [x - origin.x, y - origin.y]);
  const outer = toOrigin(source);
  const holes = (raw.holes ?? []).map(hole => toOrigin(cleanRing(hole)));
  if (holes.length > 30) throw new Error('O máximo é de 30 recortes internos por peça.');
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (!inside(hole[0], outer) || ringsIntersect(hole, outer)) throw new Error('Cada recorte interno deve estar inteiramente dentro do contorno.');
    for (const other of holes.slice(0, i)) {
      if (ringsIntersect(hole, other) || inside(hole[0], other) || inside(other[0], hole)) throw new Error('Dois recortes internos se tocam ou se sobrepõem.');
    }
  }
  if (raw.paths != null && !Array.isArray(raw.paths)) throw new Error('Linhas abertas devem ser uma lista de caminhos.');
  const paths = (raw.paths ?? []).map(path => {
    const points = toOrigin(cleanPoints(path));
    if (points.length < 2 || points.length > MAX_VERTICES) throw new Error('Uma linha aberta deve ter de 2 a ' + MAX_VERTICES + ' vértices.');
    if (!pathInside(points, outer)) throw new Error('Uma linha aberta ultrapassa o contorno externo da peça.');
    return points;
  });
  const footprint = Math.abs(signedArea(outer));
  const area = footprint - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  const { width, height } = origin;
  const rect = outer.length === 4 && !holes.length && outer.every(([x, y]) =>
    (x < EPS || Math.abs(x - width) < EPS) && (y < EPS || Math.abs(y - height) < EPS));
  const shape = rect && (raw.shape === 'rect' || !raw.points) ? 'rect' : 'poly';
  return { id: String(fallbackId ?? raw.id ?? name), name, quantity, orientation, outer, holes, paths, area, footprint, width, height, shape };
}

export function serialPiece(piece) {
  const { id, name, quantity, orientation, outer, holes, paths, shape } = piece;
  return { id, name, quantity, orientation, points: outer, holes, paths, shape };
}

export function rotatePiece(piece, angle) {
  if (!Number.isFinite(angle)) throw new Error('Informe um ângulo de giro válido.');
  const degrees = angle % 360;
  if (!degrees) return piece;
  const rad = degrees * Math.PI / 180;
  const snap = value => Math.abs(value) < EPS ? 0 : value;
  const sin = snap(Math.sin(rad)), cos = snap(Math.cos(rad));
  const rotate = points => points.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  return makePiece({
    ...serialPiece(piece),
    points: rotate(piece.outer), holes: piece.holes.map(rotate), paths: piece.paths.map(rotate)
  });
}

export function pointDistance2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}

export function edges(ring) {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { a, b, left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]), top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1]) };
  });
}

export function conflict(a, b, gap = DEFAULT_SHEET.gap) {
  const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0);
  const dy = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0);
  const limit = Math.max(gap / 2, gap - EPS);
  if (gap > 0 && dx * dx + dy * dy >= limit * limit) return false;
  if (gap === 0 &&
      (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= EPS ||
       Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= EPS)) return false;
  if (a.rect && b.rect) return true;
  const offsetX = b.x - a.x, offsetY = b.y - a.y;
  for (const first of a.edges) {
    for (const second of b.edges) {
      if (first.right + gap < second.left + offsetX || first.left - gap > second.right + offsetX ||
          first.bottom + gap < second.top + offsetY || first.top - gap > second.bottom + offsetY) continue;
      const c = [second.a[0] + offsetX, second.a[1] + offsetY];
      const d = [second.b[0] + offsetX, second.b[1] + offsetY];
      if (intersects(first.a, first.b, c, d)) return true;
      if (Math.min(pointDistance2(first.a, c, d), pointDistance2(first.b, c, d),
          pointDistance2(c, first.a, first.b), pointDistance2(d, first.a, first.b)) < limit * limit) return true;
    }
  }
  return inside([b.outer[0][0] + offsetX, b.outer[0][1] + offsetY], a.outer) ||
    inside([a.outer[0][0] - offsetX, a.outer[0][1] - offsetY], b.outer);
}

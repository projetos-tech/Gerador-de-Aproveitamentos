import { makePiece, bounds, signedArea, inside, pathInside, ringsIntersect, MAX_PIECES, MAX_VERTICES, rectangle, sheetDimensions } from './geometry.js';

import { splinePoints } from './spline.js';

export const EXAMPLE = [
  { name: 'Painel lateral', width: 500, height: 790, quantity: 8, orientation: 'fixed' },
  { name: 'Testeira', width: 560, height: 275, quantity: 6, orientation: 'fixed' },
  { name: 'Base de encaixe', points: [[0, 0], [470, 0], [470, 175], [235, 175], [235, 390], [0, 390]], quantity: 6, orientation: 'free' },
  { name: 'Reforço triangular', points: [[0, 0], [310, 0], [0, 260]], quantity: 12, orientation: 'free' }
];

const cleanHeader = value => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const orientation = value => {
  const cleaned = cleanHeader(String(value ?? ''));
  if (['', 'fixed', 'fixa', 'fixo', '0/180', '0°/180°'].includes(cleaned)) return 'fixed';
  if (['free', 'livre'].includes(cleaned)) return 'free';
  return value;
};

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const separator = first.includes(';') ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === separator) {
      row.push(field.trim()); field = '';
    } else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Há aspas abertas no CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() ?? []).map(cleanHeader);
  const value = (source, keys) => {
    const index = headers.findIndex(key => keys.includes(key));
    return index === -1 ? '' : (source[index] ?? '');
  };
  if (!headers.some(key => ['nome', 'name'].includes(key))) throw new Error('O CSV precisa de uma coluna nome.');
  return rows.map((r, index) => {
    if (r.length !== headers.length) throw new Error('Número de colunas inesperado na linha ' + (index + 2) + ' do CSV.');
    const raw = {
      name: value(r, ['nome', 'name']),
      width: value(r, ['largura', 'width']).replace(',', '.'),
      height: value(r, ['altura', 'height']).replace(',', '.'),
      quantity: value(r, ['quantidade', 'qtd', 'quantity']) || 1,
      orientation: orientation(value(r, ['orientacao', 'orientation']))
    };
    const points = value(r, ['pontos', 'points']);
    if (points) {
      try { raw.points = JSON.parse(points); }
      catch { throw new Error('Use uma lista JSON de vértices na coluna pontos, linha ' + (index + 2) + '.'); }
    }
    return raw;
  });
}

function dxfPairs(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n|\r/);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines.length % 2) throw new Error('O DXF tem um par de código e valor incompleto.');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\d+$/.test(lines[i].trim())) throw new Error('Use DXF ASCII exportado pelo seu CAD.');
    pairs.push([Number(lines[i]), lines[i + 1].trim()]);
  }
  return pairs;
}

function sampleArc(center, radius, start, sweep) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Um arco tem raio inválido.');
  const angleByError = 2 * Math.acos(Math.max(-1, 1 - 0.15 / radius));
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(Math.PI / 36, angleByError)));
  if (segments > MAX_VERTICES) throw new Error('Uma curva excede o limite de vértices após conversão.');
  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = start + sweep * i / segments;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}

function polylinePoints(vertices, closed) {
  if (vertices.length < 2) throw new Error('Uma polilinha DXF está sem vértices suficientes.');
  const points = [];
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, bulge = 0] = vertices[i];
    const a = [x, y];
    points.push(a);
    if ((!closed && i === vertices.length - 1) || Math.abs(bulge) < 1e-9) continue;
    const [u, v] = vertices[(i + 1) % vertices.length];
    const length = Math.hypot(u - x, v - y);
    if (length < 1e-7) continue;
    const offset = length * (1 - bulge * bulge) / (4 * bulge);
    const center = [(x + u) / 2 - (v - y) / length * offset, (y + v) / 2 + (u - x) / length * offset];
    points.push(...sampleArc(center, Math.hypot(x - center[0], y - center[1]),
      Math.atan2(y - center[1], x - center[0]), 4 * Math.atan(bulge)).slice(1, -1));
  }
  if (closed) points.push(points[0]);
  return points;
}

const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.001;
const overlapBounds = (a, b) => a.x <= b.right && b.x <= a.right && a.y <= b.bottom && b.y <= a.bottom;

function joinFragments(fragments, contours) {
  const nodes = [];
  function endpoint(layer, point) {
    const existing = nodes.find(node => node.layer === layer && samePoint(node.point, point));
    if (existing) return existing;
    const node = { layer, point, links: new Set() };
    nodes.push(node);
    return node;
  }

  const edges = fragments.filter(f => f.layer !== 'CORTE_ABERTO').map(fragment => {
    const from = endpoint(fragment.layer, fragment.points[0]);
    const to = endpoint(fragment.layer, fragment.points.at(-1));
    if (from === to) return null;
    const edge = { fragment, from, to };
    from.links.add(edge);
    to.links.add(edge);
    return edge;
  }).filter(Boolean);
  const pending = nodes.filter(node => node.links.size === 1);
  const otherEnd = (edge, node) => edge.from === node ? edge.to : edge.from;
  // Peel dangling branches before looking for closed, unambiguous chains.
  for (let i = 0; i < pending.length; i++) {
    const node = pending[i];
    if (node.links.size !== 1) continue;
    const edge = node.links.values().next().value;
    const other = otherEnd(edge, node);
    node.links.delete(edge);
    other.links.delete(edge);
    if (other.links.size === 1) pending.push(other);
  }

  const used = new Set(), visited = new Set();
  for (const first of edges) {
    if (!first.from.links.has(first) || visited.has(first)) continue;
    const component = [first];
    visited.add(first);
    for (let i = 0; i < component.length; i++) {
      const { from, to } = component[i];
      for (const edge of [...from.links, ...to.links]) {
        if (visited.has(edge)) continue;
        visited.add(edge);
        component.push(edge);
      }
    }
    if (component.some(({ from, to }) => from.links.size !== 2 || to.links.size !== 2)) continue;
    const points = [];
    let edge = first, node = first.from;
    do {
      const path = edge.from === node ? edge.fragment.points : [...edge.fragment.points].reverse();
      points.push(...(points.length ? path.slice(1) : path));
      node = otherEnd(edge, node);
      edge = [...node.links].find(candidate => candidate !== edge);
    } while (edge !== first);
    points.pop();
    const area = Math.abs(signedArea(points));
    if (points.length < 3 || area < 0.001) continue;
    for (const edge of component) used.add(edge.fragment);
    contours.push({ layer: first.fragment.layer, points, box: bounds(points), area });
  }
  return fragments.filter(fragment => !used.has(fragment));
}

function parseDxf(text, stem) {
  const pairs = dxfPairs(text);
  const unitIndex = pairs.findIndex(([code, value]) => code === 9 && value === '$INSUNITS');
  const unit = unitIndex < 0 ? 0 : Number(pairs[unitIndex + 1]?.[1]);
  const scale = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 12: 1e-6, 13: 0.001, 14: 100, 15: 10000, 16: 100000 };
  if (!Object.hasOwn(scale, unit)) throw new Error('Unidade DXF sem conversão disponível. Exporte em milímetros.');
  const start = pairs.findIndex(([code, value], i) => code === 2 && value === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  if (start === -1) throw new Error('A seção ENTITIES não foi encontrada no DXF.');
  const entities = [];
  for (let i = start + 1; i < pairs.length;) {
    const [code, kind] = pairs[i++];
    if (code !== 0) continue;
    if (kind === 'ENDSEC' || kind === 'EOF') break;
    const fields = [];
    while (i < pairs.length && pairs[i][0] !== 0) fields.push(pairs[i++]);
    entities.push({ kind, fields });
  }
  const contours = [], fragments = [];
  const ignored = new Set(['TEXT', 'MTEXT', 'DIMENSION', 'POINT', 'HATCH', 'LEADER', 'MLEADER', 'VIEWPORT', 'WIPEOUT', 'IMAGE']);
  const factor = scale[unit];
  for (let i = 0; i < entities.length; i++) {
    const { kind, fields } = entities[i];
    const get = (key, fallback) => fields.find(([code]) => code === key)?.[1] ?? fallback;
    const num = (key, fallback) => Number(get(key, fallback));
    const coord = (x, y) => [num(x) * factor, -num(y) * factor];
    const layer = get(8, '0');
    if (num(67, 0) === 1 || /^(CHAPA_REFERENCIA|BORDA_REFERENCIA)$/.test(layer) || ignored.has(kind)) continue;
    if (kind !== 'SPLINE' && (Math.abs(num(210, 0)) > 1e-7 || Math.abs(num(220, 0)) > 1e-7 || Math.abs(num(230, 1) - 1) > 1e-7)) {
      throw new Error('Exporte os contornos no plano XY do DXF com normal positiva.');
    }
    const push = points => {
      if (points.some(point => point.some(n => !Number.isFinite(n)))) throw new Error('Uma entidade DXF contém coordenadas inválidas.');
      if (layer !== 'CORTE_ABERTO' && samePoint(points[0], points.at(-1))) {
        points.pop();
        contours.push({ layer, points, box: bounds(points), area: Math.abs(signedArea(points)) });
      } else fragments.push({ layer, points });
    };
    if (kind === 'SPLINE') {
      const points = splinePoints(fields, factor);
      if ((num(70, 0) & 1) && !samePoint(points[0], points.at(-1))) {
        throw new Error('A SPLINE marcada como fechada tem extremidades separadas.');
      }
      push(points);
    } else if (kind === 'LINE') push([coord(10, 20), coord(11, 21)]);
    else if (kind === 'ARC' || kind === 'CIRCLE') {
      const startAngle = kind === 'ARC' ? num(50) * Math.PI / 180 : 0;
      const sweep = kind === 'ARC' ? ((num(51) - num(50) + 720) % 360) * Math.PI / 180 : Math.PI * 2;
      if (!Number.isFinite(sweep) || !sweep) throw new Error('Um arco DXF tem ângulos inválidos.');
      const center = coord(10, 20);
      push(sampleArc([center[0], -center[1]], num(40) * factor, startAngle, sweep).map(([x, y]) => [x, -y]));
    } else if (kind === 'LWPOLYLINE') {
      const vertices = [];
      for (const [code, value] of fields) {
        if (code === 10) vertices.push([Number(value) * factor, NaN, 0]);
        if (code === 20 && vertices.length) vertices.at(-1)[1] = -Number(value) * factor;
        if (code === 42 && vertices.length) vertices.at(-1)[2] = -Number(value);
      }
      if (vertices.some(v => v.some(n => !Number.isFinite(n)))) throw new Error('Uma polilinha DXF contém coordenadas inválidas.');
      push(polylinePoints(vertices, Boolean(num(70, 0) & 1)));
    } else if (kind === 'POLYLINE') {
      if (num(70, 0) & 126) throw new Error('Converta polilinhas 3D, malhas e curvas ajustadas em polilinhas 2D.');
      const vertices = [];
      while (entities[i + 1]?.kind === 'VERTEX') {
        const v = entities[++i].fields;
        const value = (key, fallback) => Number(v.find(([code]) => code === key)?.[1] ?? fallback);
        vertices.push([value(10) * factor, -value(20) * factor, -value(42, 0)]);
      }
      if (entities[i + 1]?.kind === 'SEQEND') i++;
      if (vertices.some(v => v.some(n => !Number.isFinite(n)))) throw new Error('Uma polilinha DXF contém coordenadas inválidas.');
      push(polylinePoints(vertices, Boolean(num(70, 0) & 1)));
    } else if (!['SEQEND', 'VERTEX'].includes(kind)) {
      throw new Error('Entidade DXF não suportada: ' + kind + '. No CAD, exploda blocos e converta curvas em polilinhas 2D.');
    }
  }
  if (fragments.length > 4000 || contours.length > MAX_PIECES * 2) throw new Error('O DXF contém geometrias demais para um único lote.');
  const openPaths = joinFragments(fragments, contours);
  contours.sort((a, b) => b.area - a.area);
  for (let i = 0; i < contours.length; i++) {
    const contour = contours[i];
    contour.parent = -1;
    contour.holes = [];
    contour.paths = [];
    for (let j = i - 1; j >= 0; j--) {
      const candidate = contours[j];
      if (!overlapBounds(contour.box, candidate.box)) continue;
      if (ringsIntersect(contour.points, candidate.points)) throw new Error('O DXF tem contornos que se tocam ou se cruzam. Separe as peças no CAD.');
      if (contour.parent === -1 && inside(contour.points[0], candidate.points)) contour.parent = j;
    }
    contour.depth = contour.parent < 0 ? 0 : contours[contour.parent].depth + 1;
    if (contour.depth % 2) contours[contour.parent].holes.push(contour.points);
  }
  const outside = contours.filter(contour => contour.depth % 2 === 0);
  for (const { layer, points } of openPaths) {
    const pathBox = bounds(points);
    const containing = outside.filter(contour => overlapBounds(pathBox, contour.box) && pathInside(points, contour.points));
    // A nested island takes precedence over the enclosing outline.
    const piece = containing.at(-1);
    if (!piece) throw new Error('A camada ' + layer + ' tem uma linha aberta fora de uma peça. Feche o perímetro externo ou remova a linha avulsa no CAD.');
    piece.paths.push(points);
  }
  return outside.map(({ layer, points, holes, paths }, index) => ({
    name: (layer === '0' || layer === 'CORTE' ? stem : layer).slice(0, 54) + (outside.length > 1 ? ' ' + (index + 1) : ''),
    points, holes, paths, quantity: 1, orientation: 'fixed'
  }));
}

export function readFile(text, filename) {
  const dot = filename.lastIndexOf('.');
  const extension = filename.slice(dot + 1).toLowerCase();
  const stem = filename.slice(0, dot).trim() || 'Peça';
  const source = text.replace(/^\uFEFF/, '').trim();
  let raw;
  if (extension === 'csv') raw = parseCsv(source);
  else if (extension === 'dxf') raw = parseDxf(source, stem);
  else if (extension === 'json') {
    const parsed = JSON.parse(source);
    raw = Array.isArray(parsed) ? parsed : parsed?.pieces;
  } else throw new Error('Selecione um arquivo DXF, CSV ou JSON.');
  if (!Array.isArray(raw) || !raw.length) throw new Error('Nenhuma peça encontrada no arquivo.');
  return raw.map((record, i) => {
    try { return makePiece(record); }
    catch (error) { throw new Error('Peça ' + (i + 1) + ': ' + error.message); }
  });
}

export function exportDxf(sheets, size, guides = true, roles = {}) {
  let offset = 0;
  const output = [];
  const pair = (code, value) => output.push(code, value);
  const section = name => { pair(0, 'SECTION'); pair(2, name); };
  const end = () => pair(0, 'ENDSEC');
  const number = value => Number(value.toFixed(9));
  const layers = [['0', 7], ['CORTE', 7], ['CORTE_ABERTO', 7], ['VINCO', 4], ['REFERENCIA', 8], ['CHAPA_REFERENCIA', 8], ['BORDA_REFERENCIA', 9]];
  section('HEADER');
  pair(9, '$ACADVER'); pair(1, 'AC1009');
  pair(9, '$LUNITS'); pair(70, 2);
  pair(9, '$LUPREC'); pair(70, 3);
  end();
  section('TABLES');
  pair(0, 'TABLE'); pair(2, 'LTYPE'); pair(70, 1);
  pair(0, 'LTYPE'); pair(2, 'CONTINUOUS'); pair(70, 0); pair(3, 'Solid line');
  pair(72, 65); pair(73, 0); pair(40, 0);
  pair(0, 'ENDTAB');
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, layers.length);
  for (const [name, color] of layers) {
    pair(0, 'LAYER'); pair(2, name); pair(70, 0); pair(62, color); pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB');
  end();
  section('BLOCKS');
  end();
  section('ENTITIES');
  function polyline(points, layer, dx, dy, closed = true) {
    pair(0, 'POLYLINE'); pair(8, layer); pair(66, 1);
    pair(10, 0); pair(20, 0); pair(30, 0); pair(70, closed ? 1 : 0);
    for (const [x, y] of points) {
      pair(0, 'VERTEX'); pair(8, layer);
      pair(10, number(dx + x)); pair(20, number(dy - y)); pair(30, 0); pair(70, 0);
    }
    pair(0, 'SEQEND'); pair(8, layer);
  }
  sheets.forEach((sheet, index) => {
    const {width,height,border} = sheetDimensions(sheet.size ?? size);
    const dx = offset, dy = height; offset += width + 150;
    if (guides) polyline([[0,0],[width,0],[width,height],[0,height]], 'CHAPA_REFERENCIA', dx, dy);
    if (guides && border > 0) polyline(rectangle(width - 2 * border, height - 2 * border), 'BORDA_REFERENCIA', dx + border, dy - border);
    for (const part of sheet.placements) {
      (part.paths ?? []).forEach((path,i) => {
        const layer = roles[part.id]?.[i] ?? 'CORTE_ABERTO';
        if (layer !== 'REFERENCIA' || guides) polyline(path,layer,dx+part.x,dy-part.y,false);
      });
      for (const ring of [...part.holes, part.outer]) polyline(ring, 'CORTE', dx + part.x, dy - part.y);
    }
  });
  end(); pair(0, 'EOF');
  return output.join('\r\n') + '\r\n';
}

import { MAX_VERTICES } from './geometry.js';

function distanceToSegmentSquared([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const fraction = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return (x - ax - fraction * dx) ** 2 + (y - ay - fraction * dy) ** 2;
}

function simplify(points, tolerance) {
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop();
    let farthest = -1, distance = tolerance ** 2;
    for (let i = start + 1; i < end; i++) {
      const candidate = distanceToSegmentSquared(points[i], points[start], points[end]);
      if (candidate > distance) { farthest = i; distance = candidate; }
    }
    if (farthest < 0) continue;
    keep.add(farthest);
    pending.push([start, farthest], [farthest, end]);
  }
  return points.filter((_, index) => keep.has(index));
}

export function splinePoints(fields, factor) {
  const knots = [], controls = [], weights = [];
  let degree = 0;
  for (const [code, field] of fields) {
    const value = Number(field);
    if (code === 71) degree = value;
    if (code === 40) knots.push(value);
    if (code === 41) weights.push(value);
    if (code === 10) controls.push([value * factor, NaN, 0]);
    if (code === 20 && controls.length) controls.at(-1)[1] = -value * factor;
    if (code === 30 && controls.length) controls.at(-1)[2] = value * factor;
  }
  const count = controls.length;
  if (!count) throw new Error('A SPLINE contém apenas pontos de ajuste. No CAD, converta essa curva em uma polilinha 2D.');
  if (!Number.isInteger(degree) || degree < 1 || count <= degree || knots.length !== count + degree + 1 ||
      knots.some((knot, i) => !Number.isFinite(knot) || (i > 0 && knot < knots[i - 1])) ||
      knots[degree] >= knots[count] || controls.some(point => point.some(value => !Number.isFinite(value))) ||
      (weights.length && (weights.length !== count || weights.some(weight => !Number.isFinite(weight) || weight <= 0)))) {
    throw new Error('A SPLINE tem nós, pontos de controle ou pesos inválidos.');
  }
  if (controls.some(point => Math.abs(point[2] - controls[0][2]) > 0.001)) {
    throw new Error('Exporte a SPLINE em um plano paralelo ao XY.');
  }
  const weighted = controls.map(([x, y], i) => {
    const w = weights[i] ?? 1;
    return [x * w, y * w, w];
  });

  // Evaluate the knot span in homogeneous coordinates using de Boor's algorithm.
  function point(t, span) {
    const first = span - degree;
    const values = weighted.slice(first, span + 1).map(p => [...p]);
    for (let level = 1; level <= degree; level++) {
      for (let j = degree; j >= level; j--) {
        const low = knots[first + j], high = knots[first + j + degree - level + 1];
        const ratio = high === low ? 0 : (t - low) / (high - low);
        values[j] = values[j].map((value, axis) => (1 - ratio) * values[j - 1][axis] + ratio * value);
      }
    }
    const [x, y, w] = values[degree];
    return [x / w, y / w];
  }

  const sampled = [];
  const probes = Math.max(4, degree * 2);
  function append(t0, a, t1, b, span, depth) {
    let needsSplit = false;
    for (let i = 1; i < probes; i++) {
      if (distanceToSegmentSquared(point(t0 + (t1 - t0) * i / probes, span), a, b) > 0.05 ** 2) {
        needsSplit = true;
        break;
      }
    }
    if (!needsSplit) { sampled.push(b); return; }
    if (depth >= 18 || sampled.length > MAX_VERTICES * 30) throw new Error('A SPLINE é complexa demais para converter com a precisão de corte.');
    const mid = t0 + (t1 - t0) / 2, center = point(mid, span);
    append(t0, a, mid, center, span, depth + 1);
    append(mid, center, t1, b, span, depth + 1);
  }

  for (let span = degree; span < count; span++) {
    const start = knots[span], end = knots[span + 1];
    if (end === start) continue;
    const a = point(start, span), b = point(end, span);
    if (!sampled.length) sampled.push(a);
    else {
      const [x, y] = sampled.at(-1);
      if (Math.hypot(a[0] - x, a[1] - y) > 0.001) throw new Error('A SPLINE contém uma descontinuidade no contorno.');
    }
    append(start, a, end, b, span, 0);
  }

  const points = simplify(sampled, 0.05);
  if (points.length > MAX_VERTICES + 1) throw new Error('O contorno SPLINE excede o limite de vértices após conversão.');
  return points;
}

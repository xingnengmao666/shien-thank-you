// Wider walls fill both lobes before adding more rows.
export function heartRows(count, columns) {
  if (!count) return [];
  columns = Math.max(1, Math.min(columns, count));
  if (columns === 1) return Array.from({ length: count }, (_, i) => [i]);
  if (count <= 2) return [Array.from({ length: count }, (_, i) => i)];
  const shoulders = Math.max(2, Math.floor(columns * .7 / 2) * 2);
  let capacities;
  for (let rows = 2; ; rows++) {
    capacities = Array.from({ length: rows }, (_, r) => r === 0 ? shoulders : Math.max(1, Math.ceil(columns * (1 - Math.max(0, r / (rows - 1) - .5) * 2))));
    if (capacities.reduce((sum, n) => sum + n, 0) >= count) break;
  }
  let excess = capacities.reduce((sum, n) => sum + n, 0) - count;
  for (let r = 1; excess > 0; r = r % (capacities.length - 2) + 1) {
    if (capacities[r] > 1) { capacities[r]--; excess--; }
  }
  let index = 0;
  return capacities.map(n => Array.from({ length: n }, () => index++));
}

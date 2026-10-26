export interface RouteHistory { name: string; minutes: number[] }
export interface RoutePlan {
  name: string;
  samples: number[];
  typicalMinutes: number;
  plannedMinutes: number;
  departure: number;
  covered: number;
  total: number;
  typicalLate: number;
}

// Deliberately synthetic, hand-authored examples. They are not transit observations.
export const DEMO_ROUTES: RouteHistory[] = [
  { name: 'Riverside bus', minutes: [22, 23, 24, 24, 25, 25, 26, 26, 27, 28, 28, 29, 31, 33, 34, 36, 46, 52, 58, 64] },
  { name: 'Metro + walk', minutes: [32, 33, 33, 34, 34, 35, 35, 35, 36, 36, 36, 37, 37, 38, 38, 39, 39, 40, 42, 44] },
];

export function parseTime(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use a 24-hour arrival time, like 09:00.');
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatTime(minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440);
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const time = `${Math.floor(normalized / 60).toString().padStart(2, '0')}:${Math.floor(normalized % 60).toString().padStart(2, '0')}`;
  return dayOffset < 0 ? `${time} (previous day)` : dayOffset > 0 ? `${time} (next day)` : time;
}

// Nearest-rank empirical quantile: the ceil(n * p)-th ordered observation.
export function quantile(sorted: number[], percentile: number): number {
  if (!sorted.length || !Number.isFinite(percentile) || percentile <= 0 || percentile > 1) throw new Error('Invalid history or coverage.');
  return sorted[Math.ceil(sorted.length * percentile) - 1];
}

export function planRoutes(routes: RouteHistory[], arrival: number, coverage: number, buffer: number): RoutePlan[] {
  if (!Number.isInteger(arrival) || arrival < 0 || arrival >= 1440) throw new Error('Invalid arrival time.');
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60) throw new Error('Set extra buffer between 0 and 60 minutes.');
  if (!Number.isFinite(coverage) || coverage < 0.5 || coverage > 1) throw new Error('Invalid coverage.');
  return routes.map(route => {
    if (!route.minutes.length || route.minutes.some(n => !Number.isInteger(n) || n <= 0 || n > 360)) throw new Error('Trip minutes must be whole numbers from 1 to 360.');
    const samples = [...route.minutes].sort((a, b) => a - b);
    const typicalMinutes = quantile(samples, 0.5);
    const plannedMinutes = quantile(samples, coverage);
    return {
      name: route.name, samples, typicalMinutes, plannedMinutes,
      departure: arrival - buffer - plannedMinutes,
      covered: samples.filter(n => n <= plannedMinutes).length,
      total: samples.length,
      // Baseline: leave using median + the same extra buffer. Late means after the actual appointment.
      typicalLate: samples.filter(n => n > typicalMinutes + buffer).length,
    };
  }).sort((a, b) => b.departure - a.departure || a.typicalMinutes - b.typicalMinutes || a.name.localeCompare(b.name));
}

function parseRow(line: string, row: number): string[] {
  const fields: string[] = [];
  let field = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',') { fields.push(field.trim()); field = ''; closed = false; }
    else if (char === '"' && !field.trim() && !closed) { quoted = true; field = ''; }
    else if ((closed && char.trim()) || char === '"') throw new Error(`Row ${row}: invalid CSV quoting.`);
    else field += char;
  }
  if (quoted) throw new Error(`Row ${row}: close the quoted field; multiline fields are not supported.`);
  fields.push(field.trim());
  return fields;
}

export function parseHistoryCSV(text: string): RouteHistory[] {
  if (text.length > 100_000) throw new Error('Use a CSV smaller than 100 KB.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('Add a route,minutes header and at least 5 trips per route.');
  if (lines.length > 501) throw new Error('Use at most 500 trips.');
  const header = parseRow(lines[0], 1).map(s => s.toLowerCase());
  if (header.length !== 2 || !header.includes('route') || !header.includes('minutes')) throw new Error('The two headers must be route,minutes (either order).');
  const routeIndex = header.indexOf('route'), minuteIndex = header.indexOf('minutes');
  const groups = new Map<string, number[]>();
  lines.slice(1).forEach((line, index) => {
    const cells = parseRow(line, index + 2);
    if (cells.length !== 2) throw new Error(`Row ${index + 2}: expected exactly two columns.`);
    const name = cells[routeIndex], value = cells[minuteIndex];
    if (!name || name.length > 45 || /[\x00-\x1F\x7F]/.test(name)) throw new Error(`Row ${index + 2}: use a route name of 1–45 printable characters.`);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 360) throw new Error(`Row ${index + 2}: minutes must be a whole number from 1 to 360.`);
    const values = groups.get(name) ?? [];
    values.push(Number(value)); groups.set(name, values);
  });
  if (groups.size > 6) throw new Error('Compare at most 6 routes.');
  for (const [name, values] of groups) {
    if (values.length < 5) throw new Error(`${name}: add at least 5 trips (20 or more is better).`);
  }
  return [...groups].map(([name, minutes]) => ({ name, minutes }));
}

export function historyToCSV(routes: RouteHistory[]): string {
  return 'route,minutes\n' + routes.flatMap(route => route.minutes.map(n => `"${route.name.replaceAll('"', '""')}",${n}`)).join('\n') + '\n';
}

export function planText(plan: RoutePlan, arrival: number, buffer: number, coverage: number, source: string): string {
  return [
    'BUFFER — MY COMMUTE PLAN', '',
    `Route: ${plan.name}`, `Leave by: ${formatTime(plan.departure)}`,
    `Arrive by: ${formatTime(arrival)} (local time)`,
    `Trip allowance: ${plan.plannedMinutes} min + ${buffer} min extra buffer`,
    `Selected history coverage: ${Math.round(coverage * 100)}%`,
    `Observed coverage: ${plan.covered}/${plan.total} trips fit the trip allowance.`,
    `Data: ${source}`, '',
    'Based on past trip durations, not a forecast or guarantee. Check current service conditions.',
    'Times are for one journey, in your local time. No live transit data is used.',
  ].join('\n');
}

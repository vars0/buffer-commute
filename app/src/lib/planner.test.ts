import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ROUTES, formatTime, historyToCSV, parseHistoryCSV, parseTime, planRoutes, planText, quantile } from './planner';

test('90% picks the steadier route, with an auditable departure calculation', () => {
  const plans = planRoutes(DEMO_ROUTES, parseTime('09:00'), 0.9, 5);
  assert.equal(plans[0].name, 'Metro + walk');
  assert.equal(plans[0].plannedMinutes, 40);
  assert.equal(formatTime(plans[0].departure), '08:15');
  assert.equal(plans[0].covered, 18);
  assert.equal(plans[1].typicalLate, 6);
  assert.equal(plans[1].plannedMinutes, 52);
  assert.equal(formatTime(plans[1].departure), '08:03');
});
test('coverage changes the decision, including the route crossover at 80%', () => {
  const relaxed = planRoutes(DEMO_ROUTES, 540, 0.8, 5)[0];
  assert.equal(relaxed.name, 'Riverside bus');
  assert.equal(formatTime(relaxed.departure), '08:19');
  assert.equal(formatTime(planRoutes(DEMO_ROUTES, 540, 0.95, 5)[0].departure), '08:13');
  assert.equal(formatTime(planRoutes(DEMO_ROUTES, 540, 1, 5)[0].departure), '08:11');
});
test('ties can cover more than the selected share; equality is on time', () => {
  const result = planRoutes([{ name: 'A', minutes: [10, 10, 10, 10, 10] }], 60, 0.9, 0)[0];
  assert.equal(result.covered, 5);
  assert.equal(result.typicalLate, 0);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.9), 50);
});
test('midnight departure explicitly identifies the previous day', () => {
  const result = planRoutes(DEMO_ROUTES, parseTime('00:10'), 0.9, 5)[0];
  assert.equal(formatTime(result.departure), '23:25 (previous day)');
  assert.equal(formatTime(-1440), '00:00 (previous day)');
  assert.equal(formatTime(0), '00:00');
});
test('buffer changes departure, while baseline counts actual late arrivals', () => {
  const data = [{ name: 'A', minutes: [10, 12, 15, 20, 25] }];
  const zero = planRoutes(data, 60, 0.8, 0)[0];
  const extra = planRoutes(data, 60, 0.8, 5)[0];
  assert.equal(zero.departure - extra.departure, 5);
  assert.equal(zero.typicalLate, 2);
  assert.equal(extra.typicalLate, 1);
});
test('CSV round-trips synthetic data and safely handles commas and escaped quotes', () => {
  assert.deepEqual(parseHistoryCSV(historyToCSV(DEMO_ROUTES)), DEMO_ROUTES);
  const data = [{ name: 'Bus, "A"', minutes: [10, 12, 15, 20, 25] }];
  assert.deepEqual(parseHistoryCSV('\uFEFF' + historyToCSV(data).replaceAll('\n', '\r\n')), data);
  assert.equal(parseHistoryCSV('minutes,route\n1,A\n2,A\n3,A\n4,A\n5,A')[0].name, 'A');
});
test('malformed and incomplete CSV is rejected rather than partially imported', () => {
  for (const text of [
    'route,minutes\nA,10', 'wrong,minutes\nA,20',
    'route,minutes\nA,NaN', 'route,minutes\nA,2.5',
    'route,minutes\nA,-1', 'route,minutes\nA,361',
    'route,minutes\n"A,10', 'route,minutes\n"A"x,10',
    'route,minutes\nA,10,extra', 'route,minutes\n,10',
  ]) assert.throws(() => parseHistoryCSV(text));
});
test('CSV bounds limit file size, route count and record count', () => {
  assert.throws(() => parseHistoryCSV('x'.repeat(100001)), /100 KB/);
  assert.throws(() => parseHistoryCSV('route,minutes\n' + 'A,20\n'.repeat(501)), /500/);
  assert.throws(() => parseHistoryCSV('route,minutes\n' + Array.from({ length: 7 }, (_, i) => (`R${i},20\n`).repeat(5)).join('')), /6 routes/);
});
test('invalid controls never produce an apparently valid plan', () => {
  for (const time of ['', '24:00', '09:60', '9:00']) assert.throws(() => parseTime(time));
  for (const buffer of [-1, 61, 1.5, NaN]) assert.throws(() => planRoutes(DEMO_ROUTES, 540, 0.9, buffer));
  assert.throws(() => planRoutes(DEMO_ROUTES, 540, NaN, 5));
  assert.throws(() => planRoutes([{ name: 'A', minutes: [0] }], 540, 0.9, 5));
});
test('export preserves provenance, assumptions and the actual chosen route', () => {
  const plan = planRoutes(DEMO_ROUTES, 540, 0.9, 5)[1];
  const result = planText(plan, 540, 5, 0.9, 'Synthetic demo data');
  assert.match(result, /Route: Riverside bus/);
  assert.match(result, /08:03/);
  assert.match(result, /18\/20/);
  assert.match(result, /Synthetic demo data/);
  assert.match(result, /not a forecast or guarantee/);
});

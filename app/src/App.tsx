import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { DEMO_ROUTES, formatTime, historyToCSV, parseHistoryCSV, parseTime, planRoutes, planText } from './lib/planner';
import type { RouteHistory, RoutePlan } from './lib/planner';

type IconName = 'arrow' | 'bus' | 'train' | 'clock' | 'check' | 'upload' | 'download';
const paths: Record<IconName, string> = {
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  bus: 'M5 16V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10H5Zm0-7h14M7 16v3m10-3v3M8 12h.01M16 12h.01',
  train: 'M7 17h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Zm-2-7h14M8 14h.01m8 0h.01M8 17l-3 4m11-4 3 4M9 20h6',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  check: 'm5 12 4 4L19 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
};
function Icon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function saveFile(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TripChart({ plan, max }: { plan: RoutePlan; max: number }) {
  const counts = new Map<number, number>();
  const totals = new Map<number, number>();
  plan.samples.forEach(duration => totals.set(duration, (totals.get(duration) ?? 0) + 1));
  const step = Math.min(12, 50 / Math.max(...totals.values()));
  const radius = Math.max(1, Math.min(4.5, step * 0.42));
  const x = (minutes: number) => 18 + minutes / max * 354;
  return <svg className="trip-chart" viewBox="0 0 390 106" role="img" aria-label={`${plan.name}: ${plan.covered} of ${plan.total} past trips took ${plan.plannedMinutes} minutes or less. Each dot is one trip.`}>
    <line x1="18" y1="76" x2="372" y2="76" stroke="#d4d7cc" />
    {[0, Math.round(max / 2), max].map(tick => <g key={tick}><line x1={x(tick)} y1="76" x2={x(tick)} y2="80" stroke="#a9b4a8" /><text x={x(tick)} y="99" textAnchor="middle" fill="#647468" fontSize="11">{tick}{tick === max ? ' min' : ''}</text></g>)}
    <line x1={x(plan.plannedMinutes)} y1="10" x2={x(plan.plannedMinutes)} y2="79" stroke="#1d5142" strokeDasharray="3 4" />
    <text x={Math.min(350, Math.max(45, x(plan.plannedMinutes)))} y="10" textAnchor="middle" fill="#1d5142" fontSize="11">allow {plan.plannedMinutes}m</text>
    {plan.samples.map((duration, index) => {
      const stack = counts.get(duration) ?? 0; counts.set(duration, stack + 1);
      return <circle key={index} cx={x(duration)} cy={67 - stack * step} r={radius} fill={duration <= plan.plannedMinutes ? '#3d7960' : '#ca7047'} />;
    })}
  </svg>;
}

function RouteCard({ plan, recommended, selected, max, onSelect }: { plan: RoutePlan; recommended: boolean; selected: boolean; max: number; onSelect: () => void }) {
  return <article className={`route-card ${selected ? 'selected' : ''}`}>
    <div className="route-card-top"><span className="route-icon"><Icon name={plan.name === 'Metro + walk' ? 'train' : 'bus'} /></span><h3>{plan.name}</h3>{recommended ? <span className="best-badge">Latest departure</span> : null}</div>
    <div className="route-stat-row"><div><span className="small-label">Typical trip</span><strong>{plan.typicalMinutes}<span> min</span></strong></div><span className="stat-arrow">→</span><div><span className="small-label">Trip allowance</span><strong>{plan.plannedMinutes}<span> min</span></strong></div><div className="departure-stat"><span className="small-label">Leave by</span><strong>{formatTime(plan.departure)}</strong></div></div>
    <TripChart plan={plan} max={max} />
    <div className="route-card-bottom"><span><b>{plan.covered}/{plan.total}</b> past trips fit</span><button className={selected ? 'chosen-button' : 'text-button'} onClick={onSelect} aria-pressed={selected} aria-label={`Choose ${plan.name}`}>{selected ? <><Icon name="check" /> Selected</> : <>Use this route <Icon name="arrow" /></>}</button></div>
  </article>;
}

export default function App() {
  const [arrival, setArrival] = useState('09:00');
  const [buffer, setBuffer] = useState('5');
  const [coverage, setCoverage] = useState(0.9);
  const [routes, setRoutes] = useState<RouteHistory[]>(DEMO_ROUTES);
  const [isDemo, setIsDemo] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const [filename, setFilename] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  let plans: RoutePlan[] = [], inputError = '', arrivalMinutes = 0;
  try {
    arrivalMinutes = parseTime(arrival);
    if (!/^\d+$/.test(buffer)) throw new Error('Set extra buffer between 0 and 60 minutes.');
    plans = planRoutes(routes, arrivalMinutes, coverage, Number(buffer));
  } catch (error) { inputError = (error as Error).message; }
  const recommended = plans[0];
  const chosen = plans.find(plan => plan.name === selectedRoute) ?? recommended;
  const fastest = [...plans].sort((a, b) => a.typicalMinutes - b.typicalMinutes)[0];
  const chartMax = Math.max(10, Math.ceil(Math.max(...routes.flatMap(route => route.minutes)) / 10) * 10);
  const source = isDemo ? 'Synthetic demo data — 20 invented trips per route' : `Your CSV: ${filename} (processed only in this browser)`;
  const summary = chosen ? planText(chosen, arrivalMinutes, Number(buffer), coverage, source) : '';

  function resetDemo() {
    setRoutes(DEMO_ROUTES); setIsDemo(true); setFilename(''); setSelectedRoute(null); setImportError('');
    setArrival('09:00'); setBuffer('5'); setCoverage(0.9); setNotice('Demo restored. All trip records are synthetic.');
    if (fileInput.current) fileInput.current.value = '';
  }
  async function importCSV(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(''); setNotice('');
    try {
      if (file.size > 100_000) throw new Error('Use a CSV smaller than 100 KB.');
      const parsed = parseHistoryCSV(await file.text());
      setRoutes(parsed); setIsDemo(false); setFilename(file.name); setSelectedRoute(null);
      setNotice(`Loaded ${parsed.reduce((n, route) => n + route.minutes.length, 0)} trips across ${parsed.length} route${parsed.length === 1 ? '' : 's'}. Nothing was uploaded.`);
    } catch (error) { setImportError((error as Error).message + ' Your current data has been kept.'); }
    event.target.value = '';
  }
  async function copyPlan() {
    try { await navigator.clipboard.writeText(summary); setNotice('Plan copied. You can paste it into your notes.'); }
    catch { setNotice('Clipboard is unavailable here. Use Download plan instead.'); }
  }

  return <>
    <a className="skip-link" href="#planner">Skip to planner</a>
    <header className="site-header page-width">
      <a href="#" className="wordmark" aria-label="Buffer home"><span className="brand-mark">b.</span>buffer<span className="wordmark-dot">•</span></a>
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><span className="nav-divider" /><span className="local-badge"><span /> Runs in your browser</span></nav>
    </header>
    <main className="page-width">
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow"><span className="tiny-route" /> LESS GUESSING. MORE BREATHING ROOM.</p><h1>A little room<br />for <em>real life.</em></h1><p className="hero-description">Your commute has good days and slow days.<br className="desktop-break" /> Find a route and a departure time that leave room for both.</p><a className="hero-link" href="#planner">Make your morning plan <Icon name="arrow" /></a></div>
        <div className="route-illustration" aria-hidden="true">
          <svg viewBox="0 0 440 240" fill="none"><path d="M20 40h400M20 95h400M20 150h400M20 205h400M55 15v220M120 15v220M185 15v220M250 15v220M315 15v220M380 15v220" stroke="#dedfd3" strokeWidth="1" /><path d="M57 181V69q0-25 25-25h75q25 0 25 25v77q0 25 25 25h109q25 0 25-25V66" stroke="#c7cdbf" strokeWidth="12" strokeLinecap="round" /><path d="M57 181h73q26 0 26-26V98q0-27 27-27h158" stroke="#315e49" strokeWidth="12" strokeLinecap="round" /><path d="M57 181h73q26 0 26-26V98q0-27 27-27h158" stroke="#f5f3e9" strokeWidth="2" strokeDasharray="2 12" /><circle cx="57" cy="181" r="13" fill="#f6f4ec" stroke="#315e49" strokeWidth="5" /><circle cx="341" cy="71" r="13" fill="#e4a05e" stroke="#f6f4ec" strokeWidth="5" /><circle cx="341" cy="71" r="25" stroke="#dbae79" strokeDasharray="3 5" /><text x="28" y="218" fill="#647468" fontSize="12" fontFamily="sans-serif">HOME</text><text x="306" y="31" fill="#647468" fontSize="12" fontFamily="sans-serif">YOUR DAY</text></svg>
          <div className="illustration-note"><Icon name="clock" /><span>On time. With room to spare.</span></div>
        </div>
      </section>

      <section id="planner" className="planner-section" aria-labelledby="planner-title">
        <div className="section-heading"><div><p className="eyebrow">01 / YOUR MORNING, PLANNED</p><h2 id="planner-title">When should you leave?</h2></div><span className={`data-badge ${isDemo ? '' : 'own-data'}`}><span /> {isDemo ? 'Synthetic demo data' : 'Your local CSV'}</span></div>
        <div className="planner-grid">
          <div className="preferences card">
            <div className="field-heading"><span className="step-number">1</span><h3>Set your arrival</h3><span>Local time · 24h</span></div>
            <div className="time-fields"><label>Arrive by<input aria-label="Arrive by" type="text" placeholder="HH:MM" maxLength={5} title="24-hour time, for example 09:00" value={arrival} onChange={event => { setArrival(event.target.value); setNotice(''); }} required /></label><label>Extra buffer<span className="number-input"><input aria-label="Extra buffer in minutes" type="number" min="0" max="60" step="1" value={buffer} onChange={event => { setBuffer(event.target.value); setNotice(''); }} /><span>min</span></span></label></div>
            <p className="field-help">A little time to settle in after you arrive.</p>
            <div className="field-heading coverage-heading"><span className="step-number">2</span><h3>Choose your breathing room</h3></div>
            <p className="coverage-help">Allow enough travel time to fit this share of past trips.</p>
            <div className="coverage-options" role="group" aria-label="History coverage">{[0.8, 0.9, 0.95, 1].map(value => <button key={value} aria-pressed={coverage === value} onClick={() => { setCoverage(value); setSelectedRoute(null); setNotice(''); }}>{Math.round(value * 100)}%</button>)}</div>
            <div className="coverage-description"><span className="coverage-dot" />{coverage === 0.8 ? 'More time at home. Less room for slow days.' : coverage === 0.9 ? 'A little more room for the slower trips.' : coverage === 0.95 ? 'More room for unusually slow trips.' : 'Room for the slowest trip in this history.'}</div>
            <div className="history-footer"><div className="history-count"><span className="history-bars">▂▅▃▇▅</span><div><strong>{routes.reduce((n, route) => n + route.minutes.length, 0)} trips · {routes.length} routes</strong><span>{isDemo ? 'Invented examples, ready to explore' : 'Your records, kept in this tab'}</span></div></div><a href="#your-data" aria-label="Go to import your own history">Use your own <Icon name="arrow" /></a></div>
          </div>

          <section className="plan-result" aria-label="Your departure plan" aria-live="polite">
            {chosen ? <><div className="result-topline"><span><span className="live-dot" /> YOUR DEPARTURE PLAN</span><Icon name="clock" /></div><div className="departure-label">Leave by</div><div className="departure-time" data-testid="departure-time">{formatTime(chosen.departure)}</div><div className="result-route"><Icon name={chosen.name === 'Metro + walk' ? 'train' : 'bus'} /><span>{chosen.name}</span>{chosen.name === recommended.name ? <span className="recommended-tag">Recommended</span> : null}</div><div className="plan-timeline"><div><span className="timeline-node" /><strong>{chosen.plannedMinutes} min</strong><span>travel allowance</span></div><div><span className="timeline-node buffer-node" /><strong>{buffer} min</strong><span>extra buffer</span></div><div><span className="timeline-node arrival-node" /><strong>{formatTime(arrivalMinutes)}</strong><span>arrive by</span></div></div><p className="result-explanation"><b>{chosen.covered} of {chosen.total} past trips</b> fit this travel allowance. {chosen.name === recommended.name ? 'This route lets you leave latest at your selected history coverage.' : `The recommended route leaves ${recommended.departure - chosen.departure} minutes later at this coverage.`}</p><div className="result-actions"><button onClick={() => void copyPlan()}>Copy plan <Icon name="arrow" /></button><button className="download-plan" onClick={() => saveFile('buffer-plan.txt', summary, 'text/plain;charset=utf-8')} aria-label="Download plan"><Icon name="download" /></button></div></> : <div className="invalid-plan"><Icon name="clock" /><h3>Let’s finish your plan.</h3><p role="alert">{inputError}</p></div>}
          </section>
        </div>
        {fastest && recommended ? <div className="insight"><span className="insight-symbol">↗</span><p><b>Fast on a typical day isn’t the whole story.</b> Leaving for {fastest.name} using its {fastest.typicalMinutes}-minute typical trip plus your {buffer}-minute buffer would have been late on <strong>{fastest.typicalLate} of {fastest.total}</strong> recorded trips. {isDemo ? 'These are synthetic examples.' : 'This is a historical replay, not a forecast.'}</p></div> : null}
      </section>

      <section className="compare-section" aria-labelledby="compare-title"><div className="section-heading"><div><p className="eyebrow">02 / SEE THE TRADE-OFF</p><h2 id="compare-title">Same destination. Different days.</h2></div><span className="chart-legend"><i /> One dot = one past trip</span></div><div className="route-cards">{plans.map(plan => <RouteCard key={plan.name} plan={plan} recommended={plan.name === recommended?.name} selected={plan.name === chosen?.name} max={chartMax} onSelect={() => { setSelectedRoute(plan.name); setNotice(''); }} />)}</div>{inputError ? <p className="inline-error">{inputError}</p> : null}<p className="compare-footnote">Green dots fit the travel allowance; orange dots exceed it. Dots can overlap in dense histories. “Typical” is the median. Use full door-to-door durations.</p></section>

      <section className="bottom-grid">
        <div className="your-data card" id="your-data"><p className="eyebrow">MAKE IT YOURS</p><h2>Your commute. Your history.</h2><p>Bring trips from similar days and departure times. Your file is read in this tab and never sent to a server.</p><div className="csv-example"><span>route,minutes</span><span>Campus bus,32</span><span>Campus bus,38</span><span className="csv-comment">…at least 5 trips per route</span></div><label className="import-button"><Icon name="upload" /> Import trip CSV<input ref={fileInput} type="file" accept=".csv,text/csv" aria-label="Import trip CSV" onChange={event => void importCSV(event)} /></label><div className="data-links"><button onClick={() => saveFile('buffer-example.csv', historyToCSV(DEMO_ROUTES), 'text/csv;charset=utf-8')}>Download example CSV</button><button onClick={resetDemo}>Reset demo</button></div><p className="file-limits">2 columns · up to 6 routes / 500 trips · 100 KB max<br />Whole minutes, 1–360. Quoted route names are supported.</p>{!isDemo ? <p className="loaded-file">Loaded: {filename}. Reloading clears your data.</p> : null}{importError ? <p role="alert" className="inline-error">{importError}</p> : null}</div>
        <div className="method-section" id="how-it-works"><p className="eyebrow">A SIMPLE IDEA, OPENLY EXPLAINED</p><h2>Plan for the days<br />between the best and worst.</h2><ol className="method-steps"><li><span>01</span><div><h3>Look at the whole history</h3><p>Sort the door-to-door trip times for each route, including the slow ones.</p></div></li><li><span>02</span><div><h3>Choose how much room you want</h3><p>At 90%, use the 18th sorted duration out of 20 trips. Add your extra buffer.</p></div></li><li><span>03</span><div><h3>Work back from your arrival</h3><p>Arrival − trip allowance − extra buffer = leave-by time. Compare routes and choose.</p></div></li></ol><div className="honesty-note"><strong>History is a starting point.</strong><p>This is an empirical comparison, not a prediction or an on-time guarantee. Small samples, changing schedules, weather and disruptions can change your trip. Check current service conditions. Demo records are invented; no live transit data or AI model is used.</p></div></div>
      </section>
      <div className="status-region" role="status" aria-live="polite">{notice}</div>
    </main>
    <footer className="site-footer page-width"><a className="footer-brand" href="#">buffer.</a><span>A little room goes a long way.</span><span>Built for NextSpark Hacks 2026</span></footer>
  </>;
}

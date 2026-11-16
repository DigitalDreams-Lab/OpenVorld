// The web demo's entry: the real app (with demo/api.ts in place of src/api.ts) plus the demo guide on top.
import { createRoot } from 'react-dom/client';
import '../src/fonts.css';
import '../src/styles.css';
import './demo.css';
import { App } from '../src/App';
import { DemoGuide } from './DemoGuide';
import { EMBED, IDS } from './engine';

if (EMBED) document.documentElement.classList.add('demo-embed');

// Open Honey Hollow straight away (the app reopens the last vorld), and never ask a visitor for notification permission.
try {
  localStorage.setItem('ov.lastVorld', IDS.vorld);
  sessionStorage.removeItem('ov.atTitle');
  localStorage.setItem('ov.notify', JSON.stringify({ sound: true, desktop: false }));
} catch { /* storage unavailable: the title screen lists Honey Hollow */ }

createRoot(document.getElementById('root')!).render(<><App /><DemoGuide /></>);

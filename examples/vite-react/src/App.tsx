/**
 * A plausible SaaS dashboard, and the reason it is not a bare page: the
 * element picker only ever broke against a FIXED sidebar and a STICKY header,
 * and `e2e/picker-highlight.mjs` reads its pixels here.
 */
import { useState } from 'react';
import { FeedbackWidget } from '@aitofy/bugdeck';

const NAV = ['Overview', 'Reports', 'Segments', 'Campaigns', 'Billing', 'Settings'];

const METRICS = [
  { label: 'Active workspaces', value: '1,284', delta: '+12.4%' },
  { label: 'Events this week', value: '38.2M', delta: '+3.1%' },
  { label: 'Error rate', value: '0.42%', delta: '-0.08pt' },
];

const ACTIVITY = [
  ['Checkout retries spiking in EU-West', 'Priya Raman', 'Investigating'],
  ['Webhook delivery latency > 2s', 'Tom Bauer', 'Open'],
  ['CSV export truncates at 10k rows', 'Ana Lopes', 'In review'],
  ['SSO login loop on Safari 18', 'Karim Haddad', 'Open'],
  ['Duplicate invoices for annual plans', 'Mei Sato', 'Done'],
  ['Dashboard cards flicker on refresh', 'Lars Vogel', 'Open'],
  ['Timezone off by one on scheduled digests', 'Jonas Weber', 'Investigating'],
];

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  return (
    <div className="shell" data-theme={theme}>
      {/* First in the DOM on purpose: the pixel test takes the first button on
          the page to be the launcher. */}
      <FeedbackWidget apiBase="http://localhost:3131" theme={theme} />

      <aside className="side">
        <div className="brand">
          <span className="brand-mark">N</span>Northwind
        </div>
        <nav className="nav">
          {NAV.map((item, index) => (
            <a key={item} className={index === 1 ? 'nav-item nav-item--on' : 'nav-item'} href="#">
              {item}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <span className="avatar">AL</span>
          <span>
            Ana Lopes
            <em>Workspace admin</em>
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="head">
          <h1 className="head-title">Reports</h1>
          <div className="head-actions">
            <span className="search">Search reports…</span>
            <button type="button" className="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? 'Dark' : 'Light'} mode
            </button>
            <span className="avatar">AL</span>
          </div>
        </header>

        <div className="content">
          <section className="cards">
            {METRICS.map((metric) => (
              <article key={metric.label} className="card">
                <p className="card-label">{metric.label}</p>
                <p className="card-value">{metric.value}</p>
                <p className="card-delta">{metric.delta} vs last week</p>
              </article>
            ))}
          </section>

          <section className="panel">
            <h2 className="panel-title">Recent activity</h2>
            <table className="table">
              <tbody>
                {ACTIVITY.map(([title, who, state]) => (
                  <tr key={title}>
                    <td>{title}</td>
                    <td className="muted">{who}</td>
                    <td>
                      <span className="pill">{state}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </div>
  );
}

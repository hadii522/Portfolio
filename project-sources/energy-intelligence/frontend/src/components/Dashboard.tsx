'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Moon,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  TriangleAlert,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { api, dateTime, number, write } from '@/lib/api';
import type {
  EngineeringIssue,
  Forecast,
  Health,
  Job,
  JobKind,
  ModelRun,
  Overview,
  Quality,
  Report,
  Research,
  Series,
  Settings,
  Weather,
} from '@/lib/types';
import { GenerationChart, MarketChart, PriceHeatmap, ScatterPlot, TestChart, WeatherChart } from './Charts';

const NAV: { id: string; label: string; icon: LucideIcon; href: string; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, href: '/' },
  { id: 'market', label: 'Market explorer', icon: Activity, href: '/market' },
  { id: 'forecasts', label: 'Forecast laboratory', icon: FlaskConical, href: '/forecasts' },
  { id: 'research', label: 'Research & signals', icon: Wind, href: '/research' },
  { id: 'reports', label: 'Intelligence briefs', icon: FileText, href: '/reports' },
  { id: 'operations', label: 'Data & operations', icon: Database, href: '/operations', group: 'WORKSPACE' },
  { id: 'settings', label: 'Sources & settings', icon: Settings2, href: '/settings' },
];
const DESCRIPTIONS: Record<string, string> = {
  overview: 'A clear view of the system. An informed view of what comes next.',
  market: 'Explore published fundamentals, settlement prices and source vintages.',
  forecasts: 'Forecasts you can inspect. Performance you can reproduce.',
  research: 'Investigate relationships, unusual periods and the limits of the evidence.',
  reports: 'Market context, grounded in the observations behind it.',
  operations: 'Trace every update. Inspect every gap. Keep the system accountable.',
  settings: 'Your data connections, local automation and research environment.',
};
type Submit = (kind: JobKind, options?: { days?: number; use_llm?: boolean }) => void;

export default function Dashboard({ section }: { section: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace section={section} />
    </QueryClientProvider>
  );
}

function subscribeTheme(callback: () => void) {
  window.addEventListener('etip-theme', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('etip-theme', callback);
    window.removeEventListener('storage', callback);
  };
}
function readTheme() {
  return window.localStorage.getItem('etip-theme') === 'light';
}

function Workspace({ section }: { section: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useRef<HTMLDialogElement>(null);
  const [searchText, setSearchText] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const light = useSyncExternalStore(subscribeTheme, readTheme, () => false);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  }, [light]);
  const [clock, setClock] = useState('UTC');
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState('demand');
  const [toast, setToast] = useState('');
  const [forecastView, setForecastView] = useState<'future' | 'test'>('future');
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 10000,
  });
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/overview'),
    refetchInterval: 20000,
  });
  const series = useQuery({
    queryKey: ['series', metric, days],
    queryFn: () => api<Series>(`/series?metric=${metric}&days=${days}`),
    refetchInterval: 30000,
  });
  const forecast = useQuery({
    queryKey: ['forecast'],
    queryFn: () => api<Forecast>('/forecasts/latest'),
    refetchInterval: 30000,
  });
  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<Job[]>('/jobs'),
    refetchInterval: 5000,
  });
  const { data: weather } = useQuery({
    queryKey: ['weather'],
    queryFn: () => api<Weather>('/weather'),
    enabled: section === 'overview' || section === 'market',
    refetchInterval: 60000,
  });
  const research = useQuery({
    queryKey: ['research', days],
    queryFn: () => api<Research>(`/research?days=${Math.max(2, Math.min(days, 90))}`),
    enabled: section === 'research' || section === 'overview',
  });
  const quality = useQuery({
    queryKey: ['quality'],
    queryFn: () => api<Quality>('/quality'),
    enabled: section === 'operations',
    refetchInterval: 15000,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const { data: issues } = useQuery({
    queryKey: ['issues'],
    queryFn: () => api<EngineeringIssue[]>('/project-log'),
    enabled: section === 'operations',
  });
  const { data: reports } = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Report[]>('/reports'),
    enabled: section === 'reports',
    refetchInterval: 15000,
  });
  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => api<ModelRun[]>('/models'),
    enabled: section === 'forecasts',
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: ({ kind, options }: { kind: JobKind; options?: { days?: number; use_llm?: boolean } }) =>
      write<{ id: string; deduplicated: boolean }>('/jobs', { kind, ...options }),
    onSuccess: (r) => {
      setToast(
        r.deduplicated
          ? 'This operation is already queued or running.'
          : 'Operation queued. Progress is available in Data & operations.',
      );
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => setToast(e.message),
  });
  const submit: Submit = (kind, options) => mutation.mutate({ kind, options });
  useEffect(() => {
    const timer = setInterval(
      () => setClock(new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC'),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        search.current?.showModal();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  const activeJobs = (jobs?.filter((j) => j.status === 'running' || j.status === 'queued') || []).sort(
    (a, b) =>
      (a.status === 'running' ? -1 : 0) - (b.status === 'running' ? -1 : 0) ||
      a.created_at.localeCompare(b.created_at),
  );
  const nav = NAV.find((n) => n.id === section)!;
  const refresh = () => {
    void queryClient.invalidateQueries();
    setToast('Refreshing the stored data views. Use Sync sources to fetch new observations.');
  };
  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            ETIP<span className="brand-dot">.</span>
            <small>ENERGY INTELLIGENCE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">E</span>
          <span>
            Energy research workspace<small>Local environment</small>
          </span>
          <span className="local-pill">LOCAL</span>
        </div>
        <p className="nav-label">INTELLIGENCE</p>
        <nav aria-label="Main navigation">
          {NAV.map((item) => (
            <div key={item.id}>
              {item.group && <p className="nav-label workspace-group">{item.group}</p>}
              <Link
                href={item.href}
                className={`nav-item ${section === item.id ? 'active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setMobileNav(false)}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {section === item.id && <i />}
              </Link>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-card">
            <span className={`status-dot ${health?.worker === 'running' ? 'online' : ''}`} />
            <div>
              <strong>{health?.worker === 'running' ? 'Pipeline connected' : 'Pipeline offline'}</strong>
              <small>{health?.database === 'connected' ? 'PostgreSQL connected' : 'Checking database'}</small>
            </div>
            <Activity size={15} />
          </div>
          <div className="sidebar-footer">
            <span className="user-avatar">ER</span>
            <span>
              Independent research<small>GB power markets</small>
            </span>
            <button
              className="icon-button"
              aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
              onClick={() => {
                window.localStorage.setItem('etip-theme', light ? 'dark' : 'light');
                window.dispatchEvent(new Event('etip-theme'));
                document.documentElement.dataset.theme = light ? 'dark' : 'light';
              }}
            >
              {light ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{nav.label}</strong>
          </div>
          <div className="topbar-right">
            <button className="search-button" onClick={() => search.current?.showModal()}>
              <Search size={14} />
              <span>Jump to a view</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="clock">
              <Clock3 size={13} />
              {clock}
            </span>
            <span className="connection-pill">
              <i className={health?.database === 'connected' ? 'online' : ''} />
              {health?.database === 'connected' ? 'System connected' : 'Connecting'}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="flag-gb">GB</span>GREAT BRITAIN <span>/</span> POWER MARKETS
              </div>
              <h1>{section === 'overview' ? 'Market overview' : nav.label}</h1>
              <p>{DESCRIPTIONS[section]}</p>
            </div>
            <div className="heading-actions">
              <button className="button ghost" onClick={refresh} aria-label="Refresh views">
                <RefreshCw size={15} />
                <span>Refresh</span>
              </button>
              <details className="action-menu">
                <summary className="button primary">
                  <Zap size={15} />
                  Run operation
                  <ChevronDown size={14} />
                </summary>
                <div className="action-menu-popover">
                  {(
                    [
                      { kind: 'sync', label: 'Sync sources', description: 'Fetch recent market data' },
                      { kind: 'backfill', label: 'Backfill history', description: 'Load 120 days of demand' },
                      {
                        kind: 'weather_history',
                        label: 'Archive weather runs',
                        description: 'Retrieve 120 forecast vintages',
                      },
                      {
                        kind: 'forecast',
                        label: 'Evaluate & forecast',
                        description: 'Train, test and publish a curve',
                      },
                      {
                        kind: 'report',
                        label: 'Generate market brief',
                        description: 'Build a verified evidence report',
                      },
                      {
                        kind: 'backup',
                        label: 'Back up database',
                        description: 'Write a local PostgreSQL dump',
                      },
                    ] as { kind: JobKind; label: string; description: string }[]
                  ).map((item) => (
                    <button
                      key={item.kind}
                      onClick={(e) => {
                        submit(item.kind, { days: 120 });
                        e.currentTarget.closest('details')?.removeAttribute('open');
                      }}
                    >
                      <Play size={13} />
                      <span>
                        {item.label}
                        <small>{item.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <div className="market-toolbar">
            <div className="market-selector">
              <Globe2 size={15} />
              <strong>Great Britain</strong>
              <span>GB</span>
              <ShieldCheck size={14} />
            </div>
            <div className="toolbar-divider" />
            <span className="source-label">
              <i />
              REAL SOURCE DATA
            </span>
            <div className="range-controls" aria-label="Date range">
              {[2, 7, 14, 30, 90].map((n) => (
                <button
                  key={n}
                  className={days === n ? 'selected' : ''}
                  onClick={() => setDays(n)}
                  aria-pressed={days === n}
                >
                  {n === 2 ? '48H' : `${n}D`}
                </button>
              ))}
            </div>
            <a
              className="icon-button export-button"
              title="Export selected series as CSV"
              aria-label="Export data as CSV"
              href={`/api/v1/export?metric=${metric}&days=${days}`}
            >
              <Download size={16} />
            </a>
          </div>
          {overview.isError && (
            <div className="alert error" role="alert">
              <TriangleAlert size={18} />
              <span>
                Cannot reach the API. Start the local services with <code>npm start</code>, then refresh.{' '}
                {overview.error.message}
              </span>
              <button className="button ghost" onClick={refresh}>
                Retry
              </button>
            </div>
          )}
          {activeJobs.length > 0 && (
            <div className="pipeline-banner">
              <LoaderCircle size={15} className="spin" />
              <span>
                <strong>
                  {activeJobs[0].kind.replaceAll('_', ' ')}{' '}
                  {activeJobs[0].status === 'queued' ? 'queued' : 'in progress'}
                </strong>
                <span>{activeJobs[0].message}</span>
              </span>
              <div className="mini-progress">
                <i style={{ width: `${activeJobs[0].progress}%` }} />
              </div>
              <Link href="/operations">
                View pipeline
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
          {section === 'overview' && (
            <OverviewPage
              overview={overview.data}
              series={series.data}
              forecast={forecast.data}
              weather={weather}
              research={research.data}
              days={days}
              submit={submit}
              loading={overview.isLoading}
            />
          )}
          {section === 'market' && (
            <>
              <div className="section-tabs">
                {[
                  { key: 'demand', label: 'National demand' },
                  { key: 'transmission_demand', label: 'Transmission demand' },
                  { key: 'imbalance_price', label: 'Imbalance price' },
                  { key: 'net_imbalance', label: 'Net imbalance volume' },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setMetric(item.key)}
                    className={metric === item.key ? 'selected' : ''}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <Panel
                title={metric.replaceAll('_', ' ')}
                kicker={`${days} DAY EXPLORER`}
                action={<span className="tag">{series.data?.unit || 'MW'} · UTC</span>}
              >
                <MarketChart
                  series={series.data}
                  forecast={forecast.data}
                  showForecast={metric === 'demand'}
                />
              </Panel>
              <div className="two-column">
                <Panel title="Published generation mix" kicker="COMMON SETTLEMENT PERIOD">
                  <GenerationChart data={overview.data?.generation || []} />
                  <Footnote>{dateTime(overview.data?.generation_time)}</Footnote>
                </Panel>
                <Panel title="Weather outlook" kicker="NEXT 48 HOURS">
                  <WeatherChart data={weather} />
                </Panel>
              </div>
              <Panel title="Observation ledger" kicker="SOURCE PROVENANCE">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Observation (UTC)</th>
                        <th>Value</th>
                        <th>Published (UTC)</th>
                        <th>Availability basis</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.data?.points
                        .slice(-24)
                        .reverse()
                        .map((p) => (
                          <tr key={p.time}>
                            <td>{dateTime(p.time)}</td>
                            <td className="numeric">
                              {number(p.value, 2)} <small>{p.unit}</small>
                            </td>
                            <td>{dateTime(p.published_at)}</td>
                            <td>
                              <span className="tag">{p.quality}</span>
                            </td>
                            <td>
                              <a
                                href={`/api/v1/archive?path=${encodeURIComponent(p.archive)}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Inspect the archived provider response"
                              >
                                {p.source} ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!series.data?.points.length && (
                    <Empty
                      title="No observations in this range"
                      text="Run a backfill or choose a shorter, more recent window."
                    />
                  )}
                </div>
              </Panel>
            </>
          )}
          {section === 'forecasts' && (
            <ForecastPage
              forecast={forecast.data}
              series={series.data}
              models={models}
              view={forecastView}
              setView={setForecastView}
              submit={submit}
            />
          )}
          {section === 'research' && <ResearchPage data={research.data} days={days} />}
          {section === 'reports' && <ReportsPage reports={reports} settings={settings} submit={submit} />}
          {section === 'operations' && (
            <OperationsPage quality={quality.data} jobs={jobs || []} issues={issues || []} submit={submit} />
          )}
          {section === 'settings' && (
            <SettingsPage
              settings={settings}
              onSave={async (enabled, interval_minutes) => {
                try {
                  await write('/settings/automation', { enabled, interval_minutes }, 'PUT');
                  void queryClient.invalidateQueries({ queryKey: ['settings'] });
                  setToast('Automation settings saved.');
                } catch (e) {
                  setToast(e instanceof Error ? e.message : 'Settings could not be saved.');
                }
              }}
            />
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={12} />
              Published sources. Explicit uncertainty. Reproducible research.
            </span>
            <span>
              ETIP / LOCAL WORKSPACE <i /> All times UTC unless labelled
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Activity size={17} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <dialog className="command-dialog" ref={search}>
        <div className="command-search">
          <Search size={19} />
          <input
            aria-label="Search workspace views"
            placeholder="Where would you like to go?"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            autoFocus
          />
          <button className="icon-button" onClick={() => search.current?.close()} aria-label="Close search">
            <X size={17} />
          </button>
        </div>
        <p className="nav-label">WORKSPACE VIEWS</p>
        {NAV.filter((n) => n.label.toLowerCase().includes(searchText.toLowerCase())).map((n) => (
          <button
            className="command-result"
            key={n.id}
            onClick={() => {
              search.current?.close();
              router.push(n.href);
            }}
          >
            <n.icon size={17} />
            {n.label}
            <ArrowRight size={15} />
          </button>
        ))}
        {!NAV.some((n) => n.label.toLowerCase().includes(searchText.toLowerCase())) && (
          <p className="small-empty">No matching workspace view.</p>
        )}
      </dialog>
    </div>
  );
}

function Panel({
  title,
  kicker,
  action,
  children,
  className = '',
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          {kicker && <span className="panel-kicker">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Footnote({ children }: { children: ReactNode }) {
  return <p className="panel-footnote">{children}</p>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Database size={22} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={`status-badge ${['complete', 'success', 'fresh', 'resolved', 'running', 'verified'].includes(value) ? 'good' : ['failed', 'stale', 'interrupted'].includes(value) ? 'bad' : 'neutral'}`}
    >
      <i />
      {value.replaceAll('_', ' ')}
    </span>
  );
}

function OverviewPage({
  overview,
  series,
  forecast,
  weather,
  research,
  days,
  submit,
  loading,
}: {
  overview?: Overview;
  series?: Series;
  forecast?: Forecast;
  weather?: Weather;
  research?: Research;
  days: number;
  submit: Submit;
  loading: boolean;
}) {
  const peak = forecast?.points.length ? Math.max(...forecast.points.map((p) => p.value)) : null;
  const forecastsExpired = forecast?.points.length
    ? new Date(forecast.points[forecast.points.length - 1].time) < new Date()
    : false;
  return (
    <>
      <div className="kpi-grid">
        {(
          overview?.summaries || [
            {
              metric: 'demand',
              label: 'National demand',
              unit: 'MW',
              value: null,
              time: null,
              change: null,
              status: 'missing',
              definition: '',
            },
            {
              metric: 'imbalance_price',
              label: 'System imbalance price',
              unit: 'GBP/MWh',
              value: null,
              time: null,
              change: null,
              status: 'missing',
              definition: '',
            },
            {
              metric: 'net_imbalance',
              label: 'Net imbalance volume',
              unit: 'MWh',
              value: null,
              time: null,
              change: null,
              status: 'missing',
              definition: '',
            },
          ]
        ).map((item, i) => (
          <article className="kpi-card" key={item.metric}>
            <div className="kpi-top">
              <span>{item.label}</span>
              {i === 0 ? <Activity size={15} /> : i === 1 ? <Zap size={15} /> : <Wind size={15} />}
            </div>
            <div className="kpi-value">
              {loading ? (
                <span className="skeleton-number" />
              ) : (
                <>
                  {item.metric === 'imbalance_price' && item.value != null ? (
                    <span className="currency">£</span>
                  ) : null}
                  {number(item.value, item.metric === 'imbalance_price' ? 2 : 0)}
                </>
              )}
              <span>{item.unit === 'GBP/MWh' ? '/MWh' : item.unit}</span>
            </div>
            <div className="kpi-detail">
              {item.change != null ? (
                <span className={item.change >= 0 ? 'change positive' : 'change negative'}>
                  {item.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{' '}
                  {item.change >= 0 ? '+' : ''}
                  {number(item.change, item.metric === 'imbalance_price' ? 2 : 0)}{' '}
                  <small>vs same period yesterday</small>
                </span>
              ) : (
                <span>Awaiting comparable observations</span>
              )}
            </div>
            <div className="kpi-bottom">
              <span className={`tiny-dot ${item.status === 'fresh' ? 'lime' : ''}`} />
              {item.time ? dateTime(item.time) : 'No stored data'}
              <span>{item.status === 'fresh' ? 'Published' : item.status}</span>
            </div>
          </article>
        ))}
        <article className="kpi-card forecast-kpi">
          <div className="kpi-top">
            <span>Forecast demand peak</span>
            <FlaskConical size={15} />
          </div>
          <div className="kpi-value">
            {number(peak, 0)}
            <span>MW</span>
          </div>
          <div className="kpi-detail">
            <span className="cyan-text">{forecast?.model || 'Evaluation not yet run'}</span>
          </div>
          <div className="kpi-bottom">
            <span className="tiny-dot cyan" />
            {forecastsExpired ? 'Forecast window elapsed' : 'Next forecast window'}
            <span>24H</span>
          </div>
        </article>
      </div>
      <div className="overview-main-grid">
        <Panel
          title="Demand & forecast"
          kicker="SYSTEM FUNDAMENTALS"
          action={
            <Link className="text-link" href="/forecasts">
              Open laboratory
              <ArrowUpRight size={14} />
            </Link>
          }
        >
          <div className="chart-subtitle">
            <span>National demand</span>
            <span>MW · {days} days of published history</span>
          </div>
          <MarketChart series={series} forecast={forecast} />
          <Footnote>
            <span className="tiny-dot lime" />
            Elexon INDO actuals ·{' '}
            {forecast?.available
              ? 'Independent residual calibration; bands may under-cover during regime changes.'
              : 'Forecasts appear after a successful evaluation run.'}
          </Footnote>
        </Panel>
        <Panel title="Generation mix" kicker="SUPPLY SNAPSHOT" action={<span className="tag">GB</span>}>
          <GenerationChart data={overview?.generation || []} />
          <Footnote>{dateTime(overview?.generation_time)} · common settlement period</Footnote>
          <Link className="panel-bottom-link" href="/market">
            Explore market data
            <ArrowRight size={14} />
          </Link>
        </Panel>
      </div>
      <div className="two-column">
        <Panel
          title="Weather outlook"
          kicker="FUNDAMENTAL DRIVERS"
          action={<Wind size={17} className="muted" />}
        >
          <WeatherChart data={weather} />
        </Panel>
        <Panel
          title="Research watch"
          kicker="UNUSUAL MARKET PERIODS"
          action={
            <Link href="/research" className="text-link">
              Investigate
              <ArrowUpRight size={14} />
            </Link>
          }
        >
          {research?.anomalies.length ? (
            <div className="watch-list">
              {research.anomalies.slice(0, 4).map((a) => (
                <div className="watch-item" key={a.time}>
                  <span className="watch-icon">
                    <Zap size={16} />
                  </span>
                  <span>
                    <strong>Imbalance price deviation</strong>
                    <small>{dateTime(a.time)}</small>
                  </span>
                  <span className="watch-value">
                    £{number(a.value, 2)}
                    <small>{number(a.score, 1)} robust score</small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <ShieldCheck size={24} />
              <p>
                {research?.paired_periods
                  ? 'No price observations exceed the trailing anomaly threshold.'
                  : 'Research begins when matching demand and price observations are stored.'}
              </p>
            </div>
          )}
          <Footnote>Trailing median/MAD · observations remain unchanged</Footnote>
        </Panel>
      </div>
      {!overview?.inventory.length && !loading && (
        <div className="getting-started">
          <div>
            <h3>Connect your research to the real system.</h3>
            <p>
              Load historical Elexon demand, recent prices and generation, then archive weather and evaluate
              your models.
            </p>
          </div>
          <button className="button primary" onClick={() => submit('backfill', { days: 120 })}>
            Backfill real history
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </>
  );
}

function ForecastPage({
  forecast,
  series,
  models,
  view,
  setView,
  submit,
}: {
  forecast?: Forecast;
  series?: Series;
  models?: ModelRun[];
  view: 'future' | 'test';
  setView: (v: 'future' | 'test') => void;
  submit: Submit;
}) {
  const metadata = forecast?.metadata;
  const score = metadata?.test_scores[forecast?.model || ''];
  return (
    <>
      <div className="info-banner">
        <ShieldCheck size={18} />
        <span>
          Champion selected on an earlier validation window. The final seven-day test is held out from model
          selection.
        </span>
        <button className="button ghost" onClick={() => submit('forecast')}>
          Evaluate & forecast
          <Play size={13} />
        </button>
      </div>
      <div className="research-stat-grid">
        <MiniStat
          label="Selected model"
          value={forecast?.model || 'Not evaluated'}
          detail={metadata?.selection_metric || 'Selection precedes test evaluation'}
        />
        <MiniStat label="Held-out RMSE" value={number(score?.rmse, 1)} detail="MW · seven daily origins" />
        <MiniStat
          label="Held-out WAPE"
          value={score?.wape != null ? number(score.wape, 2) + '%' : '—'}
          detail="Absolute error / absolute demand"
        />
        <MiniStat
          label="Observed band coverage"
          value={score?.coverage != null ? number(score.coverage, 1) + '%' : '—'}
          detail="Nominal calibration target: 90%"
        />
      </div>
      <Panel
        title={view === 'future' ? 'Operational demand forecast' : 'Held-out historical predictions'}
        kicker={view === 'future' ? 'NEXT 24 HOURS' : 'WALK-FORWARD EVALUATION'}
        action={
          <div className="segmented">
            <button className={view === 'future' ? 'selected' : ''} onClick={() => setView('future')}>
              Forecast
            </button>
            <button className={view === 'test' ? 'selected' : ''} onClick={() => setView('test')}>
              Backtest
            </button>
          </div>
        }
      >
        {view === 'future' ? (
          <MarketChart series={series} forecast={forecast} />
        ) : (
          <TestChart forecast={forecast || { available: false, points: [] }} />
        )}
        <Footnote>
          Forecast origin: {dateTime(forecast?.cutoff)} · demand actuals are scored after publication.
        </Footnote>
      </Panel>
      <Panel
        title="Model comparison"
        kicker="BASELINES COME FIRST"
        action={<span className="tag">Same evaluation periods</span>}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Validation RMSE</th>
                <th>Test RMSE</th>
                <th>Test MAE</th>
                <th>Test WAPE</th>
                <th>Band coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metadata?.test_scores || {}).map(([name, s]) => (
                <tr key={name} className={name === forecast?.model ? 'champion-row' : ''}>
                  <td>
                    <strong>{name}</strong>
                    {name === forecast?.model && (
                      <span className="champion-tag">
                        <Check size={11} />
                        Champion
                      </span>
                    )}
                  </td>
                  <td className="numeric">{number(metadata?.selection_scores[name]?.rmse, 1)} MW</td>
                  <td className="numeric">{number(s.rmse, 1)} MW</td>
                  <td className="numeric">{number(s.mae, 1)} MW</td>
                  <td className="numeric">{number(s.wape, 2)}%</td>
                  <td className="numeric">{number(s.coverage, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!metadata && (
            <Empty
              title="Evaluation is waiting for history"
              text={forecast?.reason || 'Backfill at least sixty days, then run evaluation.'}
              action={
                <button className="button primary" onClick={() => submit('backfill', { days: 120 })}>
                  Load real history
                </button>
              }
            />
          )}
        </div>
      </Panel>
      <div className="two-column">
        <Panel title="Research protocol" kicker="MODEL CARD">
          <dl className="definition-list">
            <div>
              <dt>Target</dt>
              <dd>GB Initial National Demand Outturn · MW</dd>
            </div>
            <div>
              <dt>Horizon</dt>
              <dd>48 settlement periods · direct prediction</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{metadata ? dateTime(metadata.validation_start) : 'Separate chronological window'}</dd>
            </div>
            <div>
              <dt>Final test</dt>
              <dd>
                {metadata
                  ? `${dateTime(metadata.test_start)} → ${dateTime(metadata.test_end)}`
                  : 'Seven held-out daily origins'}
              </dd>
            </div>
            <div>
              <dt>Weather features</dt>
              <dd>
                {metadata?.weather_enabled
                  ? 'Archived, availability-filtered forecasts'
                  : 'Not used by current champion'}
              </dd>
            </div>
            <div>
              <dt>Weather coverage</dt>
              <dd>
                {metadata
                  ? number(metadata.weather_coverage * 100, 1) + '% of training rows'
                  : 'Archived vintages required'}
              </dd>
            </div>
            <div>
              <dt>Random seed</dt>
              <dd>42 · recorded with library versions</dd>
            </div>
          </dl>
          <button
            className="button ghost full-width"
            onClick={() => submit('weather_history', { days: 120 })}
          >
            <Wind size={14} />
            Archive weather forecast history
          </button>
        </Panel>
        <Panel title="Assumptions & limitations" kicker="RESEARCH TRANSPARENCY">
          <ul className="limitations">
            {(
              metadata?.limitations || [
                'Missing inputs are never synthesized or filled from future data.',
                'Archived weather initialization is not its publication time; a conservative delay is recorded.',
                'Calibrated intervals require checking empirical coverage under changing conditions.',
              ]
            ).map((item) => (
              <li key={item}>
                <TriangleAlert size={14} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Experiment history" kicker="PERSISTED MODEL RUNS">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Champion</th>
                <th>Weather</th>
                <th>Test RMSE</th>
                <th>Input fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {models?.map((run) => (
                <tr key={run.id}>
                  <td>{dateTime(run.created_at)}</td>
                  <td>{run.model}</td>
                  <td>{run.metadata.weather_enabled ? 'Included' : 'Excluded'}</td>
                  <td>{number(run.metadata.test_scores[run.model]?.rmse, 1)} MW</td>
                  <td>
                    <code title={run.metadata.input_fingerprint}>
                      {run.metadata.input_fingerprint.slice(0, 14)}…
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!models?.length && <p className="small-empty">No completed experiments yet.</p>}
        </div>
      </Panel>
    </>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ResearchPage({ data, days }: { data?: Research; days: number }) {
  return (
    <>
      <div className="research-stat-grid">
        <MiniStat
          label="Paired observations"
          value={number(data?.paired_periods)}
          detail="Exact settlement timestamp matches"
        />
        <MiniStat
          label="Demand / price correlation"
          value={number(data?.correlation, 3)}
          detail="Pearson r · descriptive association"
        />
        <MiniStat
          label="Flagged price periods"
          value={number(data?.anomalies.length)}
          detail="Robust score ≥ 4; up to twenty shown"
        />
        <MiniStat
          label="Research window"
          value={`${Math.min(days, 90)} days`}
          detail="Latest stored data vintages"
        />
      </div>
      <div className="two-column">
        <Panel title="Demand meets imbalance price" kicker="EXPLORATORY ANALYSIS">
          <ScatterPlot research={data} />
          <Footnote>
            Each dot is a matching published settlement period. Association does not imply causation.
          </Footnote>
        </Panel>
        <Panel title="Price across the week" kicker="MEAN GBP / MWH">
          <PriceHeatmap data={data?.heatmap || []} />
          <Footnote>Hover a cell for its sample size. Empty cells are missing observations.</Footnote>
        </Panel>
      </div>
      <Panel title="Anomaly investigation" kicker="TRAILING ROBUST STATISTICS">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Settlement period</th>
                <th>Observed price</th>
                <th>Trailing median</th>
                <th>Robust score</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {data?.anomalies.map((a) => (
                <tr key={a.time}>
                  <td>{dateTime(a.time)}</td>
                  <td className="numeric">£{number(a.value, 2)}/MWh</td>
                  <td className="numeric">£{number(a.baseline, 2)}/MWh</td>
                  <td>
                    <span className="anomaly-score">{number(a.score, 1)}</span>
                  </td>
                  <td className="muted">Unusual observation · investigate source context</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.anomalies.length && (
            <p className="small-empty">No observed periods exceed the current robust anomaly threshold.</p>
          )}
        </div>
      </Panel>
      <div className="method-note">
        <BookOpen size={20} />
        <div>
          <strong>How to read this research</strong>
          {(data?.notes || []).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </div>
    </>
  );
}

function ReportsPage({
  reports,
  settings,
  submit,
}: {
  reports?: Report[];
  settings?: Settings;
  submit: Submit;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const report = reports?.find((r) => r.id === selected) || reports?.[0];
  return (
    <>
      <div className="info-banner">
        <ShieldCheck size={18} />
        <span>
          Numbers render from verified evidence. Optional LLM synthesis is checked for valid references and
          prohibited numeric claims.
        </span>
        <button className="button ghost" onClick={() => submit('report')}>
          Generate brief
          <Play size={13} />
        </button>
      </div>
      <div className="reports-grid">
        <Panel title="Briefing archive" kicker="YOUR RESEARCH RECORD">
          <div className="report-list">
            {reports?.map((r) => (
              <button
                className={report?.id === r.id ? 'selected' : ''}
                key={r.id}
                onClick={() => setSelected(r.id)}
              >
                <FileText size={18} />
                <span>
                  <strong>{r.title}</strong>
                  <small>{dateTime(r.created_at)}</small>
                  <em>{r.engine}</em>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          {!reports?.length && <p className="small-empty">Your generated briefs will appear here.</p>}
          <div className="report-actions">
            <button
              className="button ghost full-width"
              disabled={!settings?.llm_configured}
              title={
                !settings?.llm_configured ? 'Configure an LLM key locally to enable synthesis' : undefined
              }
              onClick={() => submit('report', { use_llm: true })}
            >
              Generate with LLM
              <Zap size={14} />
            </button>
            <p>
              {settings?.llm_configured
                ? 'Provider configured locally'
                : 'LLM access is not configured. Verified deterministic briefs remain available.'}
            </p>
          </div>
        </Panel>
        <Panel
          title={report?.title || 'Your next market briefing'}
          kicker={report ? 'EVIDENCE-LED INTELLIGENCE' : 'READY WHEN YOUR DATA IS'}
          action={report ? <Status value={report.payload.validation.status} /> : undefined}
        >
          {report ? (
            <article className="report-body">
              <div className="report-meta">
                <span>{dateTime(report.created_at)}</span>
                <span>{report.engine}</span>
              </div>
              <p className="report-scope">{report.payload.scope}</p>
              {report.payload.warnings.map((w) => (
                <div key={w} className="alert">
                  <TriangleAlert size={15} />
                  {w}
                </div>
              ))}
              {report.payload.paragraphs.map((paragraph, i) => (
                <section className="report-paragraph" key={i}>
                  <p>{paragraph.text}</p>
                  <div className="evidence-chips">
                    {paragraph.evidence.map((id) => {
                      const fact = report.payload.facts.find((f) => f.id === id);
                      return fact ? (
                        <span key={id} title={`${fact.source} · ${dateTime(fact.time)}`}>
                          {fact.label}
                          <strong>
                            {number(fact.value, 2)} {fact.unit}
                          </strong>
                        </span>
                      ) : null;
                    })}
                  </div>
                </section>
              ))}
              <h3>Evidence ledger</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fact</th>
                      <th>Value</th>
                      <th>Source time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payload.facts.map((f) => (
                      <tr key={f.id}>
                        <td>{f.label}</td>
                        <td className="numeric">
                          {number(f.value, 2)} {f.unit}
                        </td>
                        <td>{dateTime(f.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="trace-details">
                <summary>Inspect workflow & validation trace</summary>
                <pre>{JSON.stringify(report.payload.trace, null, 2)}</pre>
              </details>
              {report.payload.validation.qualitative_limit && (
                <Footnote>{report.payload.validation.qualitative_limit}</Footnote>
              )}
            </article>
          ) : (
            <Empty
              title="Turn observations into a traceable brief"
              text="The workflow collects evidence, checks data availability, synthesizes context and validates the result before publication."
              action={
                <button className="button primary" onClick={() => submit('report')}>
                  Generate verified brief
                  <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </Panel>
      </div>
    </>
  );
}

function OperationsPage({
  quality,
  jobs,
  issues,
  submit,
}: {
  quality?: Quality;
  jobs: Job[];
  issues: EngineeringIssue[];
  submit: Submit;
}) {
  const [tab, setTab] = useState('pipeline');
  const [filter, setFilter] = useState('all');
  const shown = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);
  return (
    <>
      <div className="research-stat-grid">
        <MiniStat
          label="Observed settlement points"
          value={number(quality?.total_observations)}
          detail="Distinct series / time combinations"
        />
        <MiniStat
          label="Stored data vintages"
          value={number(quality?.total_vintages)}
          detail="Provider revisions are preserved"
        />
        <MiniStat
          label="Weather forecast records"
          value={number(quality?.weather_vintages)}
          detail="Availability and valid times retained"
        />
        <MiniStat
          label="Engineering issues resolved"
          value={`${issues.filter((i) => i.status === 'resolved').length} / ${issues.length}`}
          detail="Problems, fixes and verification tracked"
        />
      </div>
      <div className="section-tabs">
        <button className={tab === 'pipeline' ? 'selected' : ''} onClick={() => setTab('pipeline')}>
          Pipeline & jobs
        </button>
        <button className={tab === 'quality' ? 'selected' : ''} onClick={() => setTab('quality')}>
          Data quality
        </button>
        <button className={tab === 'engineering' ? 'selected' : ''} onClick={() => setTab('engineering')}>
          Problems & improvements <span className="tab-count">{issues.length}</span>
        </button>
      </div>
      {tab === 'pipeline' && (
        <>
          <Panel
            title="Operation history"
            kicker="DURABLE JOB QUEUE"
            action={
              <select
                aria-label="Filter jobs by status"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                {['running', 'queued', 'complete', 'partial', 'failed', 'interrupted'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            }
          >
            <div className="job-list">
              {shown.map((j) => (
                <details className="job-row" key={j.id}>
                  <summary>
                    <span className={`job-icon ${j.status === 'running' ? 'working' : ''}`}>
                      {j.status === 'running' ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : j.status === 'failed' ? (
                        <TriangleAlert size={17} />
                      ) : (
                        <Database size={17} />
                      )}
                    </span>
                    <span className="job-description">
                      <strong>{j.kind.replaceAll('_', ' ')}</strong>
                      <small>{j.message}</small>
                    </span>
                    <span className="job-time">{dateTime(j.created_at)}</span>
                    <Status value={j.status} />
                    <ChevronDown size={14} />
                  </summary>
                  {j.status === 'running' && (
                    <div className="job-progress">
                      <i style={{ width: `${j.progress}%` }} />
                    </div>
                  )}
                  <div className="job-detail">
                    <p>
                      Job <code>{j.id}</code> · {j.progress}% complete
                    </p>
                    {j.result && <pre>{JSON.stringify(j.result, null, 2)}</pre>}
                    {['failed', 'interrupted', 'partial'].includes(j.status) && (
                      <button
                        className="button ghost"
                        onClick={() => submit(j.kind as JobKind, j.parameters)}
                      >
                        Retry operation
                        <RefreshCw size={13} />
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
            {!shown.length && <p className="small-empty">No operations match this filter.</p>}
          </Panel>
          <Panel title="Source ingestion events" kicker="ARCHIVE & VALIDATION TRAIL">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fetched</th>
                    <th>Source / dataset</th>
                    <th>Status</th>
                    <th>New vintages</th>
                    <th>Rejected</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {quality?.events.slice(0, 25).map((e) => (
                    <tr key={e.id}>
                      <td>{dateTime(e.time)}</td>
                      <td>
                        {e.source}
                        <small className="block">{e.dataset}</small>
                      </td>
                      <td>
                        <Status value={e.status} />
                      </td>
                      <td className="numeric">{number(e.accepted)}</td>
                      <td className="numeric">{number(e.rejected)}</td>
                      <td className="event-detail" title={e.detail}>
                        {e.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      {tab === 'quality' && (
        <Panel title="Series health" kicker="COVERAGE & FRESHNESS">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Periods</th>
                  <th>Coverage</th>
                  <th>Missing</th>
                  <th>Revisions</th>
                  <th>Latest observation</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {quality?.metrics.map((m) => (
                  <tr key={m.metric}>
                    <td>
                      <strong>{m.label}</strong>
                      <small className="block">
                        {m.source} · {m.unit}
                      </small>
                    </td>
                    <td>{number(m.points)}</td>
                    <td>
                      <div className="coverage-cell">
                        <div>
                          <i style={{ width: `${m.coverage}%` }} />
                        </div>
                        {number(m.coverage, 1)}%
                      </div>
                    </td>
                    <td>{m.missing}</td>
                    <td>{number(m.revisions)}</td>
                    <td>{dateTime(m.latest)}</td>
                    <td>
                      <Status value={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!quality?.metrics.length && (
              <Empty
                title="No stored series yet"
                text="Run a real-data backfill to begin measuring coverage and freshness."
              />
            )}
          </div>
          <Footnote>
            Coverage is measured between each series’ first and last stored timestamps. Freshness is assessed
            separately against the current time.
          </Footnote>
        </Panel>
      )}
      {tab === 'engineering' && (
        <Panel title="Engineering decision & issue register" kicker="EVERY PROBLEM HAS A RECORD">
          <div className="issue-list">
            {issues.map((issue) => (
              <details className="issue-card" key={issue.id}>
                <summary>
                  <span className="issue-id">{issue.id}</span>
                  <span>
                    <strong>{issue.title}</strong>
                    <small>
                      {issue.category} · {issue.date}
                    </small>
                  </span>
                  <Status value={issue.status} />
                  <ChevronDown size={15} />
                </summary>
                <dl>
                  <dt>Problem</dt>
                  <dd>{issue.problem}</dd>
                  <dt>Fix / improvement</dt>
                  <dd>{issue.fix}</dd>
                  <dt>Verification</dt>
                  <dd>{issue.verification}</dd>
                </dl>
              </details>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function SettingsPage({
  settings,
  onSave,
}: {
  settings?: Settings;
  onSave: (enabled: boolean, interval: 15 | 30 | 60) => Promise<void>;
}) {
  return (
    <>
      <Panel title="Connected data sources" kicker="PROVENANCE BY DESIGN">
        <div className="source-grid">
          {settings?.sources.map((source, i) => (
            <article className="source-card" key={source.name}>
              <div className="source-card-top">
                <span className="source-icon">{i === 1 ? <Wind size={21} /> : <Database size={21} />}</span>
                <span className={`tag ${i < 2 ? 'lime-tag' : ''}`}>
                  {i < 2 ? 'Configured' : 'Reference / future'}
                </span>
              </div>
              <h3>{source.name}</h3>
              <p>{source.role}</p>
              <small>{source.access}</small>
              <div className="source-card-bottom">
                <span>{source.licence}</span>
                <a
                  aria-label={`Read ${source.name} documentation`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <div className="two-column">
        <Panel title="Local automation" kicker="PERSISTED SCHEDULE">
          <div className="setting-row">
            <div>
              <strong>Automatic source updates</strong>
              <p>
                Runs while your PC and the worker are active. Missed recent periods are fetched after restart.
              </p>
            </div>
            <button
              className={`toggle ${settings?.automation.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={settings?.automation.enabled || false}
              aria-label="Automatic source updates"
              disabled={!settings}
              onClick={() =>
                void onSave(!settings!.automation.enabled, settings!.automation.interval_minutes)
              }
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Source refresh interval</strong>
              <p>Demand forecasting runs every six hours; briefs every twelve hours.</p>
            </div>
            <select
              aria-label="Source refresh interval"
              value={settings?.automation.interval_minutes || 30}
              disabled={!settings}
              onChange={(e) =>
                void onSave(settings!.automation.enabled, Number(e.target.value) as 15 | 30 | 60)
              }
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>
          <Footnote>Daily local database backups are included while automation is enabled.</Footnote>
        </Panel>
        <Panel title="Environment & model access" kicker="LOCAL FIRST">
          <dl className="definition-list">
            <div>
              <dt>Storage</dt>
              <dd>PostgreSQL + immutable raw archives</dd>
            </div>
            <div>
              <dt>Market</dt>
              <dd>Great Britain · GBP · UTC storage</dd>
            </div>
            <div>
              <dt>LLM synthesis</dt>
              <dd>
                <Status value={settings?.llm_configured ? 'configured' : 'not_configured'} />
              </dd>
            </div>
            <div>
              <dt>Data substitution</dt>
              <dd>Disabled · missing data remains missing</dd>
            </div>
            <div>
              <dt>Network exposure</dt>
              <dd>Loopback interfaces only</dd>
            </div>
          </dl>
          <p className="settings-note">
            Optional LLM credentials are loaded locally. Keys are never returned to this browser. Provider
            access and commercial licensing remain explicit.
          </p>
        </Panel>
      </div>
      <div className="method-note">
        <BookOpen size={20} />
        <div>
          <strong>Attribution & scope</strong>
          <p>
            Contains BMRS data © Elexon Limited, copyright and database right. Weather data provided by
            Open-Meteo and its underlying model providers under CC BY 4.0. Review provider terms before
            commercial redistribution.
          </p>
          <p>
            This application currently connects Elexon and Open-Meteo. NESO and ENTSO-E are documented
            expansion sources; their data is not presented as connected.
          </p>
        </div>
      </div>
    </>
  );
}

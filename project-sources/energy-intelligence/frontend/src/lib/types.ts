export type Health = { database: string; worker: string; time: string; version: string };
export type MetricPoint = {
  time: string;
  value: number;
  unit: string;
  source: string;
  published_at: string;
  fetched_at: string;
  archive: string;
  quality: string;
};
export type Series = {
  metric: string;
  unit: string;
  points: MetricPoint[];
  count: number;
  start: string;
  end: string;
};
export type Summary = {
  metric: string;
  label: string;
  unit: string;
  value: number | null;
  time: string | null;
  change: number | null;
  status: string;
  definition: string;
};
export type Inventory = {
  metric: string;
  label: string;
  source: string;
  unit: string;
  first: string;
  latest: string;
  last_fetch: string;
  points: number;
  vintages: number;
};
export type Job = {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat: string | null;
  progress: number;
  message: string;
  parameters: { days?: number; use_llm?: boolean };
  result: Record<string, unknown> | null;
};
export type Overview = {
  as_of: string;
  market: string;
  summaries: Summary[];
  generation: { name: string; metric: string; value: number; time: string }[];
  generation_time: string | null;
  inventory: Inventory[];
  active_jobs: Job[];
  data_mode: string;
};
export type Scores = {
  n: number;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  bias: number | null;
  coverage: number | null;
};
export type TestPoint = {
  time: string;
  origin: string;
  actual: number;
  predicted: number;
  lower: number;
  upper: number;
};
export type ModelMetadata = {
  target: string;
  unit: string;
  horizon_hours: number;
  selection_metric: string;
  validation_start: string;
  test_start: string;
  test_end: string;
  selection_scores: Record<string, Scores>;
  test_scores: Record<string, Scores>;
  test_points: Record<string, TestPoint[]>;
  folds: {
    origin: string;
    test_rows: number;
    training_rows: number;
    calibration_rows: number;
    train_end: string;
    calibration_start: string;
  }[];
  features: string[];
  weather_coverage: number;
  weather_enabled: boolean;
  interval_nominal_coverage: number;
  interval_method: string;
  data_start: string;
  data_end: string;
  input_fingerprint: string;
  random_seed: number;
  versions: Record<string, string>;
  limitations: string[];
};
export type Forecast = {
  available: boolean;
  reason?: string;
  id?: string;
  model?: string;
  created_at?: string;
  cutoff?: string;
  metadata?: ModelMetadata;
  points: {
    time: string;
    value: number;
    lower: number;
    upper: number;
    baseline: number | null;
    actual: number | null;
  }[];
};
export type ModelRun = {
  id: string;
  created_at: string;
  cutoff: string;
  model: string;
  status: string;
  metadata: ModelMetadata;
};
export type Weather = {
  locations: string[];
  aggregation: string;
  points: {
    location: string;
    valid_time: string;
    available_at: string;
    temperature: number;
    wind_speed: number;
    radiation: number;
    basis: string;
  }[];
};
export type Research = {
  pairs: { time: string; demand: number; price: number }[];
  correlation: number | null;
  paired_periods: number;
  heatmap: { weekday: number; hour: number; mean: number; n: number }[];
  anomalies: { time: string; value: number; metric: string; score: number; baseline: number; unit: string }[];
  days: number;
  notes: string[];
};
export type Quality = {
  metrics: (Inventory & {
    expected: number;
    missing: number;
    coverage: number;
    age_minutes: number;
    status: string;
    revisions: number;
  })[];
  events: {
    id: string;
    job_id: string;
    source: string;
    dataset: string;
    time: string;
    status: string;
    accepted: number;
    rejected: number;
    detail: string;
    archive: string | null;
  }[];
  weather_vintages: number;
  total_observations: number;
  total_vintages: number;
  as_of: string;
  policy: string;
};
export type Fact = {
  id: string;
  label: string;
  value: number;
  unit: string;
  time: string;
  source: string;
  source_url: string | null;
  archive: string;
  window: string;
};
export type Report = {
  id: string;
  created_at: string;
  title: string;
  engine: string;
  status: string;
  payload: {
    facts: Fact[];
    paragraphs: { text: string; evidence: string[] }[];
    warnings: string[];
    trace: Record<string, unknown>[];
    as_of: string;
    validation: { status: string; errors: string[]; qualitative_limit?: string };
    prompt_version: string;
    scope: string;
  };
};
export type Settings = {
  automation: { enabled: boolean; interval_minutes: 15 | 30 | 60 };
  llm_configured: boolean;
  storage: string;
  market: string;
  synthetic_data: boolean;
  sources: { name: string; role: string; access: string; url: string; licence: string }[];
};
export type EngineeringIssue = {
  id: string;
  category: string;
  title: string;
  status: string;
  problem: string;
  fix: string;
  verification: string;
  date: string;
};
export type JobKind = 'sync' | 'backfill' | 'forecast' | 'weather_history' | 'report' | 'backup';

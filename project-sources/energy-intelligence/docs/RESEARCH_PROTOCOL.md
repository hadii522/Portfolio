# Forecasting and research protocol

## Question and target

Predict the next 24 hours of GB Initial National Demand Outturn and test whether archived weather improves otherwise comparable models. Explain performance with measured baselines and error analysis. Price/demand relationships are descriptive research; a demand forecast alone does not establish a profitable trading strategy.

## Dataset and availability

Elexon INDO is the demand target. ITSDO is stored separately. Settlement timestamps are not silently floored and missing periods are not interpolated. Negative imbalance prices are retained. Raw JSON, checksums, provider publication timestamps and first local retrieval timestamps persist for audit.

Weather is sampled at six named cities. Live forecasts become eligible at actual retrieval time. Archived ECMWF runs become eligible at run initialization plus eight hours; that is an explicit conservative assumption, not a verified historical publication timestamp. Never use retrospective observed weather or a newly fetched composite as though it were a historical day-ahead forecast.

## Features

- Demand lags at 24h, 48h and seven days, checked against the origin and provider publication times.
- Mean and standard deviation of the preceding known day, requiring substantial observed coverage.
- Cyclic hour, weekday and annual features plus weekend flag, calculated in Europe/London.
- Optional temperature, wind speed and radiation from the latest eligible forecast per location and valid time. All six locations are required. Hourly forecast values are associated with their corresponding half-hour periods; unknown weather is never imputed.

## Experimental design

At least sixty days are required; initial backfill requests 120 days. Each daily evaluation origin predicts 48 UTC settlement periods. Scale transformations fit only on the training portion. HistGradientBoosting disables its random internal early-stopping split. The random seed is fixed and library versions are recorded.

Before each origin, train on eligible earlier samples and reserve the trailing seven days for absolute-residual calibration. At least 28 training days and five substantially complete calibration days are required. Model selection uses seven days before the final test. The winner is frozen by validation RMSE before the final seven daily test origins.

Within the final test, refitting may use observations from earlier test days only after their publication, as an operational forecasting process would. This is an expanding prequential evaluation, not a frozen-estimator test. The test does not choose the model family.

Weather and non-weather versions use identical model hyperparameters. Weather candidates enter only with complete feature coverage. Compare each weather model with its non-weather counterpart as well as with the seasonal baseline. A weather feature is not presumed useful merely because it is available.

## Metrics and uncertainty

RMSE and MAE use MW. WAPE is sum absolute error divided by sum absolute actual demand, and is null at zero denominator. Bias is prediction minus actual. Every table records sample size. Nominal 90% bounds use a finite-sample corrected upper residual quantile from separate calibration data. Empirical test coverage is reported. Serial correlation, changing demand regimes and limited samples mean nominal coverage is not guaranteed.

## Reproducibility and limitations

Each model run persists an input-pool fingerprint, the exact sample matrix, future feature matrix, trained artifact, feature columns, cutoff, score tables, fold boundaries, library versions and seed. Joblib artifacts are trusted local files and must never be loaded from an untrusted sender.

Historical providers can omit older revisions. Using publication-filtered available vintages mitigates hindsight but cannot reconstruct unavailable historical snapshots. As-recorded replay becomes rigorous only after local data collection begins. The current training window covers a limited set of seasons and holidays. Further evaluation should include longer history, multiple regimes, horizon-specific errors, sensitivity analysis and independently reviewed availability assumptions before any commercial reliance.

## Reports

The brief workflow collects persisted evidence, gates on availability, synthesizes context and validates output. Deterministic briefs perform transparent comparisons. Optional LLM paragraphs must reference existing evidence IDs and cannot introduce digits; numbers render from structured source facts. This checks numeric grounding and references, not causal truth or all possible qualitative hallucinations. Model-generated interpretation is labelled and cannot be promoted to verified causality.

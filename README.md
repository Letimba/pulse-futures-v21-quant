# PULSE Futures V2.1 Quant

V2.1 is the baseline. This repo adds **counterfactual signal tracking** and a first **historical calibration layer** without replacing the original V2.1 signal engine.

## Run

```bash
npm start
```

Open:

`http://127.0.0.1:8787`

## What was added

### Signal tracking

PUMP/DUMP warnings are tracked with:

- Entry
- TP
- SL
- signal score
- signal timestamp
- price at signal
- MFE
- MAE
- outcome
- exit price
- exit time

The dashboard reports:

- total signals
- open signals
- wins
- losses
- win rate
- average MFE
- average MAE

**Important:** this is a counterfactual simulator, not an execution log.

### Historical calibration

`Train Historical` downloads historical 15m Binance Futures candles for a small research universe and fits a chronological logistic regression.

The result reports:

- samples
- base rate
- test AUC
- learned weights

The trained model is not silently used as a fake probability. It is exposed as a research/calibration result first.

## Why this is the right approach

The original V2.1 score is heuristic. Its own UI states that scores are not guaranteed probabilities. This repo keeps that distinction intact.

Only after enough out-of-sample outcomes exist should the system expose an empirical probability.

## Data

Binance provides public derivatives REST and WebSocket interfaces, including real-time and historical market data. The current repo uses REST for bootstrap, tracking and historical research. A WebSocket market-data layer is the next production upgrade.

## Validation

```bash
npm run check
```

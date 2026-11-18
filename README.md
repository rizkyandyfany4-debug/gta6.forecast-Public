# GTA VI Twitch CCU Forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rizkyandyfany4-debug/gta6.forecast-Public/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/rizkyandyfany4-debug/gta6.forecast-Public/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast GTA VI's launch-day Twitch concurrent viewers hour by hour (hours 2–24 of 2026-11-19 UTC), as five quantiles per hour.

## Model

Comparable-launch shape, level-conditioned. For each of the ~38 comparable past launches in the case file, take its launch-day hourly curve and form log ratios `ln(viewers_h / viewers_1)`. Per hour, fit a line of log-ratio on `log(hour-1 viewers)` across the comparables (slope clamped to [-1, 0]: a bigger first hour means a flatter ramp), and predict the target case's log-ratio from its own hour-1 print. The spread is the residual interquartile range (×1.6), clamped to [0.10, 0.90] log units; quantiles are lognormal around the predicted median. Everything is computed from the case file at run time — no fitted constants are baked in, no network, standard library only.

Leave-one-out validation on the comparables: mean pinball loss **0.432** vs the house baseline's **0.930** on the same held-out launches (90% coverage 0.912). The practice cases' own answers are sealed on the server, so no local practice score exists; the comparable leave-one-out is the proxy.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every `<id>.in` in the input directory and writes `<id>.out` (`{"hours":[{"hour":h,"q":[q05,q25,q50,q75,q95]}...]}`) for hours 2–24. Two runs are byte-identical (deterministic).

---

<sub>Entered on [make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>

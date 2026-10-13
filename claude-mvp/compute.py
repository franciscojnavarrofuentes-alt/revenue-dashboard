#!/usr/bin/env python3
"""
MVP dentro de Claude: calcula el nuevo estado del dashboard y las alertas.

Lo ejecuta la tarea programada de Claude cada 8h:
  python3 compute.py --ranking ranking.json --hl hl.json --state state.json --out out.json

  ranking.json  lista [{rank, name, category, rev24h, rev7d, rev30d}] leída de defillama.com/revenue
  hl.json       lista [{time, total_fees, total_spot_fees}] de api.hypurrscan.io/fees (últimos puntos)
  state.json    documento meta/state actual del artifact ({} si no existe)
  out.json      {"state": {...nuevo documento...}, "alerts": [...nuevas...], "notification": "texto" | null}
"""
import argparse
import json
import math
import time

TOP_N = 10
HL_REVENUE_RATIO = 0.99          # 99% de los fees al Assistance Fund
WINDOW = 8 * 3600
LIVE_MAX_SPAN = 10 * 3600        # dos snapshots a <=10h = ventana "real" de 8h
MAX_HL_SNAPSHOTS = 200
MAX_HISTORY_POINTS = 90
MAX_ALERTS = 60

# Reglas de alerta
DAILY_DEV = 0.40                 # revenue 24h vs media de 7 días: ±40%
DAILY_MIN_USD = 100_000          # ignora protocolos pequeños
HL_DEV = 0.40                    # ventana 8h vs media de ventanas previas: ±40%
HL_MIN_BASELINE = 3              # ventanas previas necesarias para comparar
HL_BASELINE_WINDOWS = 42         # 14 días


def usd(v):
    if v is None:
        return "—"
    a = abs(v)
    if a >= 1e9:
        return f"${v / 1e9:.2f}B"
    if a >= 1e6:
        return f"${v / 1e6:.2f}M"
    if a >= 1e3:
        return f"${v / 1e3:.0f}K"
    return f"${v:.0f}"


def load(path, default):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if data is not None else default
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def hl_windows(snaps):
    """Revenue de Hyperliquid entre snapshots consecutivos, normalizado a 8h."""
    out = []
    for a, b in zip(snaps, snaps[1:]):
        span = b["time"] - a["time"]
        if span <= 0:
            continue
        fees = (b["total_fees"] - a["total_fees"]) / 1e6
        if fees < 0:
            continue
        out.append({
            "end": b["time"],
            "span": span,
            "revenue8h": fees * HL_REVENUE_RATIO * WINDOW / span,
            "live": span <= LIVE_MAX_SPAN,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ranking", required=True)
    ap.add_argument("--hl", required=True)
    ap.add_argument("--state", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--now", type=int, default=None)
    args = ap.parse_args()

    now = args.now or int(time.time())
    state = load(args.state, {})
    # ArtifactData guarda {"data": {...}} o el documento directo
    if isinstance(state, dict) and "data" in state and isinstance(state["data"], dict) and "ranking" in state["data"]:
        state = state["data"]

    ranking_raw = load(args.ranking, [])
    hl_raw = load(args.hl, [])
    alerts = []

    # ------------------------------------------------------------ ranking DefiLlama
    ranking = []
    for r in ranking_raw:
        name = str(r.get("name", "")).strip()
        rev24h = num(r.get("rev24h"))
        if not name or rev24h is None:
            continue
        ranking.append({
            "name": name,
            "category": str(r.get("category") or ""),
            "rev24h": rev24h,
            "rev7d": num(r.get("rev7d")),
            "rev30d": num(r.get("rev30d")),
        })
    ranking.sort(key=lambda r: -r["rev24h"])
    ranking = ranking[:TOP_N]
    for i, r in enumerate(ranking):
        r["rank"] = i + 1
        r["avg7d"] = r["rev7d"] / 7 if r["rev7d"] else None
        r["vs7d"] = (r["rev24h"] / r["avg7d"] - 1) if r["avg7d"] else None

    prev = {r["name"]: r for r in state.get("ranking", [])}
    history = state.get("history", {})
    new_day_names = []
    for r in ranking:
        p = prev.get(r["name"])
        changed = p is None or abs((p.get("rev24h") or 0) - r["rev24h"]) > 0.5
        series = history.setdefault(r["name"], [])
        if changed:
            series.append([now, r["rev24h"]])
            del series[:-MAX_HISTORY_POINTS]
            new_day_names.append(r["name"])

    if ranking:
        # Alerta 1: revenue 24h muy por encima/debajo de su media de 7 días (solo cuando hay dato nuevo)
        for r in ranking:
            if r["name"] not in new_day_names or r["vs7d"] is None:
                continue
            if r["rev24h"] < DAILY_MIN_USD or abs(r["vs7d"]) < DAILY_DEV:
                continue
            arrow = "🚀" if r["vs7d"] > 0 else "📉"
            alerts.append({
                "id": f"daily-{r['name']}-{int(r['rev24h'])}",
                "at": now, "protocol": r["name"], "rule": "vs_media_7d",
                "value": r["rev24h"], "baseline": r["avg7d"], "score": r["vs7d"],
                "message": f"{arrow} {r['name']}: {usd(r['rev24h'])} en 24h, {r['vs7d'] * 100:+.0f}% vs su media de 7 días ({usd(r['avg7d'])}/día)",
            })
        # Alerta 2: entra en el Top 10 (solo si ya teníamos un ranking anterior)
        if prev:
            for r in ranking:
                if r["name"] not in prev:
                    alerts.append({
                        "id": f"top-{r['name']}-{now // 86400}",
                        "at": now, "protocol": r["name"], "rule": "nuevo_top10",
                        "value": r["rev24h"], "baseline": None, "score": r["rank"],
                        "message": f"🆕 {r['name']} entra en el Top 10 (#{r['rank']}) con {usd(r['rev24h'])} en 24h",
                    })

    # ------------------------------------------------------------ Hyperliquid
    snaps = {s["time"]: s for s in state.get("hlSnapshots", [])}
    for p in hl_raw:
        t, f = num(p.get("time")), num(p.get("total_fees"))
        if t and f:
            snaps[int(t)] = {"time": int(t), "total_fees": f}
    hl_snaps = sorted(snaps.values(), key=lambda s: s["time"])[-MAX_HL_SNAPSHOTS:]
    windows = hl_windows(hl_snaps)

    prev_ends = {w["end"] for w in state.get("hlWindows", [])}
    for i, w in enumerate(windows):
        if not w["live"] or w["end"] in prev_ends:
            continue
        base = [x["revenue8h"] for x in windows[max(0, i - HL_BASELINE_WINDOWS):i]]
        if len(base) < HL_MIN_BASELINE:
            continue
        mean = sum(base) / len(base)
        dev = w["revenue8h"] / mean - 1 if mean else 0
        w["vsMean"] = dev
        if abs(dev) >= HL_DEV:
            arrow = "🚀" if dev > 0 else "📉"
            alerts.append({
                "id": f"hl-{w['end']}",
                "at": now, "protocol": "Hyperliquid", "rule": "hl_8h",
                "value": w["revenue8h"], "baseline": mean, "score": dev,
                "message": f"{arrow} Hyperliquid: {usd(w['revenue8h'])} en las últimas 8h, {dev * 100:+.0f}% vs su media ({usd(mean)} por 8h)",
            })

    # ------------------------------------------------------------ estado nuevo
    seen = {a["id"] for a in state.get("alerts", [])}
    alerts = [a for a in alerts if a["id"] not in seen]
    all_alerts = (alerts + state.get("alerts", []))[:MAX_ALERTS]

    new_state = {
        "updatedAt": now,
        "runs": int(state.get("runs", 0)) + 1,
        "ranking": ranking or state.get("ranking", []),
        "history": history,
        "hlSnapshots": hl_snaps,
        "hlWindows": windows[-MAX_HISTORY_POINTS:],
        "alerts": all_alerts,
        "rules": {
            "dailyDev": DAILY_DEV, "dailyMinUsd": DAILY_MIN_USD,
            "hlDev": HL_DEV, "hlMinBaseline": HL_MIN_BASELINE,
        },
        "errors": [] if ranking else ["No se pudo leer el ranking de DefiLlama en esta ejecución"],
    }

    notification = None
    if alerts:
        notification = " · ".join(a["message"] for a in alerts[:3])
        if len(alerts) > 3:
            notification += f" (+{len(alerts) - 3} más)"
        notification = notification[:195]

    with open(args.out, "w") as f:
        json.dump({"state": new_state, "alerts": alerts, "notification": notification}, f, ensure_ascii=False)

    print(json.dumps({
        "ranking": [r["name"] for r in ranking],
        "nuevoDatoDiario": new_day_names,
        "hlVentanas": len(windows),
        "alertasNuevas": [a["message"] for a in alerts],
        "notificacion": notification,
        "bytesEstado": len(json.dumps(new_state)),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

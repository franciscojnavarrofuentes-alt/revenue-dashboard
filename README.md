# Revenue Dashboard

**Revenue de hoy (día UTC, hasta ahora) del Top 100 de [DefiLlama Revenue](https://defillama.com/revenue)**, medido hora a hora, con alertas cuando un protocolo se sale de lo normal.

DefiLlama publica días cerrados. Este proyecto ejecuta sus mismos [adapters open source](https://github.com/DefiLlama/dimension-adapters) con ventanas de **1 hora** y, donde no se puede, usa métodos a medida.

## Cómo se mide cada protocolo

| Método | Para qué | Etiqueta en el dashboard |
|---|---|---|
| Adapter de DefiLlama por horas | La mayoría: leen la blockchain por RPC o APIs públicas | En vivo |
| Helius (Solana) | Protocolos cuyo adapter usa Dune: Axiom, GMGN… | En vivo |
| Hypurrscan | Hyperliquid | En vivo |
| Devengo | Emisores de stablecoins y ETFs: su revenue es un modelo, no un flujo | Estimado |
| — | Sin método todavía (Dune, API de pago, no cuadra) | Solo diario |

Cada adapter se **calibra** antes de usarse: se mide el día de ayer con nuestro método y se compara con la cifra de DefiLlama. Solo pasa a "en vivo" si cuadra (ratio 0,8–1,25) y si de verdad responde por horas.

## Instalación (VPS Ubuntu)

```bash
git clone https://github.com/franciscojnavarrofuentes-alt/revenue-dashboard.git /opt/revenue-dashboard
cd /opt/revenue-dashboard
sudo bash deploy/install.sh          # Node 22, dependencias, adapters de DefiLlama y servicios
sudo nano .env                       # HELIUS_API_KEY, DASHBOARD_USER, DASHBOARD_PASS
sudo -u revenue npm run discover     # Top 100 → protocolos y adapters
sudo -u revenue npm run calibrate    # prueba cada adapter contra DefiLlama (tarda)
sudo systemctl restart revenue-dashboard
```

Dashboard en `http://<IP>:3000`. La recogida corre cada hora (minuto 12 UTC) con `revenue-collect.timer`.

## Comandos

```bash
npm run collect                      # recogida manual (lo mismo que hace el timer)
npm run collect -- --only uniswap    # solo un protocolo
npm run calibrate -- --all           # recalibrar todo
npm run calibrate -- --only aave     # recalibrar uno
npm run validate -- /tmp/v.json      # prueba Axiom/GMGN (Helius) vs DefiLlama
npm test                             # tests sin red
journalctl -u revenue-collect -n 100 # log de la última recogida
```

## Alertas

- **Hoy vs ayer a la misma hora**: el acumulado de hoy se desvía ±40% (a partir de las 4:00 UTC y con el día completo medido).
- **Hora vs media**: una hora dobla, o se queda por debajo de la mitad de, la media de esa misma hora en los 7 días anteriores.

Se ven en el dashboard y, si configuras Telegram en `.env`, también llegan al móvil.

## Añadir un método a medida

1. Escribe la medición en `src/methods/` (una función `(from, to) → revenue en USD`).
2. Regístrala en `src/methods/specs.ts` (`MODULE_OVERRIDES` por adapter o `PARENT_OVERRIDES` por protocolo) y en `src/measure.ts`.
3. `npm run discover && npm run calibrate -- --only <protocolo>`.

## Estructura

```
src/
  discover.ts       Top N de DefiLlama → universo y plan
  calibrate.ts      compara cada método con DefiLlama y decide el estado
  collect.ts        recogida horaria
  measure.ts        medición unificada por ventanas
  today.ts          vista "hoy hasta ahora"
  alerts.ts         reglas de alerta
  server.ts         web + API
  methods/          adapters (lotes), solana, hypurrscan, specs (overrides)
scripts/run-batch.ts  ejecuta muchos adapters en un proceso, con reintento chain a chain
public/index.html     dashboard
deploy/               instalación y systemd
```

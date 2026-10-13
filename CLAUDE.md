# Revenue Dashboard: contexto para Claude

Proyecto de Paco (BD en Orderly Network). No es técnico: explícale todo en español, corto y sin jerga, y dile exactamente qué pegar o pulsar cuando necesites algo de él.

## Objetivo

Ver el **revenue que llevan hoy (día UTC, hasta ahora) los protocolos del Top 100 de DefiLlama**, actualizado cada hora, con alertas cuando algo se sale de lo normal. El revenue de ayer Paco ya lo ve en DefiLlama: aquí es solo la referencia.

## Arquitectura (rama `top100`)

Cada protocolo **padre** del ranking (p. ej. Uniswap) tiene uno o más **hijos** (Uniswap V2, V3…), y cada hijo es un adapter de DefiLlama. Cada hijo se mide con un **método**:

| Método | Cuándo | Código |
|---|---|---|
| `adapter` | Por defecto: el adapter de DefiLlama ejecutado con ventanas de 1 hora (RPC/APIs públicas) | `scripts/run-batch.ts`, `src/methods/adapters.ts` |
| `solana` | Override a medida: wallets de fees en Solana vía Helius (Axiom, GMGN) | `src/methods/solana.ts`, `src/methods/specs.ts` |
| `hypurrscan` | Override de Hyperliquid: fees acumulados de Hypurrscan | `src/methods/hypurrscan.ts` |
| `accrual` | Revenue devengado (stablecoins, ETFs): dato diario repartido por horas, marcado como estimado | `src/measure.ts` |
| `daily` | Sin forma de medir en vivo: se muestra solo el dato de ayer | — |

Flujo:
1. `npm run discover`: Top N padres de `/overview/fees` → tabla `universe` (hijos) y `plan` (método inicial). `src/discover.ts`
2. `npm run calibrate`: para cada hijo pendiente mide ayer (día UTC) y dos horas sueltas, y lo compara con DefiLlama. Estados: `live` (ratio 0.8–1.25 y varía por horas), `daily_only` (el adapter ignora la ventana), `mismatch`, `needs_key`, `error`. Si un adapter multichain falla entero, reintenta chain a chain y guarda las chains que fallan en `plan.skip_chains` (típico: una chain usa Dune). `src/calibrate.ts`
3. `npm run collect` (timer horario, minuto 12 UTC): una vez al día rehace discover y calibra los nuevos; snapshot de Hypurrscan; mide las horas de hoy que falten de cada hijo `live` (las más recientes primero, máximo `MAX_JOBS_PER_RUN`); alertas. `src/collect.ts`
4. `src/today.ts` calcula la vista "hoy hasta ahora" por padre; `src/server.ts` + `public/index.html` la sirven en el puerto 3000.

Tests sin red: `npm test`. Datos de ejemplo: `DB_PATH=data/demo.db npm run demo:seed && DB_PATH=data/demo.db npm run serve`.

## Dónde corre

VPS de Hostinger (Ubuntu 24.04), `/opt/revenue-dashboard`, usuario de servicio `revenue`. `deploy/install.sh` instala todo (Node 22, adapters en `vendor/`, servicios systemd). Secretos en `.env` (permisos 600): `HELIUS_API_KEY`, `DASHBOARD_USER`, `DASHBOARD_PASS`. Nunca los imprimas ni los subas al repo. Dune desactivado (`ENABLE_DUNE=false`, la cuenta no tiene créditos).

## Siguiente trabajo, en orden

1. **Poner en marcha la rama `top100`** en el VPS: `git fetch && git checkout top100`, `npm ci`, `npm run setup:adapters`, `npm test`, `sudo -u revenue npm run discover`, `sudo -u revenue npm run calibrate` (tarda: cientos de adapters). Enseña a Paco el resumen de estados (cuántos `live`, `needs_key`, etc.). Si todo va bien, haz merge a `main` y reinicia los servicios.
2. **Revisar los que no salen en vivo**, ordenados por revenue: `sqlite3 data/revenue.db "select u.parent_name,u.child_name,u.llama_rev24h,p.status,p.ratio,p.note from universe u join plan p using(child) where p.status not in ('live','estimate','skip') order by u.llama_rev24h desc limit 30"`. Para cada uno de los grandes:
   - `needs_key` con una clave gratuita (p. ej. `FRED_API_KEY`): pídela a Paco y añádela al `.env`.
   - Usa Dune: crea un método propio (como Axiom/GMGN en `specs.ts`) leyendo las wallets o contratos de fees que aparecen en su adapter.
   - `mismatch`: compara con el adapter (`vendor/dimension-adapters/fees|dexs/<module>`) y ajusta.
   - Pump: método Solana a medida (wallets de fees de pump.fun y PumpSwap en `fees/pumpdotfun.ts` y `fees/pump-swap`).
3. **Validar Axiom y GMGN** con `npm run validate -- /tmp/validate.json` (Helius vs DefiLlama ayer). Si el ratio está fuera de 0.85–1.15, revisa `porWallet`.
4. Vigilar rendimiento: si una recogida horaria tarda más de 40 min, sube `BATCH_CONCURRENCY` o baja `TOP_N`. Vigilar Helius: 1M créditos/mes en el plan gratuito; el consumo de 30 días se ve en el dashboard.
5. Telegram para alertas cuando Paco cree el bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

## Reglas

- Haz commit y push de los cambios (GitHub: franciscojnavarrofuentes-alt/revenue-dashboard). Si el push falla por permisos, díselo a Paco y sigue.
- No abras puertos nuevos ni cambies el firewall sin preguntar.
- `claude-mvp/` es un experimento anterior dentro de claude.ai. No hace falta tocarlo.

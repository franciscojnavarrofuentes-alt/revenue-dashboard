# Revenue Dashboard: contexto para Claude

Proyecto de Paco (BD en Orderly Network). No es técnico: explícale todo en español, corto y sin jerga, y dile exactamente qué pegar o pulsar cuando necesites algo de él.

## Objetivo

Ver el **revenue que llevan los protocolos crypto en el día actual (UTC), hasta ahora**, actualizado a lo largo del día. El revenue del día anterior Paco ya lo ve en DefiLlama: no aporta valor repetirlo. Alertas cuando un protocolo se salga de lo normal.

## Dónde corre

VPS de Hostinger (Ubuntu 24.04), en `/opt/revenue-dashboard`, con usuario de servicio `revenue`.
- `deploy/install.sh` instala Node 22, dependencias y los servicios systemd (`revenue-dashboard` = web en el puerto 3000, `revenue-collect.timer` = recogida cada hora).
- Secretos en `.env` (permisos 600): `HELIUS_API_KEY`, `DASHBOARD_USER`, `DASHBOARD_PASS`. Nunca los imprimas ni los subas al repo.
- Dune está desactivado (la cuenta no tiene créditos): `ENABLE_DUNE=false`.

## Fuentes por protocolo

| Protocolo | Fuente | Estado |
|---|---|---|
| Top 10 por revenue | API de DefiLlama `/overview/fees?dataType=dailyRevenue` (dato del último día completo) | hecho |
| Hyperliquid | Fees acumulados de `api.hypurrscan.io/fees` (el último punto es casi en vivo); revenue = Δfees/1e6 × 0.99 | hecho, guardando snapshot cada hora |
| Axiom Pro, GMGN | Transacciones de sus wallets de fees en Solana con Helius `getTransactionsForAddress` (`src/collectors/solana.ts`), misma lógica que los adapters de DefiLlama | **pendiente de validar con datos reales** |
| Pump | Adapter de DefiLlama vía Dune | desactivado (sin créditos); más adelante, vía Helius |
| Tether, Circle, Grayscale | Su revenue es un modelo (reservas × tipo, AUM × comisión), no un flujo | mostrar estimación lineal: dato diario × horas transcurridas / 24, marcada como estimación |

## Siguiente trabajo, en orden

1. **Validar** con `sudo -u revenue npm run validate -- /tmp/validate.json`. Compara el revenue de ayer de Axiom y GMGN calculado con Helius frente a DefiLlama (`ratio`), y mide hoy hasta ahora. Un ratio entre 0.85 y 1.15 es aceptable. Si está lejos, mira `porWallet` (wallets con 0 transacciones pueden estar desactualizadas) y compáralo con `vendor/dimension-adapters/fees/axiom.ts` y `fees/gmgnai.ts` (haz `npm run setup:adapters` si falta `vendor/`).
2. **Revenue de hoy hasta ahora**: cambiar la recogida de Solana y Hyperliquid a ventanas de 1 hora (cada ejecución horaria mide la última hora cerrada, sin releer el día entero, para no gastar créditos de Helius). Hoy hasta ahora = suma de las horas desde 00:00 UTC. Mantener la vista de 8h como agregación.
3. **Dashboard**: la vista principal es una tabla "Hoy (UTC) hasta las HH:MM" con revenue de hoy, ritmo proyectado a 24h, el dato de ayer de DefiLlama y la diferencia entre los dos. Después, gráfico por horas.
4. **Alertas**: comparar el acumulado de hoy con el acumulado de ayer a la misma hora (±40%) y cada hora con la media de esa hora en los últimos 7 días. Telegram cuando Paco cree el bot.
5. Vigilar el consumo de Helius: el plan gratuito tiene 1M de créditos al mes. El consumo de 30 días se ve en el dashboard.

## Reglas

- Haz commit y push de los cambios a `main` (GitHub: franciscojnavarrofuentes-alt/revenue-dashboard). Si el push falla por permisos, díselo a Paco y sigue.
- No abras puertos nuevos ni cambies el firewall sin preguntar.
- `claude-mvp/` es un experimento anterior dentro de claude.ai (artifact "Radar de Revenue"). No hace falta tocarlo.

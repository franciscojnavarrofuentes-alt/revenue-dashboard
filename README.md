# Revenue Dashboard

Dashboard de revenue de protocolos crypto, al estilo de [DefiLlama Revenue](https://defillama.com/revenue), con **ventanas de 8h** en lugar de datos diarios y **alertas** cuando un valor se sale de lo normal.

## Qué mide

| Bloque | Fuente | Frecuencia |
|---|---|---|
| Top 10 por revenue | API de DefiLlama (`/overview/fees`), agrupado por protocolo padre como en la web | Dato diario (último día completo), refrescado cada hora |
| Hyperliquid | Fees acumulados de Hypurrscan: snapshot horario, revenue = Δfees × 99% | Ventanas de 8h |
| Axiom Pro, GMGN | Transacciones de sus wallets de fees en Solana vía [Helius](https://helius.dev) (`getTransactionsForAddress`), con la misma lógica que los adapters de DefiLlama: fees − cashback/referidos | Ventanas de 8h |
| Pump | [Adapter open source de DefiLlama](https://github.com/DefiLlama/dimension-adapters) ejecutado con ventana de 8h. Necesita Dune con créditos (`ENABLE_DUNE=true`) | Ventanas de 8h (desactivado por defecto) |

Las ventanas se cierran a las **00:00, 08:00 y 16:00 UTC** (02:00, 10:00 y 18:00 en Madrid en horario de verano). Cada ventana se pide con 1–2h de margen por el retraso de indexado de Dune.

**Por qué no el Top 10 entero cada 8h:** Tether, Circle y Grayscale no tienen un flujo on-chain medible. DefiLlama los estima a partir de informes de reservas o del AUM × comisión, así que su revenue es casi lineal. Tron y Sky solo publican datos diarios.

**Cobertura:** cada tarjeta muestra la suma de nuestras 3 ventanas de un día ÷ el dato diario de DefiLlama. Sirve para comprobar que la medición cuadra (Pump no incluye Terminal ni la app; Axiom no incluye Axiom Perps).

## Alertas

Se evalúan sobre cada ventana nueva del último día:

- **z-score**: |revenue − media de las últimas 42 ventanas (14 días)| ≥ 2σ. Requiere al menos 9 ventanas de histórico.
- **vs. ayer**: variación ≥ ±50% frente a la misma franja del día anterior.

Se guardan en la base de datos y se ven en el dashboard. Si configuras Telegram (`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`), también se envían. Los umbrales se cambian en `.env`.

## Instalación en el VPS (Ubuntu)

```bash
git clone https://github.com/franciscojnavarrofuentes-alt/revenue-dashboard.git /opt/revenue-dashboard
cd /opt/revenue-dashboard
sudo bash deploy/install.sh          # instala Node 22, dependencias, adapters y servicios
sudo nano .env                       # HELIUS_API_KEY, DASHBOARD_USER, DASHBOARD_PASS
sudo systemctl restart revenue-dashboard
sudo -u revenue npm run probe:solana -- axiom 1   # mide 1h y proyecta el consumo mensual de Helius
sudo -u revenue npm run backfill     # opcional: 14 días de histórico (gasta créditos de Helius)
```

El dashboard queda en `http://<IP-del-VPS>:3000`. Pon `DASHBOARD_USER` y `DASHBOARD_PASS` para protegerlo con contraseña.

### Comandos útiles

```bash
systemctl list-timers revenue-collect.timer         # próxima ejecución
journalctl -u revenue-collect -n 100                # log de la última recogida
sudo -u revenue npm run collect                     # recogida manual
sudo -u revenue npm run collect -- --only pump      # solo un protocolo
```

## Estructura

```
src/
  config.ts             protocolos seguidos, fuentes y umbrales
  collect.ts            recogida (la lanza el timer cada hora)
  collectors/
    defillama.ts        ranking Top N + dato diario para calibrar
    adapter.ts          ejecuta un adapter de DefiLlama con ventana de 8h
    solana.ts           fees on-chain en Solana vía Helius (Axiom, GMGN)
    hyperliquid.ts      snapshots de fees de Hypurrscan
  alerts.ts             reglas de alerta
  notify.ts             Telegram
  server.ts             web + /api/data
public/index.html       dashboard
scripts/run-adapter.ts  runner que se ejecuta dentro de vendor/dimension-adapters
deploy/                 instalación y servicios systemd
```

## Añadir un protocolo

1. Busca su adapter en `vendor/dimension-adapters/fees/` y comprueba que filtra por `startTimestamp`/`endTimestamp` (no por `startOfDay`). Si filtra por día, no sirve para ventanas de 8h.
2. Añádelo a `TRACKED` en `src/config.ts`.
3. Pruébalo: `npm run collect -- --only <id>`.

## Limitaciones conocidas

- **Hyperliquid:** el histórico de Hypurrscan es diario. Las ventanas de 8h empiezan a contar desde la instalación y las alertas por z-score se activan tras 3 días.
- **Hyperliquid (precisión):** la cifra es una aproximación. DefiLlama usa un indexer propio no público; el % de cobertura indica la desviación.
- **Helius:** cada 100 transacciones leídas cuestan 10 créditos. El consumo de los últimos 30 días se ve arriba del dashboard; usa `probe:solana` antes de añadir protocolos con mucho volumen.
- **Axiom y GMGN** solo se miden en Solana (no BSC ni otras EVM); el % de cobertura indica cuánto del total de DefiLlama representa.
- **Pump** depende de Dune. Una ventana que falla 3 veces se deja de reintentar.

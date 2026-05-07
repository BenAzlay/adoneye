# Adoneye

AI-powered crypto portfolio decision analyst. Connect an EVM wallet, see how your holdings compared against BTC and ETH, and understand the opportunity cost of past decisions.

## Structure

```
apps/
  web/   — Next.js frontend (port 3000)
  api/   — Go backend (port 8080)
```

## Running

Start both services (in separate terminals):

```bash
make dev-api   # Go API on :8080
make dev-web   # Next.js on :3000
```

Or run directly:

```bash
cd apps/api && go run .
cd apps/web && npm run dev
```

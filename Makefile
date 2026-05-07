.PHONY: dev-web dev-api

dev-web:
	cd apps/web && npm run dev

dev-api:
	cd apps/api && set -a && . ./.env.local && set +a && go run ./cmd/server


.PHONY: dev-web dev-api

dev-web:
	cd apps/web && npm run dev

dev-api:
	cd apps/api && go run .

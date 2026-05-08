.PHONY: dev-web dev-api migrate-up migrate-down

dev-web:
	cd apps/web && npm run dev

dev-api:
	cd apps/api && set -a && . ./.env.local && set +a && go run ./cmd/server

# Requires: github.com/golang-migrate/migrate/v4/cmd/migrate
# Install: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
# DATABASE_URL is loaded from apps/api/.env.local automatically via the shell sourcing below.
migrate-up:
	cd apps/api && set -a && . ./.env.local && set +a && migrate -path migrations -database "$$DATABASE_URL" up

migrate-down:
	cd apps/api && set -a && . ./.env.local && set +a && migrate -path migrations -database "$$DATABASE_URL" down 1


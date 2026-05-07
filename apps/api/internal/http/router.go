package http

import (
	"net/http"
	"os"

	"adoneye/api/internal/billing"
	"adoneye/api/internal/health"
)

func NewRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", health.HandleHealth)
	mux.HandleFunc("/billing/checkout", billing.HandleCheckout)

	origin := os.Getenv("APP_URL")
	if origin == "" {
		origin = "*"
	}
	return withCORS(origin, mux)
}

func withCORS(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

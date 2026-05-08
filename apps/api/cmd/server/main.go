package main

import (
	"context"
	"log"
	"os"

	nethttp "net/http"

	"adoneye/api/internal/db"
	router "adoneye/api/internal/http"
)

func main() {
	ctx := context.Background()

	pool, err := db.NewPool(ctx)
	if err != nil {
		log.Fatalf("startup: %v", err)
	}
	defer pool.Close()

	log.Println("adoneye-api: database connected")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := router.NewRouter(pool)

	log.Printf("adoneye-api listening on :%s", port)
	if err := nethttp.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

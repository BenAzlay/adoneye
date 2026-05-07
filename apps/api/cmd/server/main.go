package main

import (
	"log"
	"os"

	nethttp "net/http"

	router "adoneye/api/internal/http"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := router.NewRouter()

	log.Printf("adoneye-api listening on :%s", port)
	if err := nethttp.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

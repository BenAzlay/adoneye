package billing

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	stripe "github.com/stripe/stripe-go/v85"
	stripeClient "github.com/stripe/stripe-go/v85/client"
)

type checkoutRequest struct {
	UserID string `json:"userId"`
	Email  string `json:"email"`
}

type checkoutResponse struct {
	URL string `json:"url"`
}

func HandleCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	secretKey := os.Getenv("STRIPE_SECRET_KEY")
	priceID := os.Getenv("STRIPE_WEEKLY_ANALYSIS_PRICE_ID")
	appURL := os.Getenv("APP_URL")

	if secretKey == "" || priceID == "" || appURL == "" {
		log.Println("billing: missing required env vars (STRIPE_SECRET_KEY, STRIPE_WEEKLY_ANALYSIS_PRICE_ID, APP_URL)")
		writeError(w, "billing not configured", http.StatusInternalServerError)
		return
	}

	var req checkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.UserID == "" || req.Email == "" {
		writeError(w, "userId and email are required", http.StatusBadRequest)
		return
	}

	sc := &stripeClient.API{}
	sc.Init(secretKey, nil)

	metadata := map[string]string{
		"user_id": req.UserID,
		"plan":    "weekly_1_wallet",
	}

	params := &stripe.CheckoutSessionParams{
		CustomerEmail: stripe.String(req.Email),
		Mode:          stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL: stripe.String(appURL + "/billing/success?session_id={CHECKOUT_SESSION_ID}"),
		CancelURL:  stripe.String(appURL + "/billing/cancel"),
		Metadata:   metadata,
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: metadata,
		},
	}

	s, err := sc.CheckoutSessions.New(params)
	if err != nil {
		log.Printf("billing: checkout session error: %v", err)
		writeError(w, "could not create checkout session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(checkoutResponse{URL: s.URL})
}

func writeError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

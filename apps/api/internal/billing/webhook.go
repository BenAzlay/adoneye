package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	stripe "github.com/stripe/stripe-go/v85"
	stripewebhook "github.com/stripe/stripe-go/v85/webhook"

	"adoneye/api/internal/subscriptions"
	"adoneye/api/internal/users"
)

// HandleWebhook verifies Stripe signatures, deduplicates events via stripe_events,
// and persists subscription state changes transactionally.
// STRIPE_WEBHOOK_SECRET is read once at router startup.
func HandleWebhook(pool *pgxpool.Pool, userRepo *users.Repository, subRepo *subscriptions.Repository) http.HandlerFunc {
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if webhookSecret == "" {
		log.Println("billing: STRIPE_WEBHOOK_SECRET not set — webhook endpoint will reject all requests")
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if webhookSecret == "" {
			writeError(w, "webhook not configured", http.StatusInternalServerError)
			return
		}

		// Raw body must be read before any parsing — Stripe signature covers the raw bytes.
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, "could not read request", http.StatusBadRequest)
			return
		}

		event, err := stripewebhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), webhookSecret)
		if err != nil {
			// Do not log the error detail — it may contain payload fragments.
			log.Println("webhook: signature verification failed")
			writeError(w, "invalid signature", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		var handleErr error
		switch event.Type {
		case "checkout.session.completed":
			handleErr = handleCheckoutCompleted(ctx, pool, userRepo, subRepo, event)
		case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
			handleErr = handleSubscriptionEvent(ctx, pool, subRepo, event)
		// All other event types are acknowledged and ignored.
		}

		if handleErr != nil {
			log.Printf("webhook: %s error: %v", event.Type, handleErr)
			writeError(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// handleCheckoutCompleted links the Stripe customer ID to our user record.
// Subscription state is handled by the customer.subscription.created event that
// Stripe fires immediately after checkout, so we do not write subscription rows here.
func handleCheckoutCompleted(
	ctx context.Context,
	pool *pgxpool.Pool,
	userRepo *users.Repository,
	subRepo *subscriptions.Repository,
	event stripe.Event,
) error {
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return fmt.Errorf("unmarshal checkout session: %w", err)
	}

	userID := session.Metadata["user_id"]
	if userID == "" {
		return fmt.Errorf("checkout.session.completed: missing user_id in metadata (event %s)", event.ID)
	}
	if session.Customer == nil {
		return fmt.Errorf("checkout.session.completed: missing customer (event %s)", event.ID)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	isNew, err := subRepo.InsertStripeEventIfNew(ctx, tx, event.ID, string(event.Type))
	if err != nil {
		return err
	}
	if !isNew {
		log.Printf("webhook: duplicate event %s ignored", event.ID)
		return nil // tx rolls back harmlessly
	}

	if err := userRepo.UpdateUserStripeCustomerIDTx(ctx, tx, userID, session.Customer.ID); err != nil {
		return err
	}

	if err := subRepo.MarkStripeEventProcessed(ctx, tx, event.ID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// handleSubscriptionEvent upserts the subscription row for created, updated, and
// deleted events. Using the same upsert for all three keeps state consistent
// regardless of delivery order.
func handleSubscriptionEvent(
	ctx context.Context,
	pool *pgxpool.Pool,
	subRepo *subscriptions.Repository,
	event stripe.Event,
) error {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal subscription: %w", err)
	}

	userID := sub.Metadata["user_id"]
	if userID == "" {
		return fmt.Errorf("%s: missing user_id in subscription metadata (event %s)", event.Type, event.ID)
	}
	if sub.Customer == nil {
		return fmt.Errorf("%s: missing customer on subscription (event %s)", event.Type, event.ID)
	}

	// In Stripe API v2 (dahlia), period info moved from Subscription to SubscriptionItem.
	var priceID string
	var periodStart, periodEnd *time.Time
	if len(sub.Items.Data) > 0 {
		item := sub.Items.Data[0]
		if item.Price != nil {
			priceID = item.Price.ID
		}
		periodStart = unixToTime(item.CurrentPeriodStart)
		periodEnd = unixToTime(item.CurrentPeriodEnd)
	}

	input := subscriptions.UpsertSubscriptionInput{
		UserID:               userID,
		StripeSubscriptionID: sub.ID,
		StripeCustomerID:     sub.Customer.ID,
		StripePriceID:        priceID,
		Status:               string(sub.Status),
		CurrentPeriodStart:   periodStart,
		CurrentPeriodEnd:     periodEnd,
		CancelAtPeriodEnd:    sub.CancelAtPeriodEnd,
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	isNew, err := subRepo.InsertStripeEventIfNew(ctx, tx, event.ID, string(event.Type))
	if err != nil {
		return err
	}
	if !isNew {
		log.Printf("webhook: duplicate event %s ignored", event.ID)
		return nil // tx rolls back harmlessly
	}

	if err := subRepo.UpsertSubscription(ctx, tx, input); err != nil {
		return err
	}

	if err := subRepo.MarkStripeEventProcessed(ctx, tx, event.ID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func unixToTime(ts int64) *time.Time {
	if ts == 0 {
		return nil
	}
	t := time.Unix(ts, 0).UTC()
	return &t
}

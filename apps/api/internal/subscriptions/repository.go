package subscriptions

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// InsertStripeEventIfNew inserts into stripe_events. Returns true if the row was
// inserted (new event), false if the event ID already existed (duplicate).
// Must be called within a transaction so the insert and subsequent business logic
// are committed or rolled back together.
func (r *Repository) InsertStripeEventIfNew(ctx context.Context, tx pgx.Tx, eventID, eventType string) (bool, error) {
	const q = `
		INSERT INTO stripe_events (id, stripe_event_id, event_type, created_at)
		VALUES (gen_random_uuid(), $1, $2, NOW())
		ON CONFLICT (stripe_event_id) DO NOTHING
	`
	tag, err := tx.Exec(ctx, q, eventID, eventType)
	if err != nil {
		return false, fmt.Errorf("subscriptions: InsertStripeEventIfNew: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// MarkStripeEventProcessed sets processed_at = NOW(). Called after all business
// logic succeeds, still within the same transaction.
func (r *Repository) MarkStripeEventProcessed(ctx context.Context, tx pgx.Tx, eventID string) error {
	const q = `UPDATE stripe_events SET processed_at = NOW() WHERE stripe_event_id = $1`
	_, err := tx.Exec(ctx, q, eventID)
	if err != nil {
		return fmt.Errorf("subscriptions: MarkStripeEventProcessed: %w", err)
	}
	return nil
}

type UpsertSubscriptionInput struct {
	UserID               string
	StripeSubscriptionID string
	StripeCustomerID     string
	StripePriceID        string
	Status               string
	CurrentPeriodStart   *time.Time
	CurrentPeriodEnd     *time.Time
	CancelAtPeriodEnd    bool
}

// UpsertSubscription creates or updates the subscription row keyed on
// stripe_subscription_id. Handles created, updated, and deleted events identically
// so the row always reflects current Stripe state.
func (r *Repository) UpsertSubscription(ctx context.Context, tx pgx.Tx, in UpsertSubscriptionInput) error {
	const q = `
		INSERT INTO subscriptions (
			id, user_id, stripe_subscription_id, stripe_customer_id, stripe_price_id,
			status, current_period_start, current_period_end, cancel_at_period_end,
			created_at, updated_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
		)
		ON CONFLICT (stripe_subscription_id) DO UPDATE SET
			user_id              = EXCLUDED.user_id,
			stripe_customer_id   = EXCLUDED.stripe_customer_id,
			stripe_price_id      = EXCLUDED.stripe_price_id,
			status               = EXCLUDED.status,
			current_period_start = EXCLUDED.current_period_start,
			current_period_end   = EXCLUDED.current_period_end,
			cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			updated_at           = NOW()
	`
	_, err := tx.Exec(ctx, q,
		in.UserID, in.StripeSubscriptionID, in.StripeCustomerID,
		in.StripePriceID, in.Status,
		in.CurrentPeriodStart, in.CurrentPeriodEnd,
		in.CancelAtPeriodEnd,
	)
	if err != nil {
		return fmt.Errorf("subscriptions: UpsertSubscription: %w", err)
	}
	return nil
}

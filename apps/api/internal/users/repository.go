package users

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID               string
	Email            string
	StripeCustomerID *string
}

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// CreateOrGetUserByEmail inserts a new user row if the email is not yet known,
// or returns the existing user. The operation is atomic (single round-trip).
// The no-op UPDATE on conflict ensures RETURNING always fires.
func (r *Repository) CreateOrGetUserByEmail(ctx context.Context, email string) (*User, error) {
	const q = `
		INSERT INTO users (id, email, created_at, updated_at)
		VALUES (gen_random_uuid(), $1, NOW(), NOW())
		ON CONFLICT (email) DO UPDATE SET updated_at = users.updated_at
		RETURNING id::text, email, stripe_customer_id
	`

	row := r.pool.QueryRow(ctx, q, email)

	var u User
	if err := row.Scan(&u.ID, &u.Email, &u.StripeCustomerID); err != nil {
		return nil, fmt.Errorf("users: CreateOrGetUserByEmail: %w", err)
	}

	return &u, nil
}

// UpdateUserStripeCustomerID sets the Stripe customer ID for a user.
func (r *Repository) UpdateUserStripeCustomerID(ctx context.Context, userID, stripeCustomerID string) error {
	const q = `UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`
	_, err := r.pool.Exec(ctx, q, stripeCustomerID, userID)
	if err != nil {
		return fmt.Errorf("users: UpdateUserStripeCustomerID: %w", err)
	}
	return nil
}

// UpdateUserStripeCustomerIDTx is the transactional variant used inside webhook processing.
func (r *Repository) UpdateUserStripeCustomerIDTx(ctx context.Context, tx pgx.Tx, userID, stripeCustomerID string) error {
	const q = `UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`
	_, err := tx.Exec(ctx, q, stripeCustomerID, userID)
	if err != nil {
		return fmt.Errorf("users: UpdateUserStripeCustomerIDTx: %w", err)
	}
	return nil
}

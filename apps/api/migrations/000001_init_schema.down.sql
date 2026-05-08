-- Drop in reverse dependency order to satisfy foreign key constraints.
DROP TABLE IF EXISTS portfolio_analyses;
DROP TABLE IF EXISTS analysis_jobs;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS stripe_events;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS users;

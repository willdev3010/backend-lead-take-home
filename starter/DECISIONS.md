# DECISIONS

## Locking strategy: pessimistic row locks, DB constraints as backstop

Every money-moving operation runs in a single DB transaction that takes `SELECT ... FOR UPDATE` on the rows it changes.

- **PSP callback**: locks the funding transaction (found by `pspRef`), then the wallet. Two concurrent deliveries of the same callback serialize on the funding-tx lock. The loser wakes up, sees a terminal status, and no-ops. The state machine (`Pending → Completed/Failed`) is checked while holding the lock, so an invalid transition gets rejected instead of raced.
- **Wager / withdrawal**: lock the wallet, check balance (and turnover), debit, write the ledger entry.

Lock order is always funding transaction first, then wallet, in every code path. That makes deadlocks impossible by construction.

I considered optimistic locking (version column plus retry) and rejected it. Write contention here is per-wallet and per-callback, which is low. A retry loop would add its own failure modes, especially under PSP retry storms, without buying anything measurable. Postgres default READ COMMITTED is enough because every decision read happens under an explicit row lock.

And if the application locking ever regresses, the DB refuses bad money states on its own. A partial unique index on `wallet_txs (funding_tx_id, type)` turns a second credit for the same deposit into a constraint violation instead of a double-credit. `CHECK (balance >= 0)` on wallets makes overdraw impossible. `psp_ref` is unique, and status/type/amount ranges have CHECK constraints. For a regulated money platform I treat the schema as the last line of defense, not a formality.

## Schema: append-only ledger with balance snapshots

`wallet_txs` is insert-only. Amounts are signed (credits positive, debits negative), so the wallet balance is exactly `SUM(amount)`. A test replays a mixed deposit/wager/withdrawal flow and reconciles the ledger against the balance to prove it. Each entry also stores `balance_after`, which lets an auditor (or an incident responder) spot the exact entry where a drift began without replaying history.

Turnover lives in two denormalized counters on the wallet (`turnover_required`, `turnover_accrued`), updated in the same transaction and under the same lock as the balance change that causes them. This is intentional denormalization: the withdrawal check is O(1), and the counters can be rebuilt from `funding_transactions` and the ledger if they are ever doubted.

## Callback amount mismatch: credit what actually arrived, flag for ops

The callback `amount` can legitimately differ from the requested deposit (PSP fees, short transfers, FX). My policy is that the money that actually arrived is the source of truth. Credit the callback amount, store it in `credited_amount`, set `amount_mismatch = true` for reconciliation, and compute the turnover requirement from the credited amount. Failing the deposit instead would strand real player money on routine differences and generate support tickets. Silently ignoring the difference would hide reconciliation drift. The flag makes the disagreement visible without blocking the player.

## Webhook posture

- **Unknown `pspRef`**: acknowledged with `202`, logged, no money moved. Returning 404 makes aggressive PSPs retry forever, and a spike of unknown refs is an ops alert, not a client error.
- **Duplicate of a terminal status**: `200` no-op, because PSPs only stop retrying on 2xx.
- **Contradicting a terminal status** (`failed` after `Completed`): `409` and no state change. This needs a human, not an automatic overwrite.

## Assumptions (stated, per the brief)

- Withdrawals do not consume accrued turnover. The lock reads as "lifetime accrued >= lifetime required". A different product rule (say, reset on withdrawal) changes one comparison under the same lock.
- A withdrawal's `pspRef` stays null until the approved withdrawal is actually sent to a PSP, which is out of scope.
- Rejected/refunded withdrawals (money plus ledger reversal) are out of scope; noted below as next work.

## What I would do next with more time

1. **End-of-day reconciliation job**: replay `wallet_txs` per wallet against `balance` and against PSP settlement files, alert on any drift or on `amount_mismatch` rate anomalies.
2. **Withdrawal rejection path**: a compensating ledger entry (`withdrawal_refund`) that restores the balance. Existing entries are never mutated.
3. **Raw callback audit table**: persist every callback payload (including unknown refs) before processing, for forensics and PSP dispute evidence.
4. **Idempotency keys on client-facing POSTs** (`/deposits`, `/withdrawals`) so mobile retries cannot create duplicate funding transactions.
5. **Structured logging and metrics** on callback outcomes (completed/duplicate/conflict/unknown). Those four counters are the health dashboard of the money pipeline.

## AI disclosure

I used an AI assistant (Claude) as a design sparring partner (debating locking strategies and the mismatch policy), and to generate boilerplate for routes and tests following the starter's existing patterns. Every design decision above was made and is owned by me. The concurrency model, schema constraints, and policies are choices I can defend line by line.

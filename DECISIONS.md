# DECISIONS.md — Decision Log

Each significant decision made during development, the options considered, and the rationale.

---

## Decision 1: Tech Stack Choice

**Context**: Need a full-stack web app with relational DB support.

**Options considered**:
1. React + Next.js + Prisma + PostgreSQL (full-stack framework)
2. React + Vite + Express + PostgreSQL (separate frontend/backend)
3. Vue.js + Express + PostgreSQL

**Decision**: Option 2 — React + Vite (frontend) + Express (backend) + PostgreSQL

**Rationale**: 
- Next.js adds SSR complexity we don't need for this app (it's a dashboard, not SEO-critical)
- Separate client/server gives clearer mental model of data flow, easier to explain in the live session
- Vite is faster than CRA for development
- Raw SQL over Prisma means I can explain every query — no ORM magic
- PostgreSQL chosen over MySQL for better JSON support (JSONB for anomaly data) and DECIMAL precision

---

## Decision 2: Temporal Membership Model

**Context**: Sam joined mid-April, Meera left end of March. Expenses shouldn't cross membership boundaries.

**Options considered**:
1. Boolean `is_active` flag on members — simple but loses history
2. `joined_at` / `left_at` dates on group_members — temporal model
3. Separate `membership_events` table with start/end events

**Decision**: Option 2 — `joined_at` / `left_at` dates

**Rationale**: 
- Clean and queryable: `WHERE expense_date BETWEEN joined_at AND COALESCE(left_at, 'infinity')`
- No need for event sourcing complexity
- `left_at = NULL` naturally represents "still active"
- Handles re-joining by creating a new row (same user, same group, different dates)

---

## Decision 3: Currency Handling Strategy

**Context**: Priya pointed out USD expenses were treated as INR in the spreadsheet.

**Options considered**:
1. Convert everything to INR at import time, discard original
2. Store original currency + exchange rate, convert on-the-fly
3. Store both original and converted amounts

**Decision**: Option 2 — Store original amount + currency + exchange_rate

**Rationale**: 
- Preserves the actual transaction data (auditability)
- Exchange rates can be corrected later without re-importing
- Balance calculations convert to INR using stored rate
- Display can show original or converted amount
- Used ₹83.50/USD as historical rate for March 2025 (approximate RBI reference rate)

---

## Decision 4: Negative Amount = Settlement (not refund)

**Context**: Row 23 has amount -5000 with description "Rohan paid back Aisha". Is this a refund or a settlement?

**Options considered**:
1. Treat all negatives as errors
2. Treat all negatives as refunds (reduce expense)
3. Use description context to distinguish settlement from refund

**Decision**: Option 3 — Context-aware interpretation

**Rationale**: 
- The description "paid back" clearly indicates a settlement, not a refund
- A refund would say "refund for X" and reference a specific expense
- The importer checks for settlement keywords ("paid back", "settle", "repay") AND negative amounts
- If both match → auto-convert to settlement record
- If only negative → flag as WARNING and ask user

---

## Decision 5: Duplicate Resolution Strategy

**Context**: Bombay Canteen dinner logged by both Rohan (₹4,800) and Priya (₹5,200).

**Options considered**:
1. Auto-keep the first occurrence
2. Auto-keep the higher amount
3. Flag both and let user decide

**Decision**: Option 3 — Flag and let user decide (Meera's requirement)

**Rationale**: 
- We can't know who actually paid or the real amount
- ₹400 difference might be tip, drinks, or a mistake
- Meera explicitly asked: "I want to approve anything the app deletes or changes"
- The importer flags both rows, shows the discrepancy, and presents options: keep row A, keep row B, keep both, skip both

---

## Decision 6: Balance Calculation — Credit/Debit Ledger Approach

**Context**: Need to compute "who owes whom" accurately.

**Options considered**:
1. Pairwise tracking: store each A→B debt separately
2. Net balance per person: each person has one number (positive = owed money, negative = owes money)
3. Transaction log replay

**Decision**: Option 2 — Net balance per person, with greedy settlement optimization

**Rationale**: 
- Simpler to understand and explain
- For N people, only N numbers to track (not N² pairs)
- Settlement optimization uses greedy algorithm: sort creditors and debtors by absolute balance, match largest pairs first
- This minimizes number of transactions needed to settle (Aisha's "one number per person")
- The drill-down (Rohan's requirement) is computed on-demand by querying all expenses where the user is a participant

---

## Decision 7: Import Flow — Two-Phase with User Review

**Context**: Meera wants to approve deletions/changes. Some anomalies need human judgment.

**Options considered**:
1. Auto-fix everything, show report after
2. Preview anomalies, auto-fix with undo
3. Two-phase: detect → review → confirm

**Decision**: Option 3 — Two-phase import with mandatory anomaly review

**Rationale**: 
- Phase 1 (Upload): Parse CSV, detect all anomalies, create batch record. No data is imported yet.
- Phase 2 (Review): User reviews each anomaly, approves/rejects suggestions. Only after ALL anomalies are resolved...
- Phase 3 (Confirm): Actually import the data based on user decisions.
- This gives Meera full control while still automating detection
- Import report is generated with all decisions logged

---

## Decision 8: Exchange Rate — Hardcoded vs API

**Context**: USD expenses need INR conversion. Should we use live rates?

**Options considered**:
1. Live API call to exchange rate service
2. Hardcoded historical rate
3. User-specified rate per expense

**Decision**: Option 2 for import (historical rate ₹83.50), Option 3 for manual entry

**Rationale**: 
- The CSV expenses are from March 2025 — we need the HISTORICAL rate, not today's rate
- Live API adds complexity, external dependency, and potential failure
- For the CSV import, ₹83.50/USD is approximately correct for March 2025
- For manually created expenses, user can specify the rate (with 83.50 as default)
- The rate is stored per-expense, so it can be corrected individually

---

## Decision 9: Rounding Strategy

**Context**: ₹3,200 split equally among 5 people = ₹640.00 each. But ₹48,000 / 3 = ₹16,000.00 exactly. Not all splits divide evenly.

**Options considered**:
1. Always round to 2 decimal places, accept ±₹0.01 drift
2. Round to nearest paisa, assign remainder to payer
3. Use banker's rounding (round half to even)

**Decision**: Option 2 — Round to 2 decimals, assign any remainder (±₹0.01) to the payer

**Rationale**: 
- The payer already fronted the money, so absorbing ≤₹0.01 difference is fair
- Prevents accumulated rounding errors across many splits
- Example: ₹1,000 / 3 = ₹333.33 × 3 = ₹999.99. Payer's share becomes ₹333.34.
- This is the most common approach in real expense-splitting apps

---

## Decision 10: Authentication — JWT in localStorage

**Context**: Assignment requires a login module.

**Options considered**:
1. Session-based auth with cookies
2. JWT in httpOnly cookie
3. JWT in localStorage

**Decision**: Option 3 — JWT in localStorage

**Rationale**: 
- Simpler implementation for a demo/assignment app
- No CSRF concerns with token-based auth
- Easy to include in API requests via Authorization header
- For a production app, httpOnly cookies would be more secure, but this is appropriate for the scope
- Token expires in 7 days

---

## Decision 11: Post-Departure Expenses

**Context**: April electricity (row 29) includes Meera who left March 31. Row 46 has Meera paying May groceries.

**Options considered**:
1. Silently exclude departed members
2. Flag and let user decide
3. Include them (they used the electricity before leaving)

**Decision**: Flag as WARNING, suggest exclusion, let user override

**Rationale**: 
- Row 29 (April electricity): Meera probably shouldn't pay — she left before April. But some bills are for the previous month's usage. User might reasonably include her.
- Row 46 (Meera paying May groceries): This is almost certainly wrong — she doesn't live there. Flag as ERROR.
- The distinction: being INCLUDED in a split after leaving = WARNING. Being the PAYER after leaving = ERROR.
- In both cases, the user makes the final call.

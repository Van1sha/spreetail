# AI_USAGE.md — AI Tool Usage Log

## Tools Used

| Tool | Purpose | Usage Context |
|------|---------|---------------|
| Google Gemini (Antigravity) | Primary development collaborator | Architecture design, code generation, debugging, documentation |

## Key Prompts

### Prompt 1: Architecture Planning
> "Build a shared expenses app for flat mates with messy CSV data. React + Node + PostgreSQL. Support temporal membership, multi-currency, 14 types of CSV anomalies..."

**Result**: Generated a comprehensive implementation plan with database schema, API routes, and component structure. I reviewed and modified the schema to add `is_settlement` flag and temporal membership constraints.

### Prompt 2: CSV Anomaly Detection Engine
> "Create an import service that detects 14 specific data problems in a CSV: duplicates, settlements as expenses, missing currencies, post-departure charges..."

**Result**: Generated the anomaly detection logic. I caught and fixed issues with date parsing order and duplicate detection sensitivity.

### Prompt 3: Balance Calculation
> "Implement a balance calculation engine that respects membership timelines, converts USD to INR, and generates optimal settlement plans..."

**Result**: Generated the core algorithm. I verified it by hand-calculating balances for test scenarios.

---

## Three Cases Where AI Produced Something Wrong

### Case 1: Date Parsing — Ambiguous MM/DD vs DD/MM

**What AI generated**: The date parser tried to auto-detect format by checking if the first number > 12 (must be day). But `02/12/2025` is ambiguous — is it Feb 12 or Dec 2?

**How I caught it**: I traced through the CSV and realized row 6 (`02/12/2025`) was being parsed as December 2nd instead of February 12th. The surrounding context (expenses are chronological, Feb entries before March entries) makes it clear it should be February 12th.

**What I changed**: Added contextual date parsing that considers:
1. The position of the date relative to other dates in the CSV
2. If the result would be out of chronological order, try the alternative interpretation
3. Default to MM/DD/YYYY for American-style dates when ambiguous

### Case 2: Duplicate Detection — Over-Aggressive Fuzzy Matching

**What AI generated**: The duplicate detector used Levenshtein distance on descriptions, flagging "Groceries - weekly" entries as duplicates of each other even though they were on different dates.

**How I caught it**: During testing, nearly all weekly grocery entries were being flagged as duplicates. Groceries happen every week — same description doesn't mean same event.

**What I changed**: Tightened duplicate detection to require BOTH same date AND similar description. For exact duplicates, require all fields to match. Reduced false positive rate significantly.

### Case 3: Balance Calculation — Settlements Double-Counted

**What AI generated**: The initial balance calculation treated settlement records as both expenses (subtracting from payer's balance) AND settlements (adding to the settlement total). This caused Rohan's ₹5,000 payment to Aisha to be counted twice.

**How I caught it**: I manually calculated Rohan's balance with pen and paper, then compared it to the app's output. The numbers were off by ₹5,000 — exactly the settlement amount.

**What I changed**: Added `WHERE is_settlement = FALSE` to the expense balance query, ensuring settlements are only processed through the settlements table, not double-counted as expenses.

---

## Usage Patterns

- Used AI heavily for **boilerplate** (Express route setup, React component structure, CSS design tokens)
- Used AI moderately for **business logic** (balance calculation, anomaly detection) but manually verified every formula
- Used AI lightly for **decision-making** — all product decisions (how to handle ambiguous data, which row to keep in duplicates) were made by me based on the assignment requirements
- AI-generated code was reviewed line-by-line before committing
- Every SQL query was tested manually against sample data before integration

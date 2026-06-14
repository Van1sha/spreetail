# SCOPE.md — Anomaly Log & Database Schema

## Database Schema

### Entity Relationship Overview

```
users ──< group_members >── groups
  │                           │
  │──< expenses ──< expense_splits
  │                           │
  │──< settlements ──────────│
  │
  └──< import_batches ──< import_anomalies
```

### Table: users
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| name | VARCHAR(100) | NOT NULL |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

### Table: groups
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| name | VARCHAR(200) | NOT NULL |
| description | TEXT | |
| created_by | INTEGER | FK → users(id) |
| created_at | TIMESTAMP | DEFAULT NOW() |

### Table: group_members
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| group_id | INTEGER | FK → groups(id) CASCADE |
| user_id | INTEGER | FK → users(id) |
| joined_at | DATE | NOT NULL |
| left_at | DATE | NULL = still active |

**Design note**: Temporal membership is key to this app. When calculating balances, only expenses dated within a member's [joined_at, left_at] range are counted. This solves Sam's concern about pre-join expenses and Meera's about post-departure charges.

### Table: expenses
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| group_id | INTEGER | FK → groups(id) CASCADE |
| paid_by | INTEGER | FK → users(id) |
| description | VARCHAR(500) | NOT NULL |
| amount | DECIMAL(12,2) | NOT NULL |
| currency | VARCHAR(3) | DEFAULT 'INR' |
| exchange_rate | DECIMAL(10,4) | NULL if INR |
| category | VARCHAR(100) | |
| expense_date | DATE | NOT NULL |
| split_type | VARCHAR(20) | NOT NULL |
| notes | TEXT | |
| is_settlement | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMP | DEFAULT NOW() |
| import_batch_id | INTEGER | NULL |

### Table: expense_splits
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| expense_id | INTEGER | FK → expenses(id) CASCADE |
| user_id | INTEGER | FK → users(id) |
| amount | DECIMAL(12,2) | NOT NULL (in INR) |
| percentage | DECIMAL(5,2) | NULL |
| shares | INTEGER | NULL |

### Table: settlements
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| group_id | INTEGER | FK → groups(id) CASCADE |
| paid_by | INTEGER | FK → users(id) |
| paid_to | INTEGER | FK → users(id) |
| amount | DECIMAL(12,2) | NOT NULL |
| currency | VARCHAR(3) | DEFAULT 'INR' |
| settlement_date | DATE | NOT NULL |
| notes | TEXT | |
| created_at | TIMESTAMP | DEFAULT NOW() |

### Table: import_batches
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| group_id | INTEGER | FK → groups(id) |
| filename | VARCHAR(255) | |
| total_rows | INTEGER | |
| imported_rows | INTEGER | |
| skipped_rows | INTEGER | |
| anomalies_found | INTEGER | |
| status | VARCHAR(20) | DEFAULT 'pending' |
| imported_by | INTEGER | FK → users(id) |
| created_at | TIMESTAMP | DEFAULT NOW() |

### Table: import_anomalies
| Column | Type | Constraints |
|--------|------|-------------|
| id | SERIAL | PRIMARY KEY |
| batch_id | INTEGER | FK → import_batches(id) CASCADE |
| row_number | INTEGER | |
| anomaly_type | VARCHAR(50) | |
| severity | VARCHAR(20) | |
| description | TEXT | |
| original_data | JSONB | |
| suggested_action | VARCHAR(50) | |
| user_decision | VARCHAR(50) | NULL until reviewed |
| resolved_at | TIMESTAMP | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

---

## Anomaly Log

Every data problem detected in `expenses_export.csv`, how it was identified, and how it is handled.

### Anomaly #1: Inconsistent Date Formats
- **Row(s)**: 6 (`02/12/2025` — MM/DD/YYYY), 12 (`03-05-2025` — MM-DD-YYYY)
- **Detection**: Regex matching against expected YYYY-MM-DD format
- **Handling**: Auto-normalize all dates to YYYY-MM-DD. Parse each format (YYYY-MM-DD, MM/DD/YYYY, DD-MM-YYYY, MM-DD-YYYY) and standardize. Surface as INFO anomaly.

### Anomaly #2: Amount Format — Currency Symbol in Value
- **Row(s)**: 8 (amount = `₹1750`)
- **Detection**: Strip non-numeric characters (except `.` and `-`), detect presence of currency symbols
- **Handling**: Strip `₹`, `$`, and other currency symbols. Parse cleaned value. Surface as WARNING.

### Anomaly #3: Amount Format — Comma Separators
- **Row(s)**: 9 (amount = `3,500`)
- **Detection**: Detect commas in numeric fields
- **Handling**: Remove commas, parse as number. Surface as INFO.

### Anomaly #4: Duplicate Entry (Same Event, Different Loggers/Amounts)
- **Row(s)**: 6-7 (Bombay Canteen dinner — Rohan logged ₹4,800, Priya logged ₹5,200)
- **Detection**: Same date + similar description (fuzzy match on "Dinner at Bombay Canteen") + different payers
- **Handling**: Flag as WARNING. Suggest keeping one (the one with more participants or the higher amount). User must decide which to keep. Default: keep the first occurrence.

### Anomaly #5: Exact Duplicate Row
- **Row(s)**: 35-36 (Dinner party by Priya, ₹8,200 — identical in every field)
- **Detection**: Hash each row; detect identical hashes
- **Handling**: Flag as WARNING. Suggest skipping the duplicate. User can override.

### Anomaly #6: Settlement Logged as Expense
- **Row(s)**: 23 ("Rohan paid back Aisha", amount = -5000, category = Settlement)
- **Detection**: Description contains keywords ("paid back", "settle", "repay") OR category is "Settlement"
- **Handling**: Convert to a settlement record instead of an expense. Rohan → Aisha, ₹5,000. Surface as INFO with explanation.

### Anomaly #7: Negative Amount
- **Row(s)**: 23 (amount = -5000)
- **Detection**: `amount < 0`
- **Handling**: Combined with Anomaly #6. If settlement: use absolute value. Otherwise: ask user if it's a refund (treat as expense reduction) or a settlement.

### Anomaly #8: USD Expenses Without Conversion
- **Row(s)**: 18 (Goa dinner, $150), 19 (Water sports, $85)
- **Detection**: `currency === 'USD'`
- **Handling**: Apply exchange rate. Use historical rate of ₹83.50 per USD (approximate March 2025 rate). Store original amount + exchange rate. Surface as INFO.

### Anomaly #9: Missing Currency Field
- **Row(s)**: 20 (Water sports duplicate — currency field is empty)
- **Detection**: Currency field is empty/null
- **Handling**: Compare with adjacent rows for context. If similar description exists with USD, suggest USD. Otherwise default to INR. Surface as WARNING.

### Anomaly #10: Duplicate Entry with Missing Currency (Water Sports)
- **Row(s)**: 19-20 (Both "Goa Trip - Water sports" by Rohan, $85, but row 20 has no currency)
- **Detection**: Same description + same payer + same amount + same date, one with currency and one without
- **Handling**: Flag row 20 as duplicate of row 19. Suggest skipping. Surface as WARNING.

### Anomaly #11: Post-Departure Member Included in Split
- **Row(s)**: 29 (April electricity includes Meera, who left March 31)
- **Detection**: Cross-reference expense date with `group_members.left_at`
- **Handling**: Remove Meera from the split and recalculate. Surface as WARNING with explanation. User can override to keep Meera in.

### Anomaly #12: Note/Event Rows (Not Expenses)
- **Row(s)**: 27 ("Meera moves out"), 32 ("Sam moves in")
- **Detection**: Missing required fields (amount, paid_by) AND notes field contains event-like text
- **Handling**: Skip as expense. Use these as membership events — auto-set Meera's `left_at = 2025-03-31` and Sam's `joined_at = 2025-04-15`. Surface as INFO.

### Anomaly #13: Future-Dated Expense
- **Row(s)**: 45 (July 2025 — "Advance booking - Party hall")
- **Detection**: `expense_date > current_date`
- **Handling**: Flag as WARNING. Allow import but mark as future-dated. User can keep or skip.

### Anomaly #14: Departed Member as Payer
- **Row(s)**: 46 (Meera paying May groceries, but she moved out in March)
- **Detection**: Payer's `left_at` < `expense_date`
- **Handling**: Flag as ERROR. Someone who left shouldn't be paying group expenses. Suggest skipping or reassigning payer. User must decide.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total CSV rows | 46 |
| Valid expense rows | ~32 |
| Anomalies detected | 14+ |
| Anomaly types | 14 categories |
| Currencies | INR, USD |
| Members | 6 (Aisha, Rohan, Priya, Meera, Dev, Sam) |
| Date range | Feb 2025 – Jul 2025 |
| Split types used | equal, exact, percentage, shares |

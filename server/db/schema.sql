-- FairShare SQLite Database Schema
-- Tracks shared expenses among flat mates with temporal membership,
-- multi-currency support, and a full CSV import audit trail.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Temporal membership: joined_at/left_at lets us scope expenses
-- to when someone actually lived in the flat. left_at = NULL means still active.
CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    joined_at TEXT NOT NULL,
    left_at TEXT,
    UNIQUE(group_id, user_id, joined_at)
);

CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    paid_by INTEGER REFERENCES users(id),
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'INR',
    exchange_rate REAL,
    category TEXT,
    expense_date TEXT NOT NULL,
    split_type TEXT NOT NULL,
    notes TEXT,
    is_settlement INTEGER DEFAULT 0, -- 0 for normal, 1 for settlement
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    import_batch_id INTEGER
);

-- Each row in expense_splits records one person's share of an expense.
-- amount is always in the base currency (INR).
CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    amount REAL NOT NULL,
    percentage REAL,
    shares INTEGER,
    UNIQUE(expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    paid_by INTEGER REFERENCES users(id),
    paid_to INTEGER REFERENCES users(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'INR',
    settlement_date TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES groups(id),
    filename TEXT,
    total_rows INTEGER,
    imported_rows INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    anomalies_found INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    imported_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Every anomaly found during a CSV import gets its own row here.
-- user_decision stays NULL until the user reviews it in the UI.
CREATE TABLE IF NOT EXISTS import_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER,
    anomaly_type TEXT,
    severity TEXT,
    description TEXT,
    original_data TEXT, -- JSON string
    suggested_action TEXT,
    user_decision TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FairShare PostgreSQL Database Schema
-- Tracks shared expenses among flat mates with temporal membership,
-- multi-currency support, and a full CSV import audit trail.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Temporal membership: joined_at/left_at lets us scope expenses
-- to when someone actually lived in the flat. left_at = NULL means still active.
CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    joined_at DATE NOT NULL,
    left_at DATE,
    UNIQUE(group_id, user_id, joined_at)
);

CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    paid_by INTEGER REFERENCES users(id),
    description VARCHAR(500) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    exchange_rate DECIMAL(10,4),
    category VARCHAR(100),
    expense_date DATE NOT NULL,
    split_type VARCHAR(20) NOT NULL,
    notes TEXT,
    is_settlement BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    import_batch_id INTEGER
);

-- Each row in expense_splits records one person's share of an expense.
-- amount is always in the base currency (INR). For USD expenses,
-- this is already the converted value.
CREATE TABLE IF NOT EXISTS expense_splits (
    id SERIAL PRIMARY KEY,
    expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    amount DECIMAL(12,2) NOT NULL,
    percentage DECIMAL(5,2),
    shares INTEGER,
    UNIQUE(expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    paid_by INTEGER REFERENCES users(id),
    paid_to INTEGER REFERENCES users(id),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    settlement_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batches (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id),
    filename VARCHAR(255),
    total_rows INTEGER,
    imported_rows INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    anomalies_found INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    imported_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Every anomaly found during a CSV import gets its own row here.
-- user_decision stays NULL until the user reviews it in the UI.
CREATE TABLE IF NOT EXISTS import_anomalies (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER,
    anomaly_type VARCHAR(50),
    severity VARCHAR(20),
    description TEXT,
    original_data JSONB,
    suggested_action VARCHAR(50),
    user_decision VARCHAR(50),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

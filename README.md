# FairShare — Shared Expenses App

A full-stack shared expenses management application built for flat mates to track, split, and settle group expenses with multi-currency support and smart CSV import.

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Auth**: JWT (JSON Web Tokens)

## Features

- **Group Management**: Create groups with time-aware membership (members join/leave with dates)
- **Expense Tracking**: Support for equal, exact, percentage, and shares-based splitting
- **Multi-Currency**: INR and USD support with exchange rate conversion
- **Smart CSV Import**: Detects 14 types of data anomalies with user-reviewable resolution
- **Balance Engine**: Real-time balance calculation respecting membership timelines
- **Settlement Planning**: Optimal "who pays whom" calculation minimizing transactions
- **Detailed Breakdowns**: Drill into any balance to see exactly which expenses contribute

## AI Tools Used

- **Google Gemini** (Antigravity agent) — Primary development collaborator for architecture planning, code generation, and debugging
- See [AI_USAGE.md](./AI_USAGE.md) for detailed usage log

## Quick Start

### Prerequisites

- Node.js 18+ (Node.js v22.20+ recommended)
- npm 9+
- PostgreSQL (Optional, only required for production deployment)

### Database Configuration

* **Local Development (Default)**: The application uses **SQLite** natively. There is **no database setup command needed**. On first start, it will create a local file database at [server/splitwise.db](file:///C:/Users/vanis/OneDrive/Desktop/spreetail/server/splitwise.db) and automatically run the schema setup.
* **Production Deployment**: Setting the `DATABASE_URL` environment variable will instruct the database engine to connect to PostgreSQL (e.g. Supabase, Neon, or Render PostgreSQL).

### Running the App Locally

1. **Backend Server**:
   ```bash
   cd server
   npm install
   npm start
   ```
   *(Starts on http://localhost:5000)*

2. **Frontend client**:
   ```bash
   cd client
   npm install
   npm run dev
   ```
   *(Starts on http://localhost:5173)*

### Default Test Accounts

After importing the CSV, the following accounts are created automatically:
- **Aisha**: aisha@fairshare.app / password123
- **Rohan**: rohan@fairshare.app / password123
- **Priya**: priya@fairshare.app / password123
- **Meera**: meera@fairshare.app / password123
- **Dev**: dev@fairshare.app / password123
- **Sam**: sam@fairshare.app / password123

## Project Structure

```
spreetail/
├── client/             # React + Vite frontend
│   ├── src/
│   │   ├── api/        # Axios HTTP client
│   │   ├── components/ # Reusable UI components
│   │   ├── context/    # React Context (auth)
│   │   ├── hooks/      # Custom hooks
│   │   ├── pages/      # Route pages
│   │   └── utils/      # Helpers (currency, dates)
│   └── index.html
├── server/             # Express API server
│   ├── config/         # Database connection
│   ├── db/             # SQL schema
│   ├── middleware/      # Auth, error handling
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   └── index.js
├── expenses_export.csv # Raw data file for import
├── SCOPE.md            # Anomaly log + schema documentation
├── DECISIONS.md        # Decision log
└── AI_USAGE.md         # AI tool usage documentation
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Sign in |
| GET | /api/auth/me | Current user |
| GET/POST | /api/groups | List/create groups |
| GET/PUT/DELETE | /api/groups/:id | Group CRUD |
| POST | /api/groups/:id/members | Add member |
| GET/POST | /api/expenses/group/:id | List/create expenses |
| GET | /api/balances/group/:id | Group balances |
| GET | /api/balances/group/:id/settlement-plan | Settlement optimization |
| POST | /api/import/group/:id/upload | Upload CSV |
| POST | /api/import/:batchId/confirm | Finalize import |

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect if we are running with PostgreSQL configurations (typical in production)
const isPostgres = !!(process.env.DATABASE_URL || process.env.DB_HOST);

let pool;
let sqliteDbInstance = null;
let runQuery;

if (isPostgres) {
  console.log('Database configuration: PostgreSQL mode detected');
  // Dynamically import pg only when needed
  const pgModule = await import('pg');
  const Pool = pgModule.default.Pool;

  const pgConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'splitwise_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      };
  
  const pgPool = new Pool(pgConfig);
  pool = pgPool;
  runQuery = (sql, params) => pgPool.query(sql, params);
} else {
  console.log('Database configuration: SQLite local fallback mode detected');
  // Dynamically import sqlite3 only when needed
  const sqlite3Module = await import('sqlite3');
  const sqlite3 = sqlite3Module.default;

  const dbPath = path.join(__dirname, '..', 'splitwise.db');
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to connect to SQLite database:', err.message);
    } else {
      console.log('Connected to SQLite database at:', dbPath);
      db.run('PRAGMA foreign_keys = ON;');
    }
  });

  sqliteDbInstance = db;

  const sqliteQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      // Replaces $1, $2 parameter markers with ?
      let translatedSql = sql.replace(/\$\d+/g, '?');
      translatedSql = translatedSql.replace(/NOW\(\)/gi, "datetime('now')");

      db.all(translatedSql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
      });
    });
  };

  runQuery = sqliteQuery;

  pool = {
    query: sqliteQuery,
    connect: async () => ({
      query: sqliteQuery,
      release: () => {}
    }),
    on: () => {}
  };
}

/**
 * Initializes the database schema using either postgres or sqlite files.
 */
export async function initializeDatabase() {
  try {
    const filename = isPostgres ? 'schema.sql' : 'schema_sqlite.sql';
    const schemaPath = path.join(__dirname, '..', 'db', filename);
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    if (isPostgres) {
      await pool.query(schema);
      console.log('PostgreSQL database schema initialized successfully');
    } else {
      const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        await new Promise((resolve, reject) => {
          sqliteDbInstance.run(statement, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      console.log('SQLite database schema initialized successfully');
    }
  } catch (err) {
    console.error('Failed to initialize database schema:', err.message);
    throw err;
  }
}

/**
 * Proxy query function to behave like pool.query
 */
export function query(sql, params) {
  return runQuery(sql, params);
}

export default pool;

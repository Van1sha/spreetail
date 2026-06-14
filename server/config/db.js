import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'splitwise.db');

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    // Enable foreign keys in SQLite
    db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
      if (pragmaErr) console.error('Failed to enable foreign keys:', pragmaErr);
    });
  }
});

/**
 * Executes a SQL query with parameters.
 * Automatically translates PostgreSQL syntax to SQLite syntax:
 * 1. Replaces $1, $2, etc., parameter placeholders with ?
 * 2. Replaces NOW() with datetime('now')
 */
export function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    // Translate PG parameter markers to SQLite question marks
    let translatedSql = sql.replace(/\$\d+/g, '?');
    
    // Translate NOW() to SQLite datetime('now')
    translatedSql = translatedSql.replace(/NOW\(\)/gi, "datetime('now')");

    // Print queries for debugging
    // console.log(`[SQLITE] Running: ${translatedSql} | Params:`, params);

    db.all(translatedSql, params, (err, rows) => {
      if (err) {
        console.error(`[SQLITE ERROR] Query: ${translatedSql} | Error:`, err.message);
        reject(err);
      } else {
        resolve({ rows });
      }
    });
  });
}

/**
 * Initializes the SQLite database schema.
 * Reads the schema.sql file and executes it.
 */
export async function initializeDatabase() {
  try {
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // SQLite can't execute multiple statements at once easily with db.run
    // We split by semicolon and execute them sequentially
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      await new Promise((resolve, reject) => {
        db.run(statement, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    console.log('SQLite database schema initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database schema:', err.message);
    throw err;
  }
}

// Mock pool object for pg compatibility
const pool = {
  query,
  connect: async () => {
    return {
      query,
      release: () => {}
    };
  },
  on: () => {}
};

export default pool;

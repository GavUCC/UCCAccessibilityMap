'use strict';

const fs = require('fs');
const path = require('path');

function readMigrationFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      version: file.replace(/\.sql$/i, ''),
      file,
      sql: fs.readFileSync(path.join(dirPath, file), 'utf8')
    }));
}

function sqliteExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

function splitSqlStatements(sql) {
  return String(sql || '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function shouldIgnoreSqliteMigrationError(statement, error) {
  const message = String(error?.message || '').toLowerCase();
  const normalized = String(statement || '').toLowerCase().replace(/\s+/g, ' ');
  if (!message) return false;
  if (normalized.includes('alter table') && normalized.includes(' add column') && message.includes('duplicate column name')) {
    return true;
  }
  return false;
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

async function applySqliteMigrations(db, migrationsDir, logger = console) {
  const files = readMigrationFiles(migrationsDir);
  if (!files.length) return { applied: [] };

  await sqliteExec(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const rows = await sqliteAll(db, 'SELECT version FROM schema_migrations');
  const appliedVersions = new Set(rows.map((row) => row.version));
  const applied = [];

  for (const migration of files) {
    if (appliedVersions.has(migration.version)) continue;
    const statements = splitSqlStatements(migration.sql);
    for (const statement of statements) {
      try {
        await sqliteExec(db, `${statement};`);
      } catch (error) {
        if (shouldIgnoreSqliteMigrationError(statement, error)) {
          logger.warn?.(`[migrations][sqlite] skipped duplicate column in ${migration.file}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    await sqliteExec(db, `INSERT INTO schema_migrations(version, applied_at) VALUES ('${migration.version.replace(/'/g, "''")}', CURRENT_TIMESTAMP)`);
    applied.push(migration.version);
    logger.log(`[migrations][sqlite] applied ${migration.file}`);
  }

  return { applied };
}

async function applyPostgresMigrations(pool, migrationsDir, logger = console) {
  const files = readMigrationFiles(migrationsDir);
  if (!files.length) return { applied: [] };

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const rows = await pool.query('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(rows.rows.map((row) => row.version));
  const applied = [];

  for (const migration of files) {
    if (appliedVersions.has(migration.version)) continue;
    await pool.query('BEGIN');
    try {
      await pool.query(migration.sql);
      await pool.query('INSERT INTO schema_migrations(version, applied_at) VALUES($1, NOW())', [migration.version]);
      await pool.query('COMMIT');
      applied.push(migration.version);
      logger.log(`[migrations][postgres] applied ${migration.file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  return { applied };
}

module.exports = {
  applySqliteMigrations,
  applyPostgresMigrations,
  readMigrationFiles
};

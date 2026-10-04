import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const { Client } = pg;

export async function runAutoMigrations(
  configService: ConfigService,
  logger: Logger = new Logger('AutoMigrate'),
): Promise<void> {
  const connectionString =
    configService.get<string>('DATABASE_URL') ||
    'postgresql://postgres:postgres@localhost:5432/postgres';

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const ssl =
    process.env.DATABASE_SSL === 'true' ||
    ((connectionString.includes('supabase') || process.env.NODE_ENV === 'production') && !isLocal)
      ? { rejectUnauthorized: false }
      : undefined;

  // Locate db/migrations folder relative to working directory or compiled output
  const possibleDirs = [
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), '../db/migrations'),
    path.resolve(process.cwd(), '../../db/migrations'),
    path.resolve(__dirname, '../../../db/migrations'),
    path.resolve(__dirname, '../../../../db/migrations'),
  ];

  const migrationsDir = possibleDirs.find((d) => fs.existsSync(d));

  if (!migrationsDir) {
    logger.warn('Could not locate db/migrations directory. Skipping auto-migration.');
    return;
  }

  const client = new Client({
    connectionString,
    ssl,
  });

  try {
    await client.connect();

    // 1. Ensure migration tracking ledger exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        name text PRIMARY KEY,
        executed_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 2. Query already executed migrations
    const executedRes = await client.query('SELECT name FROM _schema_migrations;');
    const executedSet = new Set<string>(executedRes.rows.map((r: { name: string }) => r.name));

    // 3. Find all .sql files in db/migrations/ sorted numerically
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const pending = migrationFiles.filter((f) => !executedSet.has(f));

    if (pending.length === 0) {
      logger.log(`Database schema is up to date (${migrationFiles.length} migrations verified).`);
      return;
    }

    logger.log(`Applying ${pending.length} pending database migration(s)...`);

    for (const mName of pending) {
      const mPath = path.join(migrationsDir, mName);
      const sql = fs.readFileSync(mPath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;',
          [mName],
        );
        await client.query('COMMIT');
        logger.log(`✓ Successfully applied migration: ${mName}`);
      } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`❌ Migration failed on ${mName}: ${err.message}`);
        throw err;
      }
    }

    logger.log(`🎉 All ${pending.length} pending migration(s) applied successfully.`);
  } catch (err: any) {
    logger.warn(`Auto-migration check notice: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

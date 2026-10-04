import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Support --prod flag to target production database directly
const isProdTarget = process.argv.includes('--prod') || process.env.MIGRATE_PROD === 'true';

const prodConnectionString =
  process.env.PROD_DATABASE_URL ||
  'postgresql://postgres.eolmveanrgghqzayqtby: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@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

let connectionString: string;

if (isProdTarget) {
  connectionString = prodConnectionString;
} else if (process.env.DATABASE_URL) {
  connectionString = process.env.DATABASE_URL;
} else {
  const envPath = path.join(rootDir, 'apps/api/.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
  connectionString = process.env.DATABASE_URL || prodConnectionString;
}

const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const targetEnv = isProdTarget || !isLocal ? 'PRODUCTION (Supabase)' : 'DEVELOPMENT (Local)';
const maskedConnection = connectionString.replace(/:[^:@]*@/, ':****@');

console.log('====================================================');
console.log(`🚀 Arihant BOS Database Migration [${targetEnv}]`);
console.log(`Connecting to: ${maskedConnection}`);
console.log('====================================================');
const ssl =
  process.env.DATABASE_SSL === 'true' ||
  ((connectionString.includes('supabase') || process.env.NODE_ENV === 'production') && !isLocal)
    ? { rejectUnauthorized: false }
    : undefined;

const client = new Client({
  connectionString,
  ssl,
});

async function runMigration() {
  await client.connect();
  console.log('✅ Connected to PostgreSQL database.');

  try {
    await client.query('BEGIN');

    // 0. Ensure schema migration ledger exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        name text PRIMARY KEY,
        executed_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // 1. Core Schema (Check if already initialized)
    const checkTable = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';",
    );
    if (checkTable.rows.length === 0) {
      console.log('📜 [1/4] Executing db/schema.sql...');
      const schemaSql = fs.readFileSync(path.join(rootDir, 'db/schema.sql'), 'utf8');
      await client.query(schemaSql);
      await client.query(
        "INSERT INTO _schema_migrations (name) VALUES ('000_schema.sql') ON CONFLICT (name) DO NOTHING;",
      );
      console.log('   ✓ db/schema.sql executed successfully.');
    } else {
      console.log('📜 [1/4] Core tables already exist. Skipping db/schema.sql creation.');
    }

    // 2. Fetch already executed migrations
    const executedRes = await client.query('SELECT name FROM _schema_migrations;');
    const executedSet = new Set<string>(executedRes.rows.map((r: { name: string }) => r.name));

    // 3. Discover and execute all migrations in sorted numerical order
    const migrationsDir = path.join(rootDir, 'db/migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    console.log(`📜 [2/4] Discovered ${migrationFiles.length} migration files in db/migrations/`);

    let appliedCount = 0;
    for (const mName of migrationFiles) {
      if (executedSet.has(mName)) {
        console.log(`   ⏩ [skip] ${mName} (already recorded in _schema_migrations)`);
        continue;
      }

      console.log(`📜 Executing db/migrations/${mName}...`);
      const mPath = path.join(migrationsDir, mName);
      const mSql = fs.readFileSync(mPath, 'utf8');
      await client.query(mSql);
      await client.query(
        'INSERT INTO _schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;',
        [mName],
      );
      console.log(`   ✓ db/migrations/${mName} executed successfully.`);
      appliedCount++;
    }

    console.log(`   ✓ ${appliedCount} new migrations applied (${migrationFiles.length - appliedCount} were already up to date).`);

    // 4. Baseline Zones & Regions (Essential Master References)
    console.log('🌍 [3/4] Seeding baseline Zones & Regions masters...');
    const zonesRes = await client.query(`
      INSERT INTO zones (code, name) VALUES
        ('N', 'North'),
        ('NE', 'North East'),
        ('S', 'South'),
        ('E', 'East'),
        ('W', 'West')
      ON CONFLICT (code) DO UPDATE SET name = excluded.name
      RETURNING id, code;
    `);

    const zoneMap = new Map<string, string>();
    for (const r of zonesRes.rows) {
      zoneMap.set(r.code, r.id);
    }

    const northZoneId = zoneMap.get('N');
    const neZoneId = zoneMap.get('NE');
    const southZoneId = zoneMap.get('S');
    const eastZoneId = zoneMap.get('E');
    const westZoneId = zoneMap.get('W');

    if (northZoneId) {
      await client.query(`
        INSERT INTO regions (name, zone_id) VALUES
          ('North Zone (HQ / Delhi NCR / UP / Punjab / J&K)', '${northZoneId}')
        ON CONFLICT (name, zone_id) DO NOTHING;
      `);
    }
    if (neZoneId) {
      await client.query(`
        INSERT INTO regions (name, zone_id) VALUES
          ('North East Zone (Assam / Meghalaya / Nagaland / Manipur)', '${neZoneId}')
        ON CONFLICT (name, zone_id) DO NOTHING;
      `);
    }
    if (eastZoneId) {
      await client.query(`
        INSERT INTO regions (name, zone_id) VALUES
          ('East Zone (WB / Bihar / Odisha / Jharkhand)', '${eastZoneId}')
        ON CONFLICT (name, zone_id) DO NOTHING;
      `);
    }
    if (westZoneId) {
      await client.query(`
        INSERT INTO regions (name, zone_id) VALUES
          ('West Zone (Maharashtra / Gujarat / Rajasthan / Goa)', '${westZoneId}')
        ON CONFLICT (name, zone_id) DO NOTHING;
      `);
    }
    if (southZoneId) {
      await client.query(`
        INSERT INTO regions (name, zone_id) VALUES
          ('South Zone (Karnataka / TN / Telangana / AP / Kerala)', '${southZoneId}')
        ON CONFLICT (name, zone_id) DO NOTHING;
      `);
    }
    console.log('   ✓ Baseline Zones & Regions configured.');

    // 5. Initial System User Accounts (Authentication Bootstrap)
    console.log('👤 [4/4] Provisioning initial role accounts for authentication...');
    const passwordHash = bcrypt.hashSync('password123', 10);

    const initialUsers = [
      {
        email: 'admin@arihant.com',
        full_name: 'System Admin',
        role: 'admin',
        phone: '+91 98100 00008',
        zone_id: northZoneId,
      },
      {
        email: 'mgmt@arihant.com',
        full_name: 'Rajiv Arihant',
        role: 'management',
        phone: '+91 98100 00001',
        zone_id: northZoneId,
      },
      {
        email: 'regmgr.north@arihant.com',
        full_name: 'Vikram Sharma',
        role: 'regional_manager',
        phone: '+91 98100 00002',
        zone_id: northZoneId,
      },
      {
        email: 'sales.delhi@arihant.com',
        full_name: 'Amit Verma',
        role: 'sales',
        phone: '+91 98100 00003',
        zone_id: northZoneId,
      },
      {
        email: 'tender@arihant.com',
        full_name: 'Suresh Nair',
        role: 'tender_team',
        phone: '+91 98100 00004',
        zone_id: northZoneId,
      },
      {
        email: 'demo@arihant.com',
        full_name: 'Ramesh Patel',
        role: 'demo_team',
        phone: '+91 98100 00005',
        zone_id: northZoneId,
      },
      {
        email: 'service@arihant.com',
        full_name: 'Anil Kumar',
        role: 'service_team',
        phone: '+91 98100 00006',
        zone_id: northZoneId,
      },
      {
        email: 'accounts@arihant.com',
        full_name: 'Kavita Rao',
        role: 'accounts',
        phone: '+91 98100 00007',
        zone_id: northZoneId,
      },
    ];

    for (const u of initialUsers) {
      await client.query(`
        INSERT INTO users (full_name, email, phone, role, zone_id, password_hash, is_active)
        VALUES ('${u.full_name}', '${u.email}', '${u.phone}', '${u.role}', ${u.zone_id ? `'${u.zone_id}'` : 'NULL'}, '${passwordHash}', true)
        ON CONFLICT (email) DO UPDATE SET
          full_name = excluded.full_name,
          is_active = true;
      `);
    }
    console.log('   ✓ Initial role accounts verified.');

    await client.query('COMMIT');
    console.log('\n🎉 ALL MIGRATIONS EXECUTED AND RECORDED SUCCESSFULLY!');
    console.log('   Zero mock tenders, leads, visits, expenses, or tasks were inserted.');
    console.log('   Database is clean and ready for operations.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, rolled back changes:', err);
    throw err;
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});

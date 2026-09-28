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

// Load environment variables from apps/api/.env
const envPath = path.join(rootDir, 'apps/api/.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres.eolmveanrgghqzayqtby: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@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

console.log('🚀 Starting Arihant BOS Database Migration to Supabase...');
console.log(`Connecting to: ${connectionString.split('@')[1] || connectionString}`);

const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
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
  console.log('✅ Connected to Supabase PostgreSQL database.');

  try {
    await client.query('BEGIN');

    // 1. Core Schema (Check if already initialized)
    const checkTable = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';",
    );
    if (checkTable.rows.length === 0) {
      console.log('📜 [1/5] Executing db/schema.sql...');
      const schemaSql = fs.readFileSync(path.join(rootDir, 'db/schema.sql'), 'utf8');
      await client.query(schemaSql);
      console.log('   ✓ db/schema.sql executed successfully.');
    } else {
      console.log('📜 [1/5] Core tables already exist. Skipping db/schema.sql creation.');
    }

    // 2. Migration 001 - Local Auth & UUID default
    console.log('📜 [2/5] Executing db/migrations/001_local_auth.sql...');
    const m1Sql = fs.readFileSync(path.join(rootDir, 'db/migrations/001_local_auth.sql'), 'utf8');
    await client.query(m1Sql);
    console.log('   ✓ db/migrations/001_local_auth.sql executed successfully.');

    // 3. Migration 002 - Stage 0 Foundation (Departments, RBAC matrix, Views, RLS)
    console.log('📜 [3/5] Executing db/migrations/002_stage0_foundation.sql...');
    const m2Sql = fs.readFileSync(path.join(rootDir, 'db/migrations/002_stage0_foundation.sql'), 'utf8');
    await client.query(m2Sql);
    console.log('   ✓ db/migrations/002_stage0_foundation.sql executed successfully.');

    // 3.5. Migration 003 - Module 2 Trips, Employee Activities & Visits Enhancement
    console.log('📜 [3.5/5] Executing db/migrations/003_module2_trips_and_activities.sql...');
    const m3Sql = fs.readFileSync(path.join(rootDir, 'db/migrations/003_module2_trips_and_activities.sql'), 'utf8');
    await client.query(m3Sql);
    console.log('   ✓ db/migrations/003_module2_trips_and_activities.sql executed successfully.');

    // 3.6. Migration 004 - Module 2 Contact Person
    const m4Path = path.join(rootDir, 'db/migrations/004_visit_contact_person.sql');
    if (fs.existsSync(m4Path)) {
      console.log('📜 [3.6/5] Executing db/migrations/004_visit_contact_person.sql...');
      const m4Sql = fs.readFileSync(m4Path, 'utf8');
      await client.query(m4Sql);
      console.log('   ✓ db/migrations/004_visit_contact_person.sql executed successfully.');
    }

    // 3.7. Migration 005 - Module 3 Demo Management
    const m5Path = path.join(rootDir, 'db/migrations/005_module3_demo_management.sql');
    if (fs.existsSync(m5Path)) {
      console.log('📜 [3.7/5] Executing db/migrations/005_module3_demo_management.sql...');
      const m5Sql = fs.readFileSync(m5Path, 'utf8');
      await client.query(m5Sql);
      console.log('   ✓ db/migrations/005_module3_demo_management.sql executed successfully.');
    }

    // 3.8. Migration 006 - Module 5 Proposal Management
    const m6Path = path.join(rootDir, 'db/migrations/006_proposal_management.sql');
    if (fs.existsSync(m6Path)) {
      console.log('📜 [3.8/5] Executing db/migrations/006_proposal_management.sql...');
      const m6Sql = fs.readFileSync(m6Path, 'utf8');
      await client.query(m6Sql);
      console.log('   ✓ db/migrations/006_proposal_management.sql executed successfully.');
    }

    // 3.9. Migration 007 - Module 4 Tender Management EDA
    const m7Path = path.join(rootDir, 'db/migrations/007_tender_management_eda.sql');
    if (fs.existsSync(m7Path)) {
      console.log('📜 [3.9/5] Executing db/migrations/007_tender_management_eda.sql...');
      const m7Sql = fs.readFileSync(m7Path, 'utf8');
      await client.query(m7Sql);
      console.log('   ✓ db/migrations/007_tender_management_eda.sql executed successfully.');
    }

    // 3.10. Migration 008 - Module 1 Lead & Customer Management EDA
    const m8Path = path.join(rootDir, 'db/migrations/008_lead_and_customer_eda.sql');
    if (fs.existsSync(m8Path)) {
      console.log('📜 [3.10/5] Executing db/migrations/008_lead_and_customer_eda.sql...');
      const m8Sql = fs.readFileSync(m8Path, 'utf8');
      await client.query(m8Sql);
      console.log('   ✓ db/migrations/008_lead_and_customer_eda.sql executed successfully.');
    }

    // 3.11. Migration 009 - Module 4 Tender Compatibility Columns & Triggers
    const m9Path = path.join(rootDir, 'db/migrations/009_tender_compatibility_columns.sql');
    if (fs.existsSync(m9Path)) {
      console.log('📜 [3.11/5] Executing db/migrations/009_tender_compatibility_columns.sql...');
      const m9Sql = fs.readFileSync(m9Path, 'utf8');
      await client.query(m9Sql);
      console.log('   ✓ db/migrations/009_tender_compatibility_columns.sql executed successfully.');
    }

    // 3.12. Migrations 010 to 015
    const additionalMigrations = [
      '010_tender_win_loss_issues.sql',
      '011_tender_management_specification.sql',
      '012_tender_portal_issues_alignment.sql',
      '013_lead_and_org_department.sql',
      '014_lead_category_new_lead.sql',
      '015_proposal_management_specification.sql',
    ];
    for (const mName of additionalMigrations) {
      const mPath = path.join(rootDir, 'db/migrations', mName);
      if (fs.existsSync(mPath)) {
        console.log(`📜 Executing db/migrations/${mName}...`);
        const mSql = fs.readFileSync(mPath, 'utf8');
        await client.query(mSql);
        console.log(`   ✓ db/migrations/${mName} executed successfully.`);
      }
    }

    // 4. Baseline Zones & Regions (Essential Master References)
    console.log('🌍 [4/5] Seeding baseline Zones & Regions masters...');
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
    console.log('👤 [5/5] Provisioning initial role accounts for authentication...');
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
          password_hash = excluded.password_hash,
          is_active = true;
      `);
    }
    console.log('   ✓ Initial role accounts provisioned (Password: password123).');

    await client.query('COMMIT');
    console.log('\n🎉 ALL MIGRATIONS PUSHED TO SUPABASE SUCCESSFULLY!');
    console.log('   Zero mock tenders, leads, visits, expenses, or tasks were inserted.');
    console.log('   Database is clean and ready for production operations.');
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

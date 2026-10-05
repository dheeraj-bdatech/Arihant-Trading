import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
});

async function runSeed() {
  console.log('🚀 Starting Arihant BOS Database Seed...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Clean existing data in reverse dependency order
    console.log('🧹 Clearing existing data...');
    await client.query(`
      TRUNCATE TABLE
        audit_log, notifications, attachments, task_blockers, tasks,
        expenses, service_reports, service_tickets, proposals,
        tender_outcomes, tender_status_history, tenders,
        demo_outcomes, demo_reservations, demos, demo_equipment,
        visit_updates, visits, interactions, leads, contacts,
        organisations, users, products, regions, zones
      CASCADE;
    `);

    // 2. Seed Zones
    console.log('🌍 Seeding Zones...');
    const zonesRes = await client.query(`
      INSERT INTO zones (code, name) VALUES
        ('N', 'North'),
        ('NE', 'North East'),
        ('S', 'South'),
        ('E', 'East'),
        ('W', 'West')
      RETURNING id, code, name;
    `);
    const zonesMap = new Map<string, string>();
    for (const r of zonesRes.rows) {
      zonesMap.set(r.code, r.id);
    }

    // 3. Seed Regions
    console.log('📍 Seeding Regions...');
    const northZoneId = zonesMap.get('N')!;
    const neZoneId = zonesMap.get('NE')!;
    const eastZoneId = zonesMap.get('E')!;
    const westZoneId = zonesMap.get('W')!;
    const southZoneId = zonesMap.get('S')!;

    const regionsRes = await client.query(`
      INSERT INTO regions (name, zone_id) VALUES
        ('Delhi NCR', '${northZoneId}'),
        ('Punjab & Chandigarh', '${northZoneId}'),
        ('Haryana', '${northZoneId}'),
        ('Rajasthan', '${northZoneId}'),
        ('Uttar Pradesh', '${northZoneId}'),
        ('Jammu & Kashmir', '${northZoneId}'),
        ('Assam', '${neZoneId}'),
        ('Meghalaya', '${neZoneId}'),
        ('Mizoram', '${neZoneId}'),
        ('West Bengal', '${eastZoneId}'),
        ('Bihar', '${eastZoneId}'),
        ('Maharashtra', '${westZoneId}'),
        ('Karnataka', '${southZoneId}')
      RETURNING id, name, zone_id;
    `);
    const regionsMap = new Map<string, string>();
    for (const r of regionsRes.rows) {
      regionsMap.set(r.name, r.id);
    }

    // 4. Seed Products
    console.log('🛡️ Seeding Products...');
    const productsData = [
      { name: 'X-Ray Based Full Body Scanner System', category: 'Security Screening Equipments', make: 'Arihant / Rapiscan', is_mha_qr: true, spec_ref: 'MHA-QR-FBS-2026' },
      { name: 'Hand-Held Backscatter Imaging System', category: 'Security Screening Equipments', make: 'Arihant / VisiScan', is_mha_qr: true, spec_ref: 'MHA-QR-HHB-01' },
      { name: 'Hand-Held / Wireless Real Time Viewing System (RTVS)', category: 'Security Screening Equipments', make: 'Arihant / Zistos', is_mha_qr: true, spec_ref: 'MHA-QR-RTVS-V2' },
      { name: 'NMS20 Hand-Held Metal Detector', category: 'Security Screening Equipments', make: 'Arihant Security', is_mha_qr: true, spec_ref: 'MHA-QR-HHMD-NMS20' },
      { name: 'NMS30 Hand-Held Metal Detector', category: 'Security Screening Equipments', make: 'Arihant Security', is_mha_qr: true, spec_ref: 'MHA-QR-HHMD-NMS30' },
      { name: 'Pointer Hand-Held Precision Metal Detector', category: 'Security Screening Equipments', make: 'Arihant Security', is_mha_qr: false, spec_ref: 'ATC-PTR-11' },
      { name: 'Multi-Zone Door Frame Metal Detector (DFMD)', category: 'Protective & Tactical Solutions', make: 'Arihant / Garrett', is_mha_qr: true, spec_ref: 'MHA-QR-DFMD-MZ' },
      { name: 'NIJ Level 4 Shield & Carry System', category: 'Protective & Tactical Solutions', make: 'Arihant Tactical', is_mha_qr: true, spec_ref: 'NIJ-0108.01-IV' },
      { name: 'Telescopic Pole Detector System', category: 'Protective & Tactical Solutions', make: 'Arihant Security', is_mha_qr: true, spec_ref: 'ATC-POL-24' },
      { name: 'First Responder Tactical Protective Barrier', category: 'Protective & Tactical Solutions', make: 'Arihant Tactical', is_mha_qr: true, spec_ref: 'ATC-FRB-01' },
      { name: 'BP Morcha (Ballistic Protection Portable Post)', category: 'Protective & Tactical Solutions', make: 'Arihant Defence', is_mha_qr: true, spec_ref: 'MHA-QR-BPM-2025' },
      { name: 'Ballistic Tactical Eyewear (Raider)', category: 'Protective & Tactical Solutions', make: 'Arihant Tactical', is_mha_qr: false, spec_ref: 'MIL-PRF-32432A' },
      { name: 'Concealable Ballistic T-Shirt', category: 'Protective & Tactical Solutions', make: 'Arihant Protective', is_mha_qr: false, spec_ref: 'ATC-CBT-02' },
      { name: 'Tactical Ballistic Vest (Modular Body Armour)', category: 'Protective & Tactical Solutions', make: 'Arihant Protective', is_mha_qr: true, spec_ref: 'MHA-QR-BV-V3' },
      { name: 'Convertible Multipurpose Tactical Shield', category: 'Protective & Tactical Solutions', make: 'Arihant Tactical', is_mha_qr: true, spec_ref: 'ATC-CMS-04' },
      { name: 'Anti-Drone Ballistic Tunnel System', category: 'Protective & Tactical Solutions', make: 'Arihant Defence', is_mha_qr: true, spec_ref: 'ATC-ADT-2026' },
      { name: 'Unmanned Ground Vehicle (UGV / EOD Bomb Disposal Robot)', category: 'EOD, Explosive & Specialised Detection', make: 'Arihant Robotics', is_mha_qr: true, spec_ref: 'MHA-QR-UGV-EOD' },
      { name: 'Serstech Raman Spectroscopy Chemical & Narcotics Detector', category: 'EOD, Explosive & Specialised Detection', make: 'Serstech / Arihant', is_mha_qr: true, spec_ref: 'ATC-SRT-RAMAN' },
      { name: 'Deep Search Mine Detector (DSMD)', category: 'EOD, Explosive & Specialised Detection', make: 'Vallon / Arihant', is_mha_qr: true, spec_ref: 'MHA-QR-DSMD-V3' },
      { name: 'Non-Linear Junction Evaluator (NLJD)', category: 'EOD, Explosive & Specialised Detection', make: 'Arihant Surveillance', is_mha_qr: true, spec_ref: 'MHA-QR-NLJD-2025' },
      { name: 'Ferromagnetic Bomb Locator & Magnetometer', category: 'EOD, Explosive & Specialised Detection', make: 'Arihant Detection', is_mha_qr: true, spec_ref: 'ATC-BLM-02' },
      { name: 'Professional Sound Level & Noise Survey Meter', category: 'Environmental & Workplace Safety', make: 'Arihant Safety', is_mha_qr: false, spec_ref: 'IEC-61672-CLASS1' },
      { name: 'Heat Stress & Wet Bulb Globe Monitor', category: 'Environmental & Workplace Safety', make: 'Arihant Safety', is_mha_qr: false, spec_ref: 'ISO-7243-WBGT' },
      { name: 'Connected Tactical Personal Safety Monitoring Band', category: 'Environmental & Workplace Safety', make: 'Arihant Wearables', is_mha_qr: false, spec_ref: 'ATC-PSB-IOT' },
      { name: 'Omnitrak Wireless Multi-Parameter Smart Hygiene Station', category: 'Environmental & Workplace Safety', make: 'Omnitrak / Arihant', is_mha_qr: false, spec_ref: 'ATC-OMNI-HQ' },
      { name: 'Ultrasonic Speech Protection & Anti-Recording System', category: 'Intelligence & Communication Solutions', make: 'Arihant Cyber & Intel', is_mha_qr: false, spec_ref: 'ATC-SPS-PRO' },
      { name: 'ATC Digital Tactical Voice & IP Logger', category: 'Intelligence & Communication Solutions', make: 'Arihant Telecom', is_mha_qr: true, spec_ref: 'ATC-DVL-64' },
      { name: 'Correctional Cellular Intelligence & RF Firewall Platform', category: 'Intelligence & Communication Solutions', make: 'Arihant Cyber & Intel', is_mha_qr: true, spec_ref: 'MHA-QR-CIM-PRISON' },
      { name: 'Rapid Inflatable Field Command Tent & Medical Shelter', category: 'Emergency, Rescue & Field Support', make: 'Arihant Rescue', is_mha_qr: true, spec_ref: 'NDRF-SPEC-TENT-40' },
      { name: 'Tactical Rescue Evacuation Sheet', category: 'Emergency, Rescue & Field Support', make: 'Arihant Rescue', is_mha_qr: false, spec_ref: 'ATC-RSC-SHT' },
      { name: 'IP68 Tactical Search Light System', category: 'Emergency, Rescue & Field Support', make: 'Arihant Illumination', is_mha_qr: true, spec_ref: 'MHA-QR-SL-IP68' },
      { name: 'Tactical Portable Off-Grid Solar Power Charger', category: 'Emergency, Rescue & Field Support', make: 'Arihant Power', is_mha_qr: false, spec_ref: 'ATC-SOL-120' },
      { name: 'Modular Injured Personnel Carrier System', category: 'Emergency, Rescue & Field Support', make: 'Arihant Medical', is_mha_qr: true, spec_ref: 'ATC-IPC-TACTICAL' },
      { name: 'Rapid Field Emergency Splint & Immobilizer Kit', category: 'Emergency, Rescue & Field Support', make: 'Arihant Medical', is_mha_qr: false, spec_ref: 'ATC-SPL-08' }
    ];

    const productsMap = new Map<string, string>();
    for (const p of productsData) {
      const pRes = await client.query(`
        INSERT INTO products (name, category, make, is_mha_qr, spec_ref)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name;
      `, [p.name, p.category, p.make, p.is_mha_qr, p.spec_ref]);
      productsMap.set(p.name, pRes.rows[0].id);
    }

    // 5. Seed Users (30 users, all 8 roles, hierarchical reporting tree)
    console.log('👥 Seeding Users across all 8 roles...');
    const defaultPasswordHash = bcrypt.hashSync('password123', 10);

    const delhiId = regionsMap.get('Delhi NCR')!;
    const assamId = regionsMap.get('Assam')!;
    const wbId = regionsMap.get('West Bengal')!;
    const rajId = regionsMap.get('Rajasthan')!;
    const punjabId = regionsMap.get('Punjab & Chandigarh')!;
    const upId = regionsMap.get('Uttar Pradesh')!;
    const biharId = regionsMap.get('Bihar')!;

    // 1. Top Management
    const mgmtRes = await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'Rajesh Arihant', 'mgmt@arihant.com', '+919811001100', 'management', NULL, NULL, NULL, true, $1),
        ('11111111-1111-1111-1111-111111111112', 'Sunita Arihant', 'mgmt.director@arihant.com', '+919811001101', 'management', NULL, NULL, NULL, true, $1),
        ('88888888-8888-8888-8888-888888888888', 'System Admin', 'admin@arihant.com', '+919811001108', 'admin', NULL, NULL, NULL, true, $1)
      RETURNING id, email, role;
    `, [defaultPasswordHash]);

    const rajeshId = '11111111-1111-1111-1111-111111111111';

    // 2. Regional Managers
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('22222222-2222-2222-2222-222222222221', 'Vikram Sharma', 'regmgr.north@arihant.com', '+919811002201', 'regional_manager', '${delhiId}', '${northZoneId}', '${rajeshId}', true, $1),
        ('22222222-2222-2222-2222-222222222222', 'Debanjan Sen', 'regmgr.ne@arihant.com', '+919811002202', 'regional_manager', '${assamId}', '${neZoneId}', '${rajeshId}', true, $1),
        ('22222222-2222-2222-2222-222222222223', 'Pradeep Roy', 'regmgr.east@arihant.com', '+919811002203', 'regional_manager', '${wbId}', '${eastZoneId}', '${rajeshId}', true, $1)
    `, [defaultPasswordHash]);

    const vikramId = '22222222-2222-2222-2222-222222222221';
    const debanjanId = '22222222-2222-2222-2222-222222222222';
    const pradeepId = '22222222-2222-2222-2222-222222222223';

    // 3. Tender Team
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('44444444-4444-4444-4444-444444444441', 'Suresh Nair', 'tender@arihant.com', '+919811004401', 'tender_team', '${delhiId}', '${northZoneId}', '${rajeshId}', true, $1),
        ('44444444-4444-4444-4444-444444444442', 'Priya Das', 'tender.exec@arihant.com', '+919811004402', 'tender_team', '${delhiId}', '${northZoneId}', '44444444-4444-4444-4444-444444444441', true, $1),
        ('44444444-4444-4444-4444-444444444443', 'Aniket Joshi', 'tender.analyst@arihant.com', '+919811004403', 'tender_team', '${delhiId}', '${northZoneId}', '44444444-4444-4444-4444-444444444441', true, $1)
    `, [defaultPasswordHash]);

    const sureshId = '44444444-4444-4444-4444-444444444441';

    // 4. Sales Team
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('33333333-3333-3333-3333-333333333331', 'Amit Verma', 'sales.delhi@arihant.com', '+919811003301', 'sales', '${delhiId}', '${northZoneId}', '${vikramId}', true, $1),
        ('33333333-3333-3333-3333-333333333332', 'Pooja Mehta', 'sales.jaipur@arihant.com', '+919811003302', 'sales', '${rajId}', '${northZoneId}', '${vikramId}', true, $1),
        ('33333333-3333-3333-3333-333333333333', 'Hardeep Singh', 'sales.punjab@arihant.com', '+919811003303', 'sales', '${punjabId}', '${northZoneId}', '${vikramId}', true, $1),
        ('33333333-3333-3333-3333-333333333334', 'Rahul Rawat', 'sales.guwahati@arihant.com', '+919811003304', 'sales', '${assamId}', '${neZoneId}', '${debanjanId}', true, $1),
        ('33333333-3333-3333-3333-333333333335', 'Biplab Barman', 'sales.mizoram@arihant.com', '+919811003305', 'sales', '${regionsMap.get('Mizoram')}', '${neZoneId}', '${debanjanId}', true, $1),
        ('33333333-3333-3333-3333-333333333336', 'Gaurav Dubey', 'sales.lucknow@arihant.com', '+919811003306', 'sales', '${upId}', '${northZoneId}', '${vikramId}', true, $1),
        ('33333333-3333-3333-3333-333333333337', 'Sneha Ganguly', 'sales.kolkata@arihant.com', '+919811003307', 'sales', '${wbId}', '${eastZoneId}', '${pradeepId}', true, $1)
    `, [defaultPasswordHash]);

    const amitId = '33333333-3333-3333-3333-333333333331';
    const poojaId = '33333333-3333-3333-3333-333333333332';
    const rahulId = '33333333-3333-3333-3333-333333333334';

    // 5. Demo Team
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('55555555-5555-5555-5555-555555555551', 'Ramesh Patel', 'demo@arihant.com', '+919811005501', 'demo_team', '${delhiId}', '${northZoneId}', '${vikramId}', true, $1),
        ('55555555-5555-5555-5555-555555555552', 'Sunil Ghosh', 'demo.east@arihant.com', '+919811005502', 'demo_team', '${wbId}', '${eastZoneId}', '${pradeepId}', true, $1),
        ('55555555-5555-5555-5555-555555555553', 'Rakesh Meena', 'demo.patna@arihant.com', '+919811005503', 'demo_team', '${biharId}', '${eastZoneId}', '${pradeepId}', true, $1),
        ('55555555-5555-5555-5555-555555555554', 'Bikash Das', 'demo.assam@arihant.com', '+919811005504', 'demo_team', '${assamId}', '${neZoneId}', '${debanjanId}', true, $1)
    `, [defaultPasswordHash]);

    const rameshId = '55555555-5555-5555-5555-555555555551';

    // 6. Service Team
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('66666666-6666-6666-6666-666666666661', 'Anil Kumar', 'service@arihant.com', '+919811006601', 'service_team', '${delhiId}', '${northZoneId}', '${vikramId}', true, $1),
        ('66666666-6666-6666-6666-666666666662', 'Manoj Tiwari', 'service.field@arihant.com', '+919811006602', 'service_team', '${upId}', '${northZoneId}', '66666666-6666-6666-6666-666666666661', true, $1),
        ('66666666-6666-6666-6666-666666666663', 'Subhashish Paul', 'service.ne@arihant.com', '+919811006603', 'service_team', '${assamId}', '${neZoneId}', '${debanjanId}', true, $1),
        ('66666666-6666-6666-6666-666666666664', 'Deepak Saini', 'service.punjab@arihant.com', '+919811006604', 'service_team', '${punjabId}', '${northZoneId}', '66666666-6666-6666-6666-666666666661', true, $1)
    `, [defaultPasswordHash]);

    const anilId = '66666666-6666-6666-6666-666666666661';

    // 7. Accounts Team
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('77777777-7777-7777-7777-777777777771', 'Kavita Rao', 'accounts@arihant.com', '+919811007701', 'accounts', '${delhiId}', '${northZoneId}', '${rajeshId}', true, $1),
        ('77777777-7777-7777-7777-777777777772', 'Sanjay Gupta', 'accounts.exec@arihant.com', '+919811007702', 'accounts', '${delhiId}', '${northZoneId}', '77777777-7777-7777-7777-777777777771', true, $1),
        ('77777777-7777-7777-7777-777777777773', 'Meenakshi Sundaram', 'accounts.audit@arihant.com', '+919811007703', 'accounts', '${delhiId}', '${northZoneId}', '77777777-7777-7777-7777-777777777771', true, $1)
    `, [defaultPasswordHash]);

    // 8. Additional 4 users to bring total to 28
    await client.query(`
      INSERT INTO users (id, full_name, email, phone, role, region_id, zone_id, reporting_manager_id, is_active, password_hash)
      VALUES
        ('33333333-3333-3333-3333-333333333338', 'Naveen Bhatt', 'sales.dehradun@arihant.com', '+919811003308', 'sales', '${upId}', '${northZoneId}', '${vikramId}', true, $1),
        ('33333333-3333-3333-3333-333333333339', 'Arup Mazumdar', 'sales.tripura@arihant.com', '+919811003309', 'sales', '${assamId}', '${neZoneId}', '${debanjanId}', true, $1),
        ('55555555-5555-5555-5555-555555555555', 'Devendra Yadav', 'demo.chandigarh@arihant.com', '+919811005505', 'demo_team', '${punjabId}', '${northZoneId}', '${vikramId}', true, $1),
        ('66666666-6666-6666-6666-666666666665', 'Santosh Sharma', 'service.rajasthan@arihant.com', '+919811006605', 'service_team', '${rajId}', '${northZoneId}', '${anilId}', true, $1)
    `, [defaultPasswordHash]);

    // 6. Seed Demo Equipment (Patna, Delhi, Kolkata)
    console.log('📦 Seeding Demo Equipment across Delhi, Patna, Kolkata...');
    const demoEquipData = [
      { product: 'Hand Held Metal Detector as per MHA QR (Q2)', model: 'MD-PRO-800', serial: 'HHMD-DEL-01', loc: 'Delhi', user: rameshId, status: 'available', cond: 'Brand New' },
      { product: 'Hand Held Metal Detector as per MHA QR (Q2)', model: 'MD-PRO-800', serial: 'HHMD-PAT-02', loc: 'Patna', user: '55555555-5555-5555-5555-555555555553', status: 'available', cond: 'Good' },
      { product: 'Door Frame Metal Detector (Q2)', model: 'DFMD-MULTI-9', serial: 'DFMD-DEL-01', loc: 'Delhi', user: rameshId, status: 'reserved', cond: 'Calibrated', until: '2026-09-25' },
      { product: 'Door Frame Metal Detector (Q2)', model: 'DFMD-MULTI-9', serial: 'DFMD-KOL-02', loc: 'Kolkata', user: '55555555-5555-5555-5555-555555555552', status: 'available', cond: 'Good' },
      { product: 'thermal imager (Q2)', model: 'TI-VISION-300', serial: 'TI-DEL-01', loc: 'Delhi', user: rameshId, status: 'in_use', cond: 'Operational', until: '2026-09-20' },
      { product: 'thermal imager (Q2)', model: 'TI-VISION-300', serial: 'TI-PAT-02', loc: 'Patna', user: '55555555-5555-5555-5555-555555555553', status: 'available', cond: 'Good' },
      { product: 'Passive Night Vision Monocular as per MHA QR (V2) (Q2)', model: 'NVM-GEN3-PLUS', serial: 'NV-DEL-01', loc: 'Delhi', user: rameshId, status: 'available', cond: 'Tested' },
      { product: 'Passive Night Vision Monocular as per MHA QR (V2) (Q2)', model: 'NVM-GEN3-PLUS', serial: 'NV-KOL-02', loc: 'Kolkata', user: '55555555-5555-5555-5555-555555555552', status: 'maintenance', cond: 'Battery Replacement' },
      { product: 'Breath Analyser (Q3)', model: 'ALCO-SAFE-V', serial: 'BA-DEL-01', loc: 'Delhi', user: rameshId, status: 'available', cond: 'Calibrated' },
      { product: 'K - 4 Crash Rated Boom Barrier (Q3)', model: 'BB-CRASH-K4', serial: 'BOOM-DEL-DEMO', loc: 'Delhi', user: rameshId, status: 'available', cond: 'Demo Skid Mount' },
    ];

    const demoEquipMap = new Map<string, string>();
    for (const de of demoEquipData) {
      const prodId = productsMap.get(de.product)!;
      const res = await client.query(`
        INSERT INTO demo_equipment (product_id, model, serial_no, current_location, responsible_person, availability_status, condition, reserved_until)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, serial_no;
      `, [prodId, de.model, de.serial, de.loc, de.user, de.status, de.cond, de.until || null]);
      demoEquipMap.set(de.serial, res.rows[0].id);
    }

    // 7. Seed Organisations & Contacts
    console.log('🏢 Seeding Organisations & Contacts...');
    const rawTenders: any[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'tenders_extracted.json'), 'utf-8'));

    const orgsMap = new Map<string, string>();
    const orgNames = Array.from(new Set(rawTenders.map(t => t.organisation_name).filter(Boolean)));

    for (const orgName of orgNames) {
      const zoneCode = rawTenders.find(t => t.organisation_name === orgName)?.zone || 'N';
      const zoneId = zonesMap.get(zoneCode) || northZoneId;
      const sampleLoc = rawTenders.find(t => t.organisation_name === orgName)?.location || 'New Delhi';

      const orgRes = await client.query(`
        INSERT INTO organisations (name, sector, is_govt, city, state, zone_id, region_id, created_by)
        VALUES ($1, $2, true, $3, $4, $5, $6, $7)
        RETURNING id, name;
      `, [
        orgName,
        orgName.includes('Army') || orgName.includes('Air Force') || orgName.includes('Bsf') ? 'Defence' :
        orgName.includes('Police') ? 'Police' :
        orgName.includes('Railway') ? 'Railways' :
        orgName.includes('Nuclear') ? 'Nuclear / Energy' : 'Government',
        sampleLoc,
        zoneCode === 'N' ? 'Delhi' : 'Assam',
        zoneId,
        zoneCode === 'N' ? delhiId : assamId,
        amitId
      ]);
      const orgId = orgRes.rows[0].id;
      orgsMap.set(orgName, orgId);

      // Add a primary contact
      await client.query(`
        INSERT INTO contacts (organisation_id, full_name, designation, mobile, email, is_primary)
        VALUES ($1, $2, $3, $4, $5, true)
      `, [
        orgId,
        `Officer In-Charge (${sampleLoc})`,
        'Director / Procurement In-Charge',
        `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
        `procurement@${orgName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 12)}.gov.in`
      ]);
    }

    // 8. Seed Tenders (All 30 rows from North Live Tender Sheet!)
    console.log(`📑 Seeding all ${rawTenders.length} real GeM Tenders...`);
    const tenderStatuses = [
      'under_preparation', 'submitted', 'technical_eval', 'awaiting_approval',
      'identified', 'won', 'lost', 'under_preparation', 'submitted', 'under_preparation'
    ];

    for (let i = 0; i < rawTenders.length; i++) {
      const rt = rawTenders[i];
      const orgId = orgsMap.get(rt.organisation_name) || null;
      const zoneId = zonesMap.get(rt.zone) || northZoneId;
      const regionId = rt.zone === 'NE' ? assamId : delhiId;

      // Match product or fallback
      let productId = productsMap.get(rt.product_requirement);
      if (!productId) {
        // partial match
        for (const [pname, pid] of productsMap.entries()) {
          if (rt.product_requirement && (rt.product_requirement.includes(pname.substring(0, 15)) || pname.includes(rt.product_requirement.substring(0, 15)))) {
            productId = pid;
            break;
          }
        }
      }
      if (!productId) {
        productId = productsMap.get('Hand Held Metal Detector as per MHA QR (Q2)');
      }

      // Assign status
      let st = tenderStatuses[i % tenderStatuses.length];
      if (i === 0) st = 'under_preparation'; // GEM/2026/B/7783548
      if (i === 1) st = 'awaiting_approval'; // GEM/2026/B/7809850 (management approval test!)
      if (i === 29) st = 'under_preparation'; // HAL Breath Analyser closes tomorrow 2026-09-17!

      // Adjust bid_closing_date for tender 0, 1, 29 so they clearly glow as urgent (<=7 days) or active
      let closeDate = rt.bid_closing_date;
      if (i === 29) {
        // Closes in 1 day! (2026-09-17 09:00:00+05:30)
        closeDate = '2026-09-17 09:00:00+05:30';
      } else if (i === 0) {
        // Closes in 4 days!
        closeDate = '2026-09-20 11:00:00+05:30';
      } else if (i === 1) {
        // Closes in 6 days!
        closeDate = '2026-09-22 14:00:00+05:30';
      }

      const assignedUser = i % 2 === 0 ? sureshId : '44444444-4444-4444-4444-444444444442';

      const tRes = await client.query(`
        INSERT INTO tenders (
          tender_no, organisation_id, department, product_id, requirement_text,
          city, state, zone_id, region_id, category, quantity,
          bidder_turnover, oem_turnover, emd_fee, publish_date,
          bid_start_date, bid_closing_date, prebid_date, corrigendum_date,
          participated_date, assigned_to, tender_owner_id, status, remarks
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23, $24
        ) RETURNING id;
      `, [
        rt.tender_no, orgId, rt.organisation_name, productId, rt.product_requirement,
        rt.location, rt.zone === 'N' ? 'Delhi/North' : 'Assam/NE', zoneId, regionId,
        rt.product_requirement?.includes('MHA QR') ? 'general_mha' : (i % 3 === 0 ? 'pq' : 'other'),
        rt.quantity || 1,
        rt.bidder_turnover, rt.oem_turnover, rt.emd_fee,
        '2026-08-01',
        rt.bid_start_date ? rt.bid_start_date.split(' ')[0] : '2026-08-10',
        closeDate,
        rt.prebid_date ? rt.prebid_date.split(' ')[0] : null,
        rt.corrigendum_date || null,
        rt.participated_date ? rt.participated_date.split(' ')[0] : null,
        assignedUser,
        sureshId,
        st,
        rt.remarks || `Imported GeM tender #${rt.tender_no}`
      ]);

      const tenderId = tRes.rows[0].id;

      // Status history entry
      await client.query(`
        INSERT INTO tender_status_history (tender_id, from_status, to_status, changed_by, remarks)
        VALUES ($1, 'identified', $2, $3, $4)
      `, [tenderId, st, sureshId, 'Initial ingestion from North Master Sheet']);

      // If Won or Lost, add tender outcome
      if (st === 'won') {
        await client.query(`
          INSERT INTO tender_outcomes (tender_id, result, reason, competitor, value_lakh, result_date)
          VALUES ($1, 'won', 'L1 lowest price + full QR compliance', 'Godrej Security', 48.5, '2026-09-01')
        `, [tenderId]);
      } else if (st === 'lost') {
        await client.query(`
          INSERT INTO tender_outcomes (tender_id, result, reason, competitor, value_lakh, result_date)
          VALUES ($1, 'lost', 'pricing', 'Zicom Electronic Security', 32.0, '2026-08-28')
        `, [tenderId]);
      }
    }

    // 9. Seed Leads (Funnel + Bill&Book)
    console.log('🎯 Seeding Sales Leads & Pipeline...');
    const bsfOrgId = orgsMap.get('Force Head Quarter Bsf New Delhi')!;
    const cisfOrgId = orgsMap.get('Central Industrial Security Force (cisf)')!;
    const armyOrgId = orgsMap.get('Indian Army')!;
    const railwayOrgId = orgsMap.get('Northern Railway')!;
    const aaiOrgId = orgsMap.get('Airports Authority Of India')!;

    const leadsData = [
      { org: bsfOrgId, prod: productsMap.get('Hand Held Metal Detector as per MHA QR (Q2)')!, cat: 'active', prob: 'high', val: 75.0, qty: 350, user: amitId, status: 'quoted', qtr: 'Q2 26-27' },
      { org: cisfOrgId, prod: productsMap.get('Door Frame Metal Detector (Q2)')!, cat: 'active', prob: 'high', val: 95.0, qty: 50, user: amitId, status: 'negotiation', qtr: 'Q2 26-27' },
      { org: armyOrgId, prod: productsMap.get('X ray baggage inspection system as per MHA QR (V3) (Q2)')!, cat: 'expected', prob: 'medium', val: 120.0, qty: 4, user: poojaId, status: 'qualified', qtr: 'Q3 26-27' },
      { org: railwayOrgId, prod: productsMap.get('thermal imager (Q2)')!, cat: 'follow_up', prob: 'low', val: 32.0, qty: 6, user: amitId, status: 'open', qtr: 'Q3 26-27' },
      { org: aaiOrgId, prod: productsMap.get('Full Body Scanner')!, cat: 'expected', prob: 'medium', val: 450.0, qty: 3, user: rahulId, status: 'quoted', qtr: 'Q4 26-27' },
      // Won deals (Bill & Book)
      { org: bsfOrgId, prod: productsMap.get('Bomb Blanket as per MHA QR (V2) (Q3)')!, cat: 'active', prob: 'high', val: 18.0, qty: 20, user: amitId, status: 'won', qtr: 'Q1 26-27', booking: 'June 2026', billing: 'August 2026', orderStatus: 'dispatched' },
      { org: cisfOrgId, prod: productsMap.get('Breath Analyser (Q3)')!, cat: 'active', prob: 'high', val: 8.5, qty: 15, user: amitId, status: 'won', qtr: 'Q1 26-27', booking: 'May 2026', billing: 'July 2026', orderStatus: 'billed' }
    ];

    const leadsIds: string[] = [];
    for (const ld of leadsData) {
      const lRes = await client.query(`
        INSERT INTO leads (
          organisation_id, product_id, source, category, probability, channel,
          status, assigned_to, regional_manager_id, bill_qtr,
          qty, value_lakh, booking_month, billing_month, order_status,
          next_followup_date, remarks
        ) VALUES (
          $1, $2, 'GeM / Direct', $3, $4, 'direct',
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          '2026-09-22', 'Priority government requirement'
        ) RETURNING id;
      `, [
        ld.org, ld.prod, ld.cat, ld.prob,
        ld.status, ld.user, vikramId, ld.qtr,
        ld.qty, ld.val, ld.booking || null, ld.billing || null, ld.orderStatus || null
      ]);
      leadsIds.push(lRes.rows[0].id);

      // Customer Timeline Interaction
      await client.query(`
        INSERT INTO interactions (organisation_id, lead_id, type, employee_id, occurred_on, remarks, outcome, next_action)
        VALUES ($1, $2, 'call', $3, '2026-09-10', 'Discussion regarding technical specifications and compliance', 'Positive response', 'Share formal quotation and demo date')
      `, [ld.org, lRes.rows[0].id, ld.user]);
    }

    // 10. Seed Visits (Weekly Plan & Field updates)
    console.log('🚗 Seeding Field Visits & Manager Interventions...');
    const visitRes = await client.query(`
      INSERT INTO visits (
        organisation_id, product_id, planned_by, assigned_to, assigned_by_manager,
        location, planned_date, purpose, demo_required, travel_required, status, remarks
      ) VALUES
        ('${bsfOrgId}', '${productsMap.get('Door Frame Metal Detector (Q2)')}', '${amitId}', '${amitId}', NULL, 'BSF HQ CGO Complex New Delhi', '2026-09-18', 'Pre-bid technical presentation', true, false, 'planned', 'Demonstrate 9-zone detection accuracy'),
        ('${armyOrgId}', '${productsMap.get('thermal imager (Q2)')}', '${poojaId}', '${poojaId}', '${vikramId}', 'Military Station Jodhpur', '2026-09-21', 'Field trial demonstration', true, true, 'planned', 'Manager also-meet: Meet Col. Bhatia in procurement'),
        ('${cisfOrgId}', '${productsMap.get('Hand Held Metal Detector as per MHA QR (Q2)')}', '${amitId}', '${amitId}', NULL, 'CISF Unit Saket Delhi', '2026-09-12', 'Annual maintenance review', false, false, 'completed', 'Completed quarterly security audit')
      RETURNING id, status;
    `);

    // Add visit update for completed visit
    const completedVisitId = visitRes.rows[2].id;
    await client.query(`
      INSERT INTO visit_updates (
        visit_id, met_completed, person_met, discussion, product_discussed,
        outcome, opportunity, demo_required, next_action, updated_by
      ) VALUES (
        $1, true, 'Dy. Commandant Verma', 'Inspected installed DFMD units at terminal gate',
        'Door Frame Metal Detector', 'Client satisfied with sensitivity',
        'Requirements for 10 additional units for North Gate expansion',
        false, 'Send proposal with discounted rate', '${amitId}'
      )
    `, [completedVisitId]);

    // 11. Seed Demos & Reservations & Outcomes
    console.log('🎯 Seeding Demos & Equipment Reservations...');
    const demoRes = await client.query(`
      INSERT INTO demos (
        organisation_id, lead_id, product_id, requested_by, coordinator_id,
        assigned_to, location, requested_date, confirmed_date, expected_audience, status
      ) VALUES
        ('${bsfOrgId}', '${leadsIds[0]}', '${productsMap.get('Door Frame Metal Detector (Q2)')}', '${amitId}', '${vikramId}', '${rameshId}', 'BSF HQ Delhi', '2026-09-22', '2026-09-22', 'DIG & Procurement Committee', 'confirmed'),
        ('${armyOrgId}', '${leadsIds[2]}', '${productsMap.get('thermal imager (Q2)')}', '${poojaId}', '${vikramId}', '${rameshId}', 'Jodhpur Range', '2026-09-08', '2026-09-08', 'Trial Evaluation Board', 'completed')
      RETURNING id;
    `);

    // Reserve equipment
    const dfmdEquipId = demoEquipMap.get('DFMD-DEL-01')!;
    await client.query(`
      INSERT INTO demo_reservations (demo_id, equipment_id, reserved_from, reserved_to, status, approved_by)
      VALUES ($1, $2, '2026-09-21', '2026-09-23', 'approved', '${vikramId}')
    `, [demoRes.rows[0].id, dfmdEquipId]);

    // Demo outcome for completed demo
    await client.query(`
      INSERT INTO demo_outcomes (
        demo_id, completed, customer_response, technical_performance, product_suitability,
        decision_maker_present, result, remarks
      ) VALUES (
        $1, true, 'Excellent clarity in zero-light night test', 'Optimal thermal resolution achieved',
        'Exceeds General Staff Qualitative Requirement (GSQR)', true, 'success',
        'Formal recommendation expected in evaluation committee minutes'
      )
    `, [demoRes.rows[1].id]);

    // 12. Seed Proposals
    console.log('📑 Seeding Proposals...');
    await client.query(`
      INSERT INTO proposals (
        organisation_id, lead_id, product_id, sector, requested_by, responsible_id,
        followup_owner_id, request_date, required_date, sent_date, version, reference,
        status, next_followup, remarks
      ) VALUES
        ('${bsfOrgId}', '${leadsIds[0]}', '${productsMap.get('Hand Held Metal Detector as per MHA QR (Q2)')}', 'Defence', '${amitId}', '${amitId}', '${amitId}', '2026-09-05', '2026-09-10', '2026-09-08', 'v1.2', 'ATC/BSF/2026/092', 'sent', '2026-09-20', 'Quoted per GeM standard terms'),
        ('${cisfOrgId}', '${leadsIds[1]}', '${productsMap.get('Door Frame Metal Detector (Q2)')}', 'Police / Paramilitary', '${amitId}', '${amitId}', '${amitId}', '2026-09-14', '2026-09-18', NULL, 'v1.0', 'ATC/CISF/2026/104', 'under_preparation', '2026-09-18', 'Drafting commercial terms with 3-year AMC')
    `);

    // 13. Seed Service Tickets & Reports
    console.log('🔧 Seeding Service Tickets & Reports...');
    const ticketRes = await client.query(`
      INSERT INTO service_tickets (
        ticket_no, organisation_id, product_id, equipment_serial, location, complaint,
        received_date, priority, warranty_status, assigned_to, planned_visit_date, status
      ) VALUES
        ('TCK-2026-081', '${bsfOrgId}', '${productsMap.get('Door Frame Metal Detector (Q2)')}', 'DFMD-BSF-994', 'Gate 2 BSF Chhawla', 'Zone 4 sensor intermittent false alarms during rain', '2026-09-14', 'high', 'in_warranty', '${anilId}', '2026-09-17', 'visit_scheduled'),
        ('TCK-2026-077', '${railwayOrgId}', '${productsMap.get('X ray baggage inspection system as per MHA QR (V3) (Q2)')}', 'XR-NR-552', 'New Delhi Railway Station Platform 1', 'Conveyor roller belt slippage', '2026-09-02', 'critical', 'amc', '${anilId}', '2026-09-04', 'resolved')
      RETURNING id;
    `);

    // Service report for resolved ticket
    await client.query(`
      INSERT INTO service_reports (
        ticket_id, problem_identified, action_taken, parts_replaced, warranty_status,
        customer_confirmation, further_work_required, submitted_by
      ) VALUES (
        $1, 'Drive roller motor belt tensioner worn out', 'Replaced tensioner spring and calibrated motor alignment',
        'Tensioner Spring #TS-44', 'amc', true, false, '${anilId}'
      )
    `, [ticketRes.rows[1].id]);

    // 14. Seed Expenses (Two-Stage Approval: Submitted -> Manager Approved -> Accounts Processed)
    console.log('💰 Seeding Expenses with Two-Stage Approval Workflow...');
    await client.query(`
      INSERT INTO expenses (
        employee_id, organisation_id, expense_date, category, amount, purpose,
        status, manager_id, manager_remarks, remarks
      ) VALUES
        ('${amitId}', '${bsfOrgId}', '2026-09-14', 'travel', 4850.00, 'Train fare Delhi to Lucknow for pre-bid meeting', 'submitted', '${vikramId}', NULL, 'IRCTC ticket attached'),
        ('${poojaId}', '${armyOrgId}', '2026-09-08', 'hotel', 7200.00, 'Hotel accommodation for Jodhpur night trial', 'manager_approved', '${vikramId}', 'Approved by RM. Valid trial expense.', 'Invoice from Hotel Taj Hari Mahal'),
        ('${anilId}', '${railwayOrgId}', '2026-09-04', 'local_conveyance', 1450.00, 'Cab charges for urgent night service call at NDLS', 'accounts_processed', '${vikramId}', 'Verified emergency call-out', 'Processed for reimbursement via NEFT')
    `);

    // 15. Seed Tasks & Task Blockers
    console.log('📋 Seeding Tasks & Blocker Workflow...');
    const taskRes = await client.query(`
      INSERT INTO tasks (
        title, description, assigned_to, reporting_manager_id, department, priority,
        task_type, start_date, deadline, expected_outcome, status
      ) VALUES
        ('Prepare Bid Documentation for HAL Breath Analyser Tender', 'Collect OEM turnover certificates and test reports for GEM/2026/B/7960533', '${sureshId}', '${rajeshId}', 'Tender', 'critical', 'tender', '2026-09-14', '2026-09-17', 'Full submission before 09:00 AM deadline', 'in_progress'),
        ('Follow up with BSF Procurement regarding EMD Return', 'Submit formal request for refund of ₹2.79 Lakh EMD for tender #7783548', '${amitId}', '${vikramId}', 'Sales', 'high', 'one_time', '2026-09-10', '2026-09-15', 'Receipt acknowledgement letter', 'overdue'),
        ('Deploy X-Ray Scanner Software Patch V3.4 at Platform 1', 'Update firmware on Astrophysics scanner to fix display lag', '${anilId}', '${vikramId}', 'Service', 'medium', 'service', '2026-09-12', '2026-09-18', 'System test OK', 'blocked')
      RETURNING id, title;
    `);

    // Blocker on the 3rd task
    const blockedTaskId = taskRes.rows[2].id;
    await client.query(`
      INSERT INTO task_blockers (task_id, blocker_type, description, raised_by)
      VALUES ($1, 'customer', 'Station Master permission required for platform work during daytime. Awaiting night shift slot approval.', '${anilId}')
    `, [blockedTaskId]);

    // 16. Seed Notifications
    console.log('🔔 Seeding Notifications...');
    await client.query(`
      INSERT INTO notifications (user_id, type, title, body, entity_type, is_read)
      VALUES
        ('${sureshId}', 'tender_deadline', 'URGENT: HAL Breath Analyser tender closes tomorrow!', 'Tender GEM/2026/B/7960533 closes at 09:00 AM on 17 Sep 2026.', 'tender', false),
        ('${rajeshId}', 'tender_approval', 'Management Approval Required: Indian Army Tender', 'Tender GEM/2026/B/7809850 requires management participation approval.', 'tender', false),
        ('${vikramId}', 'expense_approval', 'New Expense Submitted for Approval', 'Amit Verma submitted ₹ 4,850.00 travel expense for BSF meeting.', 'expense', false),
        ('${vikramId}', 'task_blocked', 'Service Task Blocked: Station Master Permission', 'Anil Kumar reported a customer blocker on X-Ray patch task.', 'task', false)
    `);

    // 17. Seed Initial Audit Log
    console.log('📜 Seeding Audit Trail...');
    await client.query(`
      INSERT INTO audit_log (actor_id, entity_type, entity_id, action, previous_value, new_value)
      VALUES
        ('${rajeshId}', 'system', '${rajeshId}', 'seed_initialized', NULL, '{"status": "complete", "version": "1.0"}'),
        ('${sureshId}', 'tender', '11111111-1111-1111-1111-111111111111', 'status_change', '{"status": "identified"}', '{"status": "under_preparation"}')
    `);

    await client.query('COMMIT');
    console.log('✅ Arihant BOS Database Seed Completed Successfully!');

    // Row Count Summary
    const tables = [
      'zones', 'regions', 'products', 'users', 'demo_equipment',
      'organisations', 'contacts', 'tenders', 'tender_status_history', 'tender_outcomes',
      'leads', 'interactions', 'visits', 'visit_updates', 'demos', 'demo_reservations',
      'demo_outcomes', 'proposals', 'service_tickets', 'service_reports', 'expenses',
      'tasks', 'task_blockers', 'notifications', 'audit_log'
    ];

    console.log('\n📊 DATABASE SEED ROW COUNT SUMMARY:');
    console.log('-------------------------------------------');
    for (const tbl of tables) {
      const cntRes = await pool.query(`SELECT COUNT(*) FROM ${tbl}`);
      console.log(`  • ${tbl.padEnd(25)}: ${cntRes.rows[0].count} rows`);
    }
    console.log('-------------------------------------------\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed();

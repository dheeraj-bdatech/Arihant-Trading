/**
 * Jest setup for the e2e suites (they wipe tables). Runs before AppModule loads, so it decides which database the
 * app connects to: an explicit DATABASE_URL wins, otherwise the local `arihant_e2e` database. Anything whose
 * database name does not mark it as a test database (…e2e… / …test…) stops the run — never the dev or prod data.
 */
const fallback = 'postgresql://postgres:postgres@localhost:5432/arihant_e2e';
const url = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || fallback;
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();

if (!/(e2e|test)/i.test(dbName)) {
  throw new Error(
    `Refusing to run e2e tests against database "${dbName || url}". The suites delete data; point DATABASE_URL (or E2E_DATABASE_URL) at a test database such as arihant_e2e.`,
  );
}

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;

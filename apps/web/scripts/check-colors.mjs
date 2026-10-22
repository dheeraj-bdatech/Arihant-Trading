// Fails when UI code uses default Tailwind colour palettes or bare locale date formatting (red-50, gray-500, emerald-600, blue-*, …) instead of the
// Executive Linen brand tokens listed in AGENTS.md ("Semantic Status Colours"). Run: pnpm --filter @arihant/web lint:colors
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
const PALETTE =
  /(?<![\w\-[#])(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|from|via|to|fill|stroke|divide|outline|shadow|accent|decoration|placeholder|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?![\w-])/g;

// Dates are formatted through formatDateIN / formatDateTimeIN (IST, DD/MM/YYYY); a bare toLocaleDateString() shows
// the browser's own order and time zone.
const BARE_DATE = /\.toLocale(?:Date|Time)String\(\s*(?:'en-IN'\s*)?\)/g;

const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(PALETTE)) hits.push(`${relative(ROOT, p)}:${i + 1}  ${m[0]}`);
        for (const m of line.matchAll(BARE_DATE)) hits.push(`${relative(ROOT, p)}:${i + 1}  ${m[0]} → use formatDateIN / formatDateTimeIN`);
      });
    }
  }
};
walk(ROOT);

if (hits.length) {
  console.error(`UI consistency issues (${hits.length}). Colours: use the tokens in AGENTS.md; dates: use the IST formatters.\n` + hits.slice(0, 50).join('\n'));
  process.exit(1);
}
console.log('colour tokens and date formatting OK');

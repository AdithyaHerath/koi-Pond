#!/usr/bin/env node
/*
 * Koi Pond generator.
 * Fetches a user's all-time contribution count + last year's calendar from the
 * GitHub GraphQL API and writes an animated SVG pond.
 *
 *   GITHUB_TOKEN=... node src/generate.js <username> [--out path/to/pond.svg]
 *   node src/generate.js <username> --count 1234 [--out ...]   (offline, sample heatmap)
 *
 * Env (used by the GitHub Action): GH_USER, GITHUB_TOKEN, KOI_OUTPUT
 */
const fs = require('fs');
const path = require('path');
const { renderPond, stageFor } = require('./render.js');

const args = process.argv.slice(2);
const flag = (name) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : null; };
const positional = args.filter((a, k) => !a.startsWith('--') && !['--count', '--out'].includes(args[k - 1]));

const forcedCount = flag('--count') != null ? Number(flag('--count')) : null;
const user = positional[0] || process.env.GH_USER;
const token = process.env.GITHUB_TOKEN;
const out = path.resolve(flag('--out') || process.env.KOI_OUTPUT || 'koi-pond/pond.svg');

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function gql(query) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'koi-pond-generator' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function fetchStats() {
  const login = JSON.stringify(user);
  const first = await gql(`{ user(login: ${login}) { contributionsCollection {
    contributionYears
    contributionCalendar { weeks { contributionDays { contributionLevel weekday } } }
  } } }`);
  if (!first.user) throw new Error(`GitHub user "${user}" not found`);
  const cc = first.user.contributionsCollection;
  const years = cc.contributionYears;
  const perYear = years.map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { totalContributions } }`).join('\n');
  const totals = await gql(`{ user(login: ${login}) { ${perYear} } }`);
  const total = years.reduce((sum, y) => sum + totals.user[`y${y}`].contributionCalendar.totalContributions, 0);
  const weeks = cc.contributionCalendar.weeks.map((w) => w.contributionDays.map((d) => ({ level: LEVELS[d.contributionLevel] || 0, weekday: d.weekday })));
  return { total, weeks };
}

(async () => {
  if (!user) throw new Error('Pass a GitHub username (or set GH_USER).');
  let data;
  if (forcedCount != null) {
    if (!Number.isFinite(forcedCount) || forcedCount < 0) throw new Error('--count must be a non-negative number');
    data = { total: forcedCount };
  }
  else {
    if (!token) throw new Error('Set GITHUB_TOKEN (or pass --count N for an offline render).');
    data = await fetchStats();
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderPond({ user, ...data }));
  const st = stageFor(data.total);
  console.log(`${user}: ${data.total} contributions → ${st.stage.name} (${Math.round(st.progress * 100)}% to next) → ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });

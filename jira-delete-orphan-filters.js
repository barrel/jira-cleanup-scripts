import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCredentials } from './jira-load-credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILTERS_JSON_PATH = path.join(__dirname, 'shared-filters.json');
const DRY_RUN = true; // Set to false to actually delete filters

const { EMAIL, API_TOKEN, JIRA_BASE_URL } = loadCredentials();

const headers = {
  'Authorization': 'Basic ' + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64'),
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function isUserOrphaned(ownerName) {
  const url = `${JIRA_BASE_URL}/rest/api/3/user/search?query=${encodeURIComponent(ownerName)}&maxResults=1`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    console.error(`❌ Error checking user "${ownerName}": ${res.status}`);
    return true;
  }

  const users = await res.json();

  if (users.length === 0) {
    console.log(`🧟 No active user found for "${ownerName}" — marked as orphaned`);
    return true;
  }

  const user = users[0];
  if (!user.active) {
    console.log(`🧟 User "${ownerName}" is inactive`);
    return true;
  }

  return false;
}

async function deleteFilter(filterId, name) {
  const url = `${JIRA_BASE_URL}/rest/api/3/filter/${filterId}`;

  if (DRY_RUN) {
    console.log(`🧪 DRY RUN — Would delete filter ${filterId}: "${name}"`);
    return;
  }

  const res = await fetch(url, { method: 'DELETE', headers });

  if (res.status === 204) {
    console.log(`✅ Deleted filter ${filterId}: "${name}"`);
  } else {
    const text = await res.text();
    console.error(`❌ Failed to delete filter ${filterId}: ${res.status} — ${text}`);
  }
}

async function main() {
  if (!fs.existsSync(FILTERS_JSON_PATH)) {
    console.error('❌ shared-filters.json not found.');
    process.exit(1);
  }

  const filters = JSON.parse(fs.readFileSync(FILTERS_JSON_PATH, 'utf8'));
  const uniqueOwners = [...new Set(filters.map(f => f.owner).filter(Boolean))];
  const orphanedUsers = new Set();

  console.log(`🔍 Checking ${uniqueOwners.length} unique users...`);

  for (const owner of uniqueOwners) {
    const orphaned = await isUserOrphaned(owner);
    if (orphaned) orphanedUsers.add(owner);
    await delay(500);
  }

  const orphanedFilters = filters.filter(f => orphanedUsers.has(f.owner));

  console.log(`🧹 Found ${orphanedFilters.length} orphaned filters to delete:`);

  for (const f of orphanedFilters) {
    await deleteFilter(f.filterId, f.name);
    await delay(500);
  }

  console.log(`✅ Done. ${DRY_RUN ? 'No filters actually deleted (dry run).' : 'Filters removed.'}`);
}

main();
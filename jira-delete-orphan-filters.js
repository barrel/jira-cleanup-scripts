import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { loadCredentials } from './load-credentials.js';
const { EMAIL, API_TOKEN, JIRA_BASE_URL } = loadCredentials();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, 'shared-filters.csv');
const DRY_RUN = false; // Set to false to actually delete

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
    console.error(`❌ Error checking user ${ownerName}: ${res.status}`);
    return true;
  }

  const users = await res.json();
  if (users.length === 0) {
    console.log(`🧟 No active user found for "${ownerName}" — marking as orphaned.`);
    return true;
  }

  const user = users[0];
  if (!user.active) {
    console.log(`🧟 User "${ownerName}" is inactive.`);
    return true;
  }

  return false;
}

async function deleteFilter(filterId, name) {
  if (DRY_RUN) {
    console.log(`🧪 DRY RUN — Would delete filter ${filterId}: "${name}"`);
    return;
  }

  const url = `${JIRA_BASE_URL}/rest/api/3/filter/${filterId}`;
  const res = await fetch(url, { method: 'DELETE', headers });

  if (res.status === 204) {
    console.log(`✅ Deleted filter ${filterId}: "${name}"`);
  } else {
    const text = await res.text();
    console.error(`❌ Failed to delete filter ${filterId}: ${res.status} — ${text}`);
  }
}

async function main() {
  const csvData = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(csvData, { columns: true });

  const uniqueOwners = [...new Set(records.map(r => r.Owner))];
  const orphanedUsers = new Set();

  console.log(`🔎 Checking ${uniqueOwners.length} unique users...`);
  for (const owner of uniqueOwners) {
    const orphaned = await isUserOrphaned(owner);
    if (orphaned) {
      orphanedUsers.add(owner);
    }
    await delay(500);
  }

  const orphanedFilters = records.filter(r => orphanedUsers.has(r.Owner));

  console.log(`🧹 Found ${orphanedFilters.length} orphaned filters to delete.`);
  for (const filter of orphanedFilters) {
    await deleteFilter(filter['Filter ID'], filter['Name']);
    await delay(500);
  }

  console.log('✅ Done!');
}

main();
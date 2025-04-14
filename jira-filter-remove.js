const fs = require('fs');
const readline = require('readline');
const path = require('path');
import { loadCredentials } from './jira-load-credentials.js';
const { EMAIL, API_TOKEN, JIRA_BASE_URL } = loadCredentials();

const authHeader = 'Basic ' + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function promptStep(message) {
  return ask(`${message} (Y to proceed): `).then(answer => {
    if (answer.toUpperCase() !== 'Y') {
      console.log('Aborting...');
      process.exit(0);
    }
  });
}

function saveBackup(filename, data) {
  const filepath = path.join(__dirname, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`📝 Saved backup to ${filepath}`);
}

async function fetchUserByAccountId(accountId) {
  const res = await fetch(`${JIRA_BASE_URL}/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error fetching user: ${res.status} ${errorText}`);
  }

  return res.json();
}

async function fetchFilters(startAt = 0) {
  const url = `${JIRA_BASE_URL}/rest/api/3/filter/search?expand=owner&startAt=${startAt}&maxResults=50`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error fetching filters: ${res.status} ${errorText}`);
  }

  return res.json();
}

async function deleteFilter(filterId) {
  const res = await fetch(`${JIRA_BASE_URL}/rest/api/3/filter/${filterId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': authHeader
    }
  });

  return res.ok;
}

async function run() {
  const TARGET_ACCOUNT_ID = await ask('Enter the TARGET_ACCOUNT_ID of the user to delete filters for: ');

  // Fetch user info
  console.log('🔎 Fetching user info...');
  const user = await fetchUserByAccountId(TARGET_ACCOUNT_ID);
  console.log(`👤 Found user: ${user.displayName} (${user.emailAddress || 'no email shown'})`);

  await promptStep('Proceed with this user');

  await promptStep('Step 1: Fetch all filters');

  let startAt = 0;
  let isLast = false;
  let allFilters = [];

  console.log('📥 Fetching filters...');
  while (!isLast) {
    const data = await fetchFilters(startAt);
    allFilters.push(...data.values);
    startAt += data.maxResults;
    isLast = data.isLast || data.values.length === 0;
  }

  saveBackup('step1_all-filters.json', allFilters);

  await promptStep('Step 2: Filter to only those owned by the target account');

  const userFilters = allFilters.filter(f => f.owner?.accountId === TARGET_ACCOUNT_ID);
  console.log(`🎯 Found ${userFilters.length} filters owned by user.`);
  saveBackup('step2_target-user-filters.json', userFilters);

  await promptStep(`Step 3: Proceed to DELETE ${userFilters.length} filters`);

  const results = [];
  for (const filter of userFilters) {
    const success = await deleteFilter(filter.id);
    results.push({
      filterId: filter.id,
      name: filter.name,
      action: 'deleted',
      success
    });
    console.log(`${success ? '✅ Deleted' : '❌ Failed'} — ${filter.name} (${filter.id})`);
  }

  saveBackup('step3_deletion-results.json', results);
  rl.close();
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  rl.close();
});
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, 'jira-credentials.json');

export function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('jira-credentials.json file not found.');
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const { EMAIL, API_TOKEN, JIRA_BASE_URL } = JSON.parse(raw);

  if (!EMAIL || !API_TOKEN || !JIRA_BASE_URL) {
    throw new Error('jira-credentials.json is missing required fields.');
  }

  return { EMAIL, API_TOKEN, JIRA_BASE_URL };
}

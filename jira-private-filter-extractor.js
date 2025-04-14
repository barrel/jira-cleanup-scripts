import fs from 'fs';
import path from 'path';
import readline from 'readline';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JIRA_BASE = 'https://barrel.atlassian.net';
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const JSON_PATH = path.join(__dirname, 'shared-filters.json');
const RESUME_PATH = path.join(__dirname, 'resume.json');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

async function waitUntilLoggedIn(page) {
  console.log('🔑 Please log in using Google...');
  const timeout = 5 * 60 * 1000;
  const start = Date.now();

  while (true) {
    const url = page.url();
    if (
      url.includes('/jira/') ||
      url.includes('/secure/Dashboard.jspa') ||
      url.includes('/secure/admin/filters/ViewSharedFilters.jspa')
    ) {
      console.log(`🎉 Logged in: ${url}`);
      return;
    }
    if (Date.now() - start > timeout) throw new Error('⏱️ Login timed out.');
    await delay(1500);
  }
}

async function extractCurrentPageFilters(page) {
  return await page.evaluate(() => {
    return [...document.querySelectorAll('tbody tr')].map(row => {
      const cells = row.querySelectorAll('td');
      const deleteLink = row.querySelector('a.delete-filter');
      const filterId = deleteLink?.getAttribute('rel') || '';

      return {
        filterId,
        name: cells[0]?.innerText.trim() || '',
        owner: cells[1]?.innerText.trim() || '',
        shares: cells[2]?.innerText.trim() || '',
        lastViewed: cells[3]?.innerText.trim() || '',
        favorites: cells[4]?.innerText.trim() || ''
      };
    });
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Load cookies
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await page.setCookie(...cookies);
    console.log('🔐 Loaded session cookies');
  }

  await page.goto(`${JIRA_BASE}/jira`, { waitUntil: 'networkidle2' });

  const isLoggedIn = await page.evaluate(() =>
    Boolean(document.querySelector('#jira-frontend'))
  );

  if (!isLoggedIn) {
    await waitUntilLoggedIn(page);
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log('💾 Session cookies saved');
  } else {
    console.log('✅ Already logged in');
  }

  await page.goto(`${JIRA_BASE}/secure/admin/filters/ViewSharedFilters.jspa`, {
    waitUntil: 'networkidle2'
  });

  // Handle resuming
  let resumePage = 1;
  let allFilters = [];

  if (fs.existsSync(RESUME_PATH)) {
    const resumeData = JSON.parse(fs.readFileSync(RESUME_PATH, 'utf8'));
    const confirm = await prompt(`Resume from page ${resumeData.page}? (y/n): `);
    if (confirm === 'y') {
      resumePage = resumeData.page;
      allFilters = fs.existsSync(JSON_PATH)
        ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
        : [];
      console.log(`🔁 Resuming from page ${resumePage}`);
    } else {
      fs.unlinkSync(RESUME_PATH);
      fs.existsSync(JSON_PATH) && fs.unlinkSync(JSON_PATH);
      console.log('🧼 Starting fresh...');
    }
  }

  let currentPage = resumePage;

  while (true) {
    console.log(`📄 Processing page ${currentPage}...`);
    const filters = await extractCurrentPageFilters(page);
    filters.filter(f => {
      return f.filterId > 0;
    }).forEach(f => {
      console.log(`🆔 ${f.filterId} — ${f.name}`);
    });

    allFilters.push(...filters);

    fs.writeFileSync(JSON_PATH, JSON.stringify(allFilters, null, 2));
    fs.writeFileSync(RESUME_PATH, JSON.stringify({ page: currentPage + 1 }, null, 2));

    const nextLink = await page.$('a.icon.icon-next');
    if (!nextLink) {
      console.log('🏁 No more pages.');
      fs.unlinkSync(RESUME_PATH);
      break;
    }

    console.log('➡️ Moving to next page...');
    await Promise.all([
      nextLink.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    await delay(10000);
    currentPage++;
  }

  console.log('✅ Done. Saved to shared-filters.json');
  await browser.close();
})();
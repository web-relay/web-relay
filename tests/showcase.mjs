import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const profile = await mkdtemp(join(tmpdir(), 'web-relay-e2e-'));
const launcherPath = resolve('apps/launcher-extension/dist');
const providerPath = resolve('apps/webapp-extension/dist');
const extensionId = async path => {
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  return [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0,32)].map(c => String.fromCharCode(97 + parseInt(c,16))).join('');
};
const launcherId = await extensionId(launcherPath);
const providerId = await extensionId(providerPath);
let browser;
let server;
try {
  // Reuse a running local server or start our own. Tests require a prior pnpm build.
  try { await fetch('http://localhost:4173/'); }
  catch {
    server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['ignore','pipe','inherit'] });
    await Promise.race([once(server.stdout,'data'), new Promise((_,reject) => setTimeout(() => reject(new Error('PWA server did not start')), 5000).unref())]);
  }
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: [`--disable-extensions-except=${launcherPath},${providerPath}`, `--load-extension=${launcherPath},${providerPath}`, '--no-sandbox', '--no-proxy-server'],
  });
  await browser.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>GitHub navigation fixture</title></head><body>GitHub URL fixture: no network or account actions.</body></html>' }));
  const app = await browser.newPage();
  await app.goto('http://localhost:4173/');
  await app.getByRole('button', { name: 'Create note', exact: true }).click();
  await app.getByRole('button', { name: 'Pin selected note', exact: true }).waitFor();
  assert.equal(await app.locator('.note').count(), 1);
  console.log('PASS local SDK registration and palette execution');
  let worker = browser.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${launcherId}/`));
  if (!worker) worker = await browser.waitForEvent('serviceworker', { predicate: worker => worker.url().startsWith(`chrome-extension://${launcherId}/`) });
  // Exercise the real popup document and extension APIs. Headless Chromium does not
  // expose the browser-toolbar popup as a Playwright Page, so open its document in a tab.
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${launcherId}/popup.html`);
  await app.bringToFront();
  await popup.getByRole('button', { name: 'Refresh capabilities' }).click();
  await popup.getByRole('button', { name: 'Create note demo-notes' }).waitFor();
  await popup.getByRole('button', { name: 'Pin selected note demo-notes' }).waitFor();
  await popup.getByRole('button', { name: 'Open Web Relay repository github' }).waitFor();
  await popup.getByRole('button', { name: 'Copy current URL browser' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await popup.screenshot({ path: 'test-results/launcher.png' });
  await app.screenshot({ path: 'test-results/pwa.png', fullPage: true });
  console.log('PASS actual extension discovery of PWA, external provider, and browser commands');
  const sendPanel = async (message) => popup.evaluate(message => chrome.runtime.sendMessage({ channel: 'web-relay:panel', version: 1, ...message }), message);
  const before = await sendPanel({ type: 'list' });
  const pin = before.data.capabilities.find(command => command.id === 'notes.pin-selected');
  await popup.getByRole('button', { name: 'Pin selected note demo-notes' }).click();
  await app.getByRole('button', { name: '★ Note 1', exact: true }).waitFor();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Pinned Note 1'));
  assert.equal(await popup.getByRole('button', { name: 'Pin selected note demo-notes' }).count(), 0);
  const staleCommand = await sendPanel({ type: 'execute', command: pin, context: before.data.context });
  assert.equal(staleCommand.ok, false); assert.equal(staleCommand.error.code, 'UNAVAILABLE');
  console.log('PASS remote PWA invocation and availability changes; stale command rejected');
  await popup.locator('#search').fill('create');
  assert.equal(await popup.locator('.command').count(), 1);
  await popup.locator('#search').press('Enter');
  await app.getByRole('button', { name: 'Note 2', exact: true }).waitFor();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Created Note 2'));
  await popup.locator('#search').fill('');
  console.log('PASS same SDK action from both palettes and keyboard search execution');
  const malformed = await sendPanel({ type: 'execute', command: { id: 'notes.create', providerId: 'browser', providerKind: 'browser' }, context: before.data.context });
  assert.equal(malformed.ok, false);
  const externalWrongVersion = await worker.evaluate(async providerId => {
    try { const response = await chrome.runtime.sendMessage(providerId, { channel: 'web-relay', version: 99, type: 'discover', requestId: 'invalid-version' }); return response?.ok === true ? 'accepted' : 'rejected'; }
    catch { return 'rejected'; }
  }, providerId);
  assert.equal(externalWrongVersion, 'rejected');
  console.log('PASS provider spoofing and unsupported protocol rejected');
  await sendPanel({ type: 'configure', githubEnabled: false });
  assert.equal((await sendPanel({ type: 'list' })).data.capabilities.some(command => command.providerId === 'github'), false);
  const disabledInvoke = await sendPanel({ type: 'execute', command: before.data.capabilities.find(command => command.id === 'github.open-project'), context: before.data.context });
  assert.equal(disabledInvoke.ok, false);
  await sendPanel({ type: 'configure', githubEnabled: true });
  console.log('PASS provider disable prevents discovery and execution');
  const copied = await sendPanel({ type: 'execute', command: before.data.capabilities.find(command => command.id === 'browser.copy-url'), context: before.data.context });
  assert.equal(copied.data.clipboard, 'http://localhost:4173/');
  await popup.getByRole('button', { name: 'Copy current URL browser' }).click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Copied the current URL'));
  await browser.grantPermissions(['clipboard-read'], { origin: 'http://localhost:4173' });
  assert.equal(await app.evaluate(() => navigator.clipboard.readText()), 'http://localhost:4173/');
  console.log('PASS browser URL capability and real clipboard write');
  await popup.close();
  const github = await browser.newPage();
  await github.goto('https://github.com/web-relay/web-relay/tree/main');
  const githubPopup = await browser.newPage();
  await githubPopup.goto(`chrome-extension://${launcherId}/popup.html`);
  await github.bringToFront();
  await githubPopup.getByRole('button', { name: 'Refresh capabilities' }).click();
  await githubPopup.getByRole('button', { name: 'Open repository issues github' }).waitFor();
  const githubBefore = await githubPopup.evaluate(() => chrome.runtime.sendMessage({ channel: 'web-relay:panel', version: 1, type: 'list' }));
  await githubPopup.screenshot({ path: 'test-results/github-launcher.png' });
  await githubPopup.getByRole('button', { name: 'Open repository issues github' }).click();
  await github.waitForURL('https://github.com/web-relay/web-relay/issues');
  console.log('PASS actual cross-extension invocation navigates GitHub repository context');
  await githubPopup.waitForFunction(() => document.querySelector('#status').textContent.includes('Navigated'));
  const staleTab = await githubPopup.evaluate(message => chrome.runtime.sendMessage(message), {
    channel: 'web-relay:panel', version: 1, type: 'execute', command: githubBefore.data.capabilities.find(command => command.id === 'github.repo-pulls'), context: githubBefore.data.context,
  });
  assert.equal(staleTab.ok, false); assert.equal(staleTab.error.code, 'STALE_CONTEXT');
  console.log('PASS tab navigation invalidates stale execution context');
  await githubPopup.close();
  await app.bringToFront();
  await app.reload();
  assert.equal(await app.locator('.note').count(), 2);
  await app.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await browser.setOffline(true);
  await app.reload();
  await app.getByRole('button', { name: 'Create note', exact: true }).waitFor();
  assert.equal(await app.locator('.note').count(), 2);
  console.log('PASS persisted notes and offline PWA shell');
  const offlinePopup = await browser.newPage();
  await offlinePopup.goto(`chrome-extension://${launcherId}/popup.html`);
  await app.bringToFront();
  await offlinePopup.getByRole('button', { name: 'Refresh capabilities' }).click();
  await offlinePopup.getByRole('button', { name: 'Create note demo-notes' }).click();
  await app.getByRole('button', { name: 'Note 3', exact: true }).waitFor();
  await offlinePopup.waitForFunction(() => document.querySelector('#status').textContent.includes('Created Note 3'));
  await offlinePopup.close();
  console.log('PASS extension discovery and PWA execution while offline');
  await browser.setOffline(false);
  await app.bringToFront();
  const browserPopup = await browser.newPage();
  await browserPopup.goto(`chrome-extension://${launcherId}/popup.html`);
  await app.bringToFront();
  await browserPopup.getByRole('button', { name: 'Refresh capabilities' }).click();
  await browserPopup.getByRole('button', { name: 'Duplicate current tab browser' }).waitFor();
  const duplicate = browser.waitForEvent('page');
  await browserPopup.getByRole('button', { name: 'Duplicate current tab browser' }).click();
  const duplicatePage = await duplicate;
  await duplicatePage.waitForURL('http://localhost:4173/');
  await browserPopup.waitForFunction(() => document.querySelector('#status').textContent.includes('Duplicated'));
  const download = browser.waitForEvent('page');
  await browserPopup.getByRole('button', { name: 'Open downloads browser' }).click();
  const downloadPage = await download;
  await downloadPage.waitForURL('chrome://downloads/');
  await browserPopup.waitForFunction(() => document.querySelector('#status').textContent.includes('Opened downloads'));
  const newTab = browser.waitForEvent('page');
  await browserPopup.getByRole('button', { name: 'Open new tab browser' }).click();
  await newTab;
  console.log('PASS browser duplicate, downloads, and new-tab actions');
  console.log('All showcase integration checks passed. GitHub navigation uses URL fixtures; no GitHub account actions were performed.');
} finally {
  await browser?.close();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}

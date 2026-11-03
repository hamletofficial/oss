const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
let server;
let origin;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
};

test.before(async () => {
  server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400).end('Bad request'); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not found'); return;
    }
    res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('signed-in broker can save a deal, save a search and upload a transaction document', async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    const mockFirebase = `
      (() => {
        const stores = new Map();
        const objects = new Map();
        const currentUser = {uid: 'e2e-owner', email: 'broker@example.com'};
        const key = (collection, id) => collection + '/' + id;
        function snapshot(collection, filters) {
          const docs = [];
          for (const [path, data] of stores.entries()) {
            if (!path.startsWith(collection + '/')) continue;
            if (filters.every(([field, op, value]) => op === '==' ? data[field] === value : op === 'array-contains' ? Array.isArray(data[field]) && data[field].includes(value) : false)) {
              docs.push({id: path.slice(collection.length + 1), data: () => ({...data})});
            }
          }
          return {docs, empty: docs.length === 0, size: docs.length};
        }
        const db = {collection(name) {
          return {
            where(field, op, value) {
              const filters = [[field, op, value]];
              const q = {
                where(f, o, v) { filters.push([f, o, v]); return q; },
                limit() { return q; },
                async get() { return snapshot(name, filters); },
                onSnapshot(callback) { callback(snapshot(name, filters)); return () => {}; }
              };
              return q;
            },
            doc(id) {
              return {
                async get() {
                  const data = stores.get(key(name, id));
                  return {id, exists: !!data, data: () => data ? ({...data}) : undefined};
                },
                async set(data, options) {
                  const old = stores.get(key(name, id)) || {};
                  stores.set(key(name, id), options && options.merge ? {...old, ...data} : {...data});
                },
                async delete() { stores.delete(key(name, id)); }
              };
            }
          };
        }};
        stores.set(key('publicProfiles', 'e2e-contact'), {isPublic: true, firstName: 'Eve', lastName: 'Broker', displayName: 'Eve Broker', company: 'E2E Property Co'});
        stores.set(key('directMessages', 'e2e-message'), {senderUid: 'e2e-owner', recipientUid: 'e2e-contact', participants: ['e2e-owner', 'e2e-contact'], body: 'Inspection follow-up on Baker Street', sentAt: new Date(), pinnedBy: [], readBy: []});
        function auth() {
          return {onAuthStateChanged(callback) { callback(currentUser); return () => {}; }, async signOut() {}};
        }
        function storage() {
          return {ref(path) {
            return {
              async put(file, metadata) { objects.set(path, {file, metadata}); return {ref: this}; },
              async getDownloadURL() { return 'data:application/pdf;base64,JVBERiQ='; },
              async delete() { objects.delete(path); }
            };
          }};
        }
        const firebase = {apps: [], initializeApp(config) { this.apps.push({config}); }, auth, firestore: () => db, storage};
        firebase.firestore.FieldValue = {serverTimestamp: () => ({__serverTimestamp: true})};
        window.firebase = firebase;
        window.firebaseConfig = {apiKey: 'e2e-test', authDomain: 'localhost', projectId: 'demo-hamlet-e2e'};
      })();
    `;
    await page.route('https://www.gstatic.com/firebasejs/9.22.2/**', route => route.fulfill({status: 200, contentType: 'application/javascript', body: ''}));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({status: 200, contentType: 'text/css', body: ''}));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({status: 200, body: ''}));
    await page.route('**/firebase-config.js', route => route.fulfill({status: 200, contentType: 'application/javascript', body: mockFirebase}));
    await page.goto(origin + '/app/hamlet/index.html', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#syncLabel')?.textContent === 'Synced workspace', null, {timeout: 10000});
    // The authenticated first-run product tour intentionally overlays the workspace.
    // Dismiss it in this workflow test so the test can exercise the underlying controls.
    const tourOverlay = page.locator('#hamletTourOverlay');
    if (await tourOverlay.isVisible().catch(() => false)) {
      await tourOverlay.getByRole('button', {name: 'Skip tour'}).click();
      await tourOverlay.waitFor({state: 'hidden'});
    }
    assert.equal(await page.locator('#hamletAdvancedTools').isVisible(), true);

    await page.locator('#workspaceSearchInput').fill('Baker Street');
    await page.locator('#workspaceSearchResults').getByText('Inspection follow-up on Baker Street', {exact: true}).waitFor({state: 'visible', timeout: 10000});
    assert.equal(await page.locator('#workspaceSearchResults a[href="/messages.html?to=e2e-contact"]').count(), 1);
    await page.locator('#workspaceSearchInput').fill('');

    await page.locator('#addDealBtn').click();
    await page.locator('#dealName').fill('E2E office acquisition');
    await page.locator('#property').fill('10 Market Street, London');
    await page.locator('#dealValue').fill('1250000');
    await page.locator('#saveDealBtn').click();
    await page.getByText('E2E office acquisition', {exact: true}).first().waitFor({state: 'visible', timeout: 10000});

    await page.locator('#calculatorDeal').selectOption({label: 'E2E office acquisition'});
    await page.locator('#useDealValueBtn').click();
    assert.equal(await page.locator('#calculatorValue').inputValue(), '1250000');
    await page.locator('#calculatorValue').fill('1000000');
    await page.locator('#calculatorAnnualRent').fill('80000');
    await page.locator('#calculatorAnnualCosts').fill('10000');
    await page.locator('#calculatorCommissionRate').fill('1.5');
    await page.locator('#calculatorFloorArea').fill('10000');
    await page.locator('#calculatorAddVat').check();
    await page.locator('#calculateDealBtn').click();
    await page.locator('#dealCalculatorResults').getByText('8.00%', {exact: true}).waitFor({state: 'visible', timeout: 10000});
    await page.locator('#dealCalculatorResults').getByText('7.00%', {exact: true}).waitFor({state: 'visible', timeout: 10000});
    await page.locator('#dealCalculatorResults').getByText('£100.00', {exact: true}).waitFor({state: 'visible', timeout: 10000});
    await page.locator('#dealCalculatorResults').getByText('£18,000.00', {exact: true}).waitFor({state: 'visible', timeout: 10000});

    await page.locator('#savedSearchName').fill('E2E saved search');
    await page.locator('#savedSearchQuery').fill('Market Street');
    await page.locator('#saveSearchBtn').click();
    await page.getByText('E2E saved search', {exact: true}).waitFor({state: 'visible', timeout: 10000});

    await page.locator('#documentDeal').selectOption({label: 'E2E office acquisition'});
    await page.locator('#documentTitle').fill('E2E heads of terms');
    await page.locator('#documentFile').setInputFiles({
      name: 'heads.pdf', mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\\n% Hamlet E2E test file\\n%%EOF')
    });
    await page.locator('#uploadDocumentBtn').click();
    await page.locator('#transactionDocumentsList').getByText('E2E heads of terms', {exact: true}).waitFor({state: 'visible', timeout: 10000});
    assert.match(await page.locator('#documentUploadStatus').textContent(), /Upload complete/);
  } finally {
    await browser.close();
  }
});

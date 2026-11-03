const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('app/hamlet/index.html', 'utf8');
const messagesHtml = fs.readFileSync('messages.html', 'utf8');
const siteSearch = fs.readFileSync('site-search.js', 'utf8');
const searchIndex = JSON.parse(fs.readFileSync('search-index.json', 'utf8'));
const firestore = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');

test('all inline JavaScript blocks parse', () => {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 2, 'expected authentication guard and workspace scripts');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'hamlet-inline-' + index + '.js' }));
  }
  assert.doesNotThrow(() => new vm.Script(functions, { filename: 'functions/index.js' }));
});

test('advanced transaction features are present and connected', () => {
  for (const id of [
    'hamletAdvancedTools', 'transactionHistoryList', 'transactionDocumentForm',
    'transactionDocumentsList', 'savedSearchForm', 'savedSearchesList',
    'dealIntelligenceList', 'dealCalculatorForm', 'calculatorValue', 'dealCalculatorResults', 'firebase-storage-compat.js'
  ]) assert.ok(html.includes(id), 'missing feature hook: ' + id);
  assert.match(html, /function renderAll\(\)[\s\S]*?renderAdvancedPanels\(\)/);
  assert.match(html, /function checkSavedSearchAlerts\(\)/);
  assert.match(html, /function renderDealIntelligence\(\)/);
});

test('mailbox bulk-delete action only removes messages sent by the signed-in member', () => {
  const deleteConversation = messagesHtml.match(/async function deleteConversation\(\)\{([\s\S]*?)\}\s*async function closeConversation/);
  assert.ok(deleteConversation, 'expected the mailbox delete function');
  assert.match(deleteConversation[1], /m\.senderUid===me\.uid&&m\.recipientUid===otherUid/);
  assert.match(deleteConversation[1], /Messages sent by the other member will remain/);
  assert.match(messagesHtml, /Delete My Messages/);
  assert.match(firestore, /allow delete: if request\.auth != null\s*&& request\.auth\.uid == resource\.data\.senderUid\s*&& request\.auth\.uid in resource\.data\.participants;/);
});

test('workspace search includes authenticated messages alongside deals, properties and public profiles', () => {
  assert.match(html, /Searches your deals, owned properties, accessible messages and public member profiles/);
  assert.match(html, /db\.collection\('directMessages'\)\.where\('participants','array-contains',u\.uid\)\.limit\(250\)\.get\(\)/);
  assert.match(html, /kind:'Message'/);
  assert.match(html, /href="\/messages\.html\?to='\+encodeURIComponent\(m\.id\)\+'"/);
});

test('deal activity timeline combines transaction changes, documents and critical-path reminders', () => {
  assert.match(html, /Deal activity timeline/);
  assert.match(html, /\.\.\.advancedHistory\.map\(e=>\(\{id:'event:'/);
  assert.match(html, /\.\.\.advancedDocuments\.map\(d=>\(\{id:'document:'/);
  assert.match(html, /\.\.\.reminders\.map\(r=>\(\{id:'reminder:'/);
});

test('commercial deal calculator computes rental yields, unit pricing and optional VAT-inclusive fees', () => {
  assert.ok(html.includes('function calculateDealCalculator()'));
  assert.ok(html.includes('rent/price*100'));
  assert.ok(html.includes('(rent-costs)/price*100'));
  assert.ok(html.includes('price/area'));
  assert.ok(html.includes('fee*1.2'));
  assert.ok(html.includes('Calculations stay in this browser and are not saved to your account'));
});

test('transaction history is append-only and owner-scoped', () => {
  assert.match(firestore, /match \/hamletDealEvents\/{eventId}/);
  assert.match(firestore, /allow read: if request\.auth != null && resource\.data\.uid == request\.auth\.uid/);
  assert.match(firestore, /allow create, update, delete: if false;/);
  assert.match(functions, /exports\.recordHamletDealHistory = onDocumentWritten/);
  assert.match(firestore, /request\.resource\.data\.createdAt == request\.time/);
});

test('documents and saved searches have private owner rules', () => {
  assert.match(firestore, /match \/hamletDocuments\/{documentId}/);
  assert.match(firestore, /match \/hamletSavedSearches\/{searchId}/);
  assert.match(firestore, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(storage, /match \/hamletDocuments\/{userId}\/{dealId}\/{documentId}\/{fileName}/);
  assert.match(storage, /request\.auth\.uid == userId/);
  assert.match(storage, /request\.resource\.size <= 15 \* 1024 \* 1024/);
  assert.match(storage, /allow update: if false;/);
});


test('public search excludes protected member pages from both its index and results', () => {
  const privateFileSet = siteSearch.match(/const privateFiles = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(privateFileSet, 'expected an explicit private-page exclusion list');
  for (const path of ['insights.html', 'dashboard.html', 'messages.html', 'settings.html', 'admin.html']) {
    assert.ok(privateFileSet[1].includes("'" + path + "'"), 'public search must exclude protected page: ' + path);
  }
  for (const page of searchIndex) {
    const path = String(page.path || page.url || '').replace(/^\/+/, '').toLowerCase();
    const filename = path.split('/').pop();
    assert.notEqual(filename, 'insights.html', 'protected page must not be published in search-index.json');
    assert.ok(!/^(?:app|functions|public|superuser|admin|account|accounts|auth|authentication)(?:\/|$)/i.test(path), 'private directory must not appear in public search index: ' + path);
  }
});

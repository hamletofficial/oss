const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('app/hamlet/index.html', 'utf8');
const messagesHtml = fs.readFileSync('messages.html', 'utf8');
const organisationsHtml = fs.readFileSync('organisations.html', 'utf8');
const appOrganisationsHtml = fs.readFileSync('app/hamlet/organisations.html', 'utf8');
const siteSearch = fs.readFileSync('site-search.js', 'utf8');
const searchIndex = JSON.parse(fs.readFileSync('search-index.json', 'utf8'));
const firestore = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');
const organisationFunctions = fs.readFileSync('functions/hamlet-organisations.js', 'utf8');
const organisationDealsHtml = fs.readFileSync('app/hamlet/organisation-deals.html', 'utf8');

test('all inline JavaScript blocks parse', () => {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 2, 'expected authentication guard and workspace scripts');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'hamlet-inline-' + index + '.js' }));
  }
  assert.doesNotThrow(() => new vm.Script(functions, { filename: 'functions/index.js' }));
  assert.doesNotThrow(() => new vm.Script(organisationFunctions, { filename: 'functions/hamlet-organisations.js' }));
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


test('tenant resource rules and storage paths are isolated from legacy individual records', () => {
  assert.match(firestore, /match \/organisationProperties\/{propertyId}/);
  assert.match(firestore, /match \/organisationDeals\/{dealId}/);
  assert.match(firestore, /match \/organisationDocuments\/{documentId}/);
  assert.match(firestore, /visibility in \['organisation', 'restricted'\]/);
  assert.match(firestore, /createdByUid == resource\.data\.createdByUid/);
  // Organisation uploads are intentionally deferred; the catch-all deny remains in force.
  assert.doesNotMatch(storage, /match \/organisationDocuments\//);
  assert.match(storage, /match \/\{allPaths=\*\*\}[\s\S]*allow read, write: if false;/);
  assert.match(firestore, /match \/hamletDeals\/{dealId}/);
});

test('organisation lifecycle operations are server-controlled and registered', () => {
  for (const callable of [
    'createOrganisation',
    'createOrganisationInvitation',
    'acceptOrganisationInvitation',
    'revokeOrganisationInvitation',
    'changeOrganisationMemberRole',
    'removeOrganisationMember',
  ]) {
    assert.match(organisationFunctions, new RegExp('exports\\.' + callable + ' = onCall'));
  }
  assert.match(organisationFunctions, /createHash\("sha256"\)/);
  assert.match(organisationFunctions, /randomBytes\(32\)/);
  assert.match(organisationFunctions, /email_verified !== true/);
  assert.match(functions, /require\("\.\/hamlet-organisations"\)/);
  assert.ok(firestore.includes('match /organisations/{organisationId}'));
  assert.match(firestore, /allow create, update, delete: if false;/);
});


test('organisation management page scripts parse and use authenticated callable operations', () => {
  const blocks = [...organisationsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 1, 'expected organisation management application script');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisations-inline-' + index + '.js' }));
  }
  assert.match(organisationsHtml, /name="robots" content="noindex,nofollow"/);
  assert.match(organisationsHtml, /acceptOrganisationInvitation/);
  assert.match(organisationsHtml, /createOrganisationInvitation/);
  assert.match(organisationsHtml, /revokeOrganisationInvitation/);
  assert.match(organisationsHtml, /id="acceptInviteForm"/);
  assert.match(organisationsHtml, /acceptInviteToken/);
  assert.doesNotMatch(organisationsHtml, /location\.hash|replaceState|invitationLink/);
  assert.match(siteSearch, /'organisations\.html'/);
});


test('workspace organisation management page JavaScript parses', () => {
  const blocks = [...appOrganisationsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 1, 'expected app organisation management script');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'app-organisations-inline-' + index + '.js' }));
  }
  assert.match(appOrganisationsHtml, /name="robots" content="noindex,nofollow"/);
  assert.match(appOrganisationsHtml, /Team operations/);
  assert.match(appOrganisationsHtml, /Deals &amp; pipeline/);
  assert.match(appOrganisationsHtml, /Property portfolio/);
  assert.match(appOrganisationsHtml, /Organisation administration/);
  assert.match(appOrganisationsHtml, /organisationMembers/);
  assert.doesNotMatch(appOrganisationsHtml, /createOrganisationInvitation|removeOrganisationMember|acceptOrganisationInvitation|revokeOrganisationInvitation/);
  assert.doesNotMatch(appOrganisationsHtml, /location\.hash|replaceState/);
  assert.match(html, /href="\/app\/hamlet\/organisations\.html"[^>]*>.*Organisations/);
});


test('organisation deal workspace is tenant-scoped and uses dedicated deal storage', () => {
  const blocks = [...organisationDealsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 1, 'expected organisation deal workspace application script');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-deals-inline-' + index + '.js' }));
  }
  assert.match(organisationDealsHtml, /name="robots" content="noindex,nofollow"/);
  assert.match(organisationDealsHtml, /collection\('organisationDeals'\)/);
  assert.match(organisationDealsHtml, /organisationId:activeOrg\.id/);
  assert.match(organisationDealsHtml, /createdByUid:previous\?previous\.createdByUid:user\.uid/);
  assert.match(organisationDealsHtml, /collection\('organisationMembers'\)/);
  assert.match(organisationDealsHtml, /visibility/);
  assert.doesNotMatch(organisationDealsHtml, /collection\('hamletDeals'\)/);
  assert.match(organisationDealsHtml, /Firestore Rules/);
  assert.match(appOrganisationsHtml, /href="\/app\/hamlet\/organisation-deals\.html"/);
});

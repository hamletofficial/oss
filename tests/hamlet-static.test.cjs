const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('app/hamlet/index.html', 'utf8');
const messagesHtml = fs.readFileSync('messages.html', 'utf8');
const organisationsHtml = fs.readFileSync('organisations.html', 'utf8');
const appOrganisationsHtml = fs.readFileSync('app/hamlet/organisations.html', 'utf8');
const organisationDirectoryHtml = fs.readFileSync('organisation-directory.html', 'utf8');
const siteSearch = fs.readFileSync('site-search.js', 'utf8');
const searchIndex = JSON.parse(fs.readFileSync('search-index.json', 'utf8'));
const firestore = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');
const organisationFunctions = fs.readFileSync('functions/hamlet-organisations.js', 'utf8');
const organisationAuditFunctions = fs.readFileSync('functions/hamlet-organisation-audit.js', 'utf8');
const organisationDealsHtml = fs.readFileSync('app/hamlet/organisation-deals.html', 'utf8');
const organisationFilesHtml = fs.readFileSync('app/hamlet/organisation-files.html', 'utf8');
const organisationActivityHtml = fs.readFileSync('app/hamlet/organisation-activity.html', 'utf8');
const organisationAssociationHtml = fs.readFileSync('app/hamlet/organisation-association.html', 'utf8');
const organisationAnalyticsHtml = fs.readFileSync('app/hamlet/organisation-analytics.html', 'utf8');
const organisationVerificationAdminHtml = fs.readFileSync('app/hamlet/organisation-verification-admin.html', 'utf8');

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
  assert.match(storage, /match \/organisationDocuments\/{organisationId}\/{resourceType}\/{resourceId}\/{documentId}\/{fileName}/);
  assert.match(storage, /function activeMember\(\)/);
  assert.match(storage, /function canReadParent\(\)/);
  assert.match(storage, /function canWriteParent\(\)/);
  assert.match(storage, /request\.resource\.size <= 15 \* 1024 \* 1024/);
  assert.match(storage, /allow update: if false;/);
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
  assert.match(appOrganisationsHtml, /Shared deals &amp; pipeline/);
  assert.match(appOrganisationsHtml, /[Pp]roperty portfolio/);
  assert.match(appOrganisationsHtml, /Organisation administration/);
  assert.match(appOrganisationsHtml, /organisationMembers/);
  assert.doesNotMatch(appOrganisationsHtml, /createOrganisationInvitation|removeOrganisationMember|acceptOrganisationInvitation|revokeOrganisationInvitation/);
  assert.doesNotMatch(appOrganisationsHtml, /location\.hash|replaceState/);
  assert.match(html, /href="\/app\/hamlet\/organisations\.html"[^>]*>.*Organisations/);
});

test('organisation profile editing uses a trusted callable and public directory projection', () => {
  const blocks = [...appOrganisationsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-profile-inline-' + index + '.js' }));
  }
  assert.match(appOrganisationsHtml, /updateOrganisationProfile/);
  assert.match(organisationFunctions, /exports\.updateOrganisationProfile = onCall/);
  assert.match(organisationFunctions, /exports\.requestOrganisationMembership = onCall/);
  assert.match(organisationFunctions, /exports\.reviewOrganisationMembershipRequest = onCall/);
  assert.match(organisationFunctions, /exports\.leaveOrganisation = onCall/);
  assert.match(organisationFunctions, /exports\.submitOrganisationVerification = onCall/);
  assert.match(organisationFunctions, /exports\.reviewOrganisationVerification = onCall/);
  assert.match(organisationDirectoryHtml, /collection\('organisationDirectory'\)/);
  assert.match(organisationDirectoryHtml, /where\('isPublic','==',true\)/);
  assert.match(organisationDirectoryHtml, /where\('status','==','active'\)/);
  assert.match(organisationDirectoryHtml, /\.orgs\.hamlet-ai\.co\.uk/);
  assert.match(firestore, /match \/organisationDirectory\/{organisationId}/);
  assert.match(firestore, /match \/organisationMembershipRequests\/{requestId}/);
  assert.match(appOrganisationsHtml, /reviewOrganisationMembershipRequest/);
  assert.match(appOrganisationsHtml, /leaveOrganisation/);
  assert.match(organisationDirectoryHtml, /requestOrganisationMembership/);
});

test('organisation verification review page parses and is protected by the trusted platform callable', () => {
  const blocks = [...organisationVerificationAdminHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-verification-inline-' + index + '.js' }));
  }
  assert.match(organisationVerificationAdminHtml, /reviewOrganisationVerification/);
  assert.match(organisationFunctions, /HAMLET_SUPER_ADMIN_UID = "6epDJRISlBbRPWKosDZZWuiGQzK2"/);
  assert.match(organisationDirectoryHtml, /Hamlet verified/);
  assert.match(firestore, /match \/organisationVerificationRequests\/{organisationId}/);
});

test('organisation audit page script parses and file removal uses the trusted lifecycle callable', () => {
  const blocks = [...organisationActivityHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-activity-inline-' + index + '.js' }));
  }
  assert.match(organisationFilesHtml, /deleteOrganisationDocument/);
  assert.match(organisationFunctions, /exports\.deleteOrganisationDocument = onCall/);
  assert.match(organisationAuditFunctions, /exports\.recordOrganisationDocumentActivity/);
  assert.match(organisationActivityHtml, /organisation\.document_uploaded/);
  assert.match(organisationActivityHtml, /organisation\.document_deleted/);
});

test('personal-record association is explicit, tenant-scoped, owner-checked and snapshot-only', () => {
  const blocks = [...organisationAssociationHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-association-inline-' + index + '.js' }));
  }
  assert.match(organisationAssociationHtml, /explicitly authorise organisation owners and administrators/);
  assert.match(organisationAssociationHtml, /The original stays unchanged/);
  assert.match(organisationFunctions, /exports\.copyPersonalResourceToOrganisation = onCall/);
  assert.match(organisationFunctions, /sourceOwner !== user\.uid/);
  assert.match(organisationFunctions, /visibility: "restricted"/);
  assert.match(firestore, /match \/organisationResourceImports\/{importId}/);
  assert.match(appOrganisationsHtml, /organisation-association\.html/);
});

test('organisation analytics client parses and is connected to a restricted aggregate callable', () => {
  const blocks = [...organisationAnalyticsHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-analytics-inline-' + index + '.js' }));
  }
  assert.match(organisationFunctions, /exports\.getOrganisationAnalytics = onCall/);
  assert.match(organisationFunctions, /requireRole\(memberSnap\.exists \? memberSnap\.data\(\) : null, \["owner", "admin"\]\)/);
  assert.match(appOrganisationsHtml, /organisation-analytics\.html/);
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


test('organisation property portfolio is authenticated, tenant-scoped and separate from personal assets', () => {
  const propertyHtml = fs.readFileSync('app/hamlet/organisation-properties.html', 'utf8');
  const blocks = [...propertyHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 1, 'expected organisation property workspace application script');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-properties-inline-' + index + '.js' }));
  }
  assert.match(propertyHtml, /name="robots" content="noindex,nofollow"/);
  assert.match(propertyHtml, /collection\('organisationProperties'\)/);
  assert.match(propertyHtml, /organisationId:activeOrg\.id/);
  assert.match(propertyHtml, /createdByUid:existing\?existing\.createdByUid:user\.uid/);
  assert.match(propertyHtml, /Firestore Rules|Security boundary/);
  assert.doesNotMatch(propertyHtml, /collection\('(commercialProperties|residentialProperties|publicProperties|publicResidentialProperties)'\)/);
  assert.match(firestore, /function validPropertyRecord\(data\)/);
  assert.match(firestore, /data\.propertyType in \['Commercial','Residential'\]/);
  assert.match(appOrganisationsHtml, /href="\/app\/hamlet\/organisation-properties\.html"/);
});


test('organisation teams expose only implemented capabilities and team assignment controls', () => {
  const teamsHtml = fs.readFileSync('app/hamlet/organisation-teams.html', 'utf8');
  const teamFunctions = fs.readFileSync('functions/hamlet-organisation-teams.js', 'utf8');
  const propertiesHtml = fs.readFileSync('app/hamlet/organisation-properties.html', 'utf8');
  assert.ok(teamsHtml.includes('deals.read'));
  assert.ok(teamsHtml.includes('properties.write'));
  assert.ok(!teamsHtml.includes('documents.read') && !teamsHtml.includes('documents.write') && !teamsHtml.includes('members.view'));
  assert.ok(!teamFunctions.includes('exports.organisationTeamPermissions'));
  assert.ok(organisationDealsHtml.includes('assignResourceTeam'));
  assert.ok(propertiesHtml.includes('assignResourceTeam'));
  assert.ok(firestore.includes("data.visibility == 'restricted'"));
});

test('organisation document workspace JavaScript parses and uses tenant-scoped Storage paths', () => {
  const blocks = [...organisationFilesHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[2].trim() && !/\bsrc\s*=/.test(match[1]));
  assert.ok(blocks.length >= 1, 'expected organisation document workspace application script');
  for (const [index, block] of blocks.entries()) {
    assert.doesNotThrow(() => new vm.Script(block[2], { filename: 'organisation-files-inline-' + index + '.js' }));
  }
  assert.match(organisationFilesHtml, /firebase-storage-compat\.js/);
  assert.match(organisationFilesHtml, /organisationDocuments\/['"]\+activeOrg\.organisationId/);
  assert.match(organisationFilesHtml, /organisationResourceShares/);
  assert.match(organisationFilesHtml, /15\*1024\*1024/);
  assert.match(organisationFilesHtml, /getDownloadURL/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, getDoc, setDoc, deleteDoc, serverTimestamp} = require('firebase/firestore');
const {ref, uploadBytes, getBytes} = require('firebase/storage');

let env;
const projectId = 'demo-hamlet-rules';

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {rules: fs.readFileSync('firestore.rules', 'utf8')},
    storage: {rules: fs.readFileSync('storage.rules', 'utf8')},
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'hamletDeals/deal-owner'), {
      id: 'deal-owner', uid: 'owner', name: 'Test deal', property: '',
      type: 'Acquisition', value: 0, stage: 'Initial Inspection',
      owner: '', client: '', notes: '', createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: new Date(),
    });
  });
});

test('only a message sender can permanently delete their own message', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'directMessages/message-from-owner'), {
      senderUid: 'owner', recipientUid: 'other', participants: ['owner', 'other'],
      body: 'Sent by owner', sentAt: new Date(), pinnedBy: [], readBy: [],
    });
    await setDoc(doc(db, 'directMessages/message-from-other'), {
      senderUid: 'other', recipientUid: 'owner', participants: ['other', 'owner'],
      body: 'Sent by other', sentAt: new Date(), pinnedBy: [], readBy: [],
    });
  });

  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();

  await assertFails(deleteDoc(doc(other, 'directMessages/message-from-owner')));
  await assertFails(deleteDoc(doc(owner, 'directMessages/message-from-other')));
  await assertSucceeds(deleteDoc(doc(owner, 'directMessages/message-from-owner')));
  await assertSucceeds(deleteDoc(doc(other, 'directMessages/message-from-other')));
});

test('deal records are private to the broker UID', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();
  await assertSucceeds(getDoc(doc(owner, 'hamletDeals/deal-owner')));
  await assertFails(getDoc(doc(other, 'hamletDeals/deal-owner')));
});

test('history entries are readable by their owner but never client-writable', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'hamletDealEvents/event-1'), {
      id: 'event-1', uid: 'owner', dealId: 'deal-owner', dealName: 'Test deal',
      eventType: 'created', stageFrom: '', stageTo: 'Initial Inspection',
      summary: 'Transaction created', changedFields: ['name'],
      createdAt: new Date(),
    });
  });
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();
  await assertSucceeds(getDoc(doc(owner, 'hamletDealEvents/event-1')));
  await assertFails(getDoc(doc(other, 'hamletDealEvents/event-1')));
  await assertFails(setDoc(doc(owner, 'hamletDealEvents/fake'), {
    id: 'fake', uid: 'owner', dealId: 'deal-owner', dealName: 'Forged',
    eventType: 'updated', stageFrom: '', stageTo: '', summary: 'fake',
    changedFields: [], createdAt: serverTimestamp(),
  }));
});

test('transaction document metadata is private and tied to an owned deal', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();
  const metadata = {
    id: 'doc-1', uid: 'owner', dealId: 'deal-owner', title: 'Heads of terms',
    category: 'Legal', fileName: 'heads.pdf',
    storagePath: 'hamletDocuments/owner/deal-owner/doc-1/heads.pdf',
    size: 3, contentType: 'application/pdf', notes: '',
    createdAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(owner, 'hamletDocuments/doc-1'), metadata));
  await assertSucceeds(getDoc(doc(owner, 'hamletDocuments/doc-1')));
  await assertFails(getDoc(doc(other, 'hamletDocuments/doc-1')));
  await assertFails(setDoc(doc(other, 'hamletDocuments/doc-forged'), {
    ...metadata, id: 'doc-forged', uid: 'other',
  }));
});

test('saved searches can be maintained by their owner only', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const other = env.authenticatedContext('other').firestore();
  const search = {
    id: 'search-1', uid: 'owner', name: 'Acquisitions', query: 'London',
    stage: '', type: 'Acquisition', alertsEnabled: true, lastMatchedIds: [],
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(owner, 'hamletSavedSearches/search-1'), search));
  await assertSucceeds(getDoc(doc(owner, 'hamletSavedSearches/search-1')));
  await assertFails(getDoc(doc(other, 'hamletSavedSearches/search-1')));
  await assertSucceeds(setDoc(doc(owner, 'hamletSavedSearches/search-1'), {
    lastMatchedIds: ['deal-owner'], updatedAt: serverTimestamp(),
  }, {merge: true}));
});

test('transaction files are owner-restricted in Firebase Storage', async () => {
  const ownerStorage = env.authenticatedContext('owner').storage();
  const otherStorage = env.authenticatedContext('other').storage();
  const filePath = 'hamletDocuments/owner/deal-owner/doc-1/heads.pdf';
  await assertSucceeds(uploadBytes(ref(ownerStorage, filePath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
  await assertSucceeds(getBytes(ref(ownerStorage, filePath)));
  await assertFails(getBytes(ref(otherStorage, filePath)));
  await assertFails(uploadBytes(ref(otherStorage, filePath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
});

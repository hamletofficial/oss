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
    const db = context.firestore();
    await setDoc(doc(db, 'organisations/org-private'), {
      id: 'org-private', name: 'Private Organisation', slug: 'private-org',
      status: 'active', visibility: 'private', ownerUid: 'owner',
    });
    await setDoc(doc(db, 'organisationSlugs/private-org'), {
      organisationId: 'org-private', status: 'active',
    });
    await setDoc(doc(db, 'organisationDirectory/org-private'), {
      organisationId: 'org-private', name: 'Private Organisation',
      slug: 'private-org', isPublic: false, status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_owner'), {
      organisationId: 'org-private', uid: 'owner', role: 'owner', status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_admin'), {
      organisationId: 'org-private', uid: 'admin', role: 'admin', status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_member'), {
      organisationId: 'org-private', uid: 'member', role: 'member', status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_suspended'), {
      organisationId: 'org-private', uid: 'suspended', role: 'member', status: 'suspended',
    });
    await setDoc(doc(db, 'organisationMembers/org-other_outsider'), {
      organisationId: 'org-other', uid: 'outsider', role: 'owner', status: 'active',
    });
    await setDoc(doc(db, 'organisationInvitations/invite-private'), {
      organisationId: 'org-private', email: 'invitee@example.com', status: 'pending',
    });
    await setDoc(doc(db, 'organisationActivity/activity-private'), {
      organisationId: 'org-private', actorUid: 'owner', action: 'organisation.created',
    });
    await setDoc(doc(db, 'organisationDirectory/org-public'), {
      organisationId: 'org-public', name: 'Public Organisation',
      slug: 'public-org', isPublic: true, status: 'active',
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


test('organisation documents are readable only by active members of that organisation', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const member = env.authenticatedContext('member').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  await assertSucceeds(getDoc(doc(owner, 'organisations/org-private')));
  await assertSucceeds(getDoc(doc(member, 'organisations/org-private')));
  await assertFails(getDoc(doc(outsider, 'organisations/org-private')));
});

test('members can read their own membership and organisation admins can read the roster', async () => {
  const member = env.authenticatedContext('member').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  await assertSucceeds(getDoc(doc(member, 'organisationMembers/org-private_member')));
  await assertFails(getDoc(doc(member, 'organisationMembers/org-private_owner')));
  await assertSucceeds(getDoc(doc(admin, 'organisationMembers/org-private_member')));
});

test('organisation slug lookup is exact-get only and cannot be enumerated', async () => {
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthenticated, 'organisationSlugs/private-org')));
});

test('only active public directory projections are publicly readable', async () => {
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthenticated, 'organisationDirectory/org-public')));
  await assertFails(getDoc(doc(unauthenticated, 'organisationDirectory/org-private')));
});

test('organisation lifecycle and audit collections are not client-writable', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(owner, 'organisations/org-forged'), {
    id: 'org-forged', name: 'Forged', status: 'active',
  }));
  await assertFails(setDoc(doc(owner, 'organisationMembers/org-private_attacker'), {
    organisationId: 'org-private', uid: 'attacker', role: 'owner', status: 'active',
  }));
  await assertFails(setDoc(doc(owner, 'organisationInvitations/fake'), {
    organisationId: 'org-private', email: 'attacker@example.com', status: 'pending',
  }));
  await assertFails(setDoc(doc(owner, 'organisationActivity/fake'), {
    organisationId: 'org-private', actorUid: 'owner', action: 'forged',
  }));
});


test('membership in a different organisation does not grant cross-tenant access', async () => {
  const otherTenantOwner = env.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(otherTenantOwner, 'organisations/org-private')));
});

test('suspended members lose access to organisation data', async () => {
  const suspended = env.authenticatedContext('suspended').firestore();
  await assertFails(getDoc(doc(suspended, 'organisations/org-private')));
});

test('organisation invitations are visible only to active organisation administrators', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const member = env.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(owner, 'organisationInvitations/invite-private')));
  await assertFails(getDoc(doc(member, 'organisationInvitations/invite-private')));
});

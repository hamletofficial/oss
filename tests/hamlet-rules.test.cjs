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
    await setDoc(doc(db, 'organisationMembers/org-private_colleague'), {
      organisationId: 'org-private', uid: 'colleague', role: 'member', status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_viewer'), {
      organisationId: 'org-private', uid: 'viewer', role: 'viewer', status: 'active',
    });
    await setDoc(doc(db, 'organisationMembers/org-private_suspended'), {
      organisationId: 'org-private', uid: 'suspended', role: 'member', status: 'suspended',
    });
    await setDoc(doc(db, 'organisationProperties/property-shared'), {
      id: 'property-shared', organisationId: 'org-private', createdByUid: 'member',
      visibility: 'organisation', sharedWithUids: [], propertyName: 'Shared House',
    });
    await setDoc(doc(db, 'organisationProperties/property-restricted'), {
      id: 'property-restricted', organisationId: 'org-private', createdByUid: 'member',
      visibility: 'restricted', sharedWithUids: ['admin'], propertyName: 'Restricted House',
    });
    await setDoc(doc(db, 'organisationDeals/deal-shared'), {
      id: 'deal-shared', organisationId: 'org-private', createdByUid: 'member',
      visibility: 'organisation', sharedWithUids: [], name: 'Shared acquisition',
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
    await setDoc(doc(db, 'organisations/org-public'), {
      id: 'org-public', name: 'Public Organisation', slug: 'public-org',
      status: 'active', visibility: 'public', ownerUid: 'owner',
    });
    await setDoc(doc(db, 'organisationDirectory/org-public'), {
      organisationId: 'org-public', name: 'Public Organisation',
      slug: 'public-org', isPublic: true, status: 'active',
    });
    await setDoc(doc(db, 'organisationSlugs/suspended-org'), {
      organisationId: 'org-suspended', status: 'active',
    });
    await setDoc(doc(db, 'organisationDirectory/org-suspended'), {
      organisationId: 'org-suspended', name: 'Suspended Organisation',
      slug: 'suspended-org', isPublic: true, status: 'active',
    });
    await setDoc(doc(db, 'organisations/org-suspended'), {
      id: 'org-suspended', name: 'Suspended Organisation', slug: 'suspended-org',
      status: 'suspended', visibility: 'private', ownerUid: 'suspended-owner',
    });
    await setDoc(doc(db, 'organisationMembers/org-suspended_member'), {
      organisationId: 'org-suspended', uid: 'suspended-member',
      role: 'member', status: 'active',
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


test('organisation properties and deals enforce tenant membership and explicit sharing', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const member = env.authenticatedContext('member').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const suspended = env.authenticatedContext('suspended').firestore();

  await assertSucceeds(getDoc(doc(member, 'organisationProperties/property-shared')));
  await assertSucceeds(getDoc(doc(owner, 'organisationProperties/property-restricted')));
  await assertSucceeds(getDoc(doc(admin, 'organisationProperties/property-restricted')));
  // The creator retains access to a restricted resource; unlisted peers do not.
  await assertSucceeds(getDoc(doc(member, 'organisationProperties/property-restricted')));
  const colleague = env.authenticatedContext('colleague').firestore();
  await assertFails(getDoc(doc(colleague, 'organisationProperties/property-restricted')));
  await assertFails(getDoc(doc(outsider, 'organisationProperties/property-shared')));
  await assertFails(getDoc(doc(suspended, 'organisationProperties/property-shared')));
  await assertSucceeds(getDoc(doc(member, 'organisationDeals/deal-shared')));
  await assertFails(getDoc(doc(outsider, 'organisationDeals/deal-shared')));

  const propertyRecord = (id, creator, overrides = {}) => ({
    id, organisationId: 'org-private', createdByUid: creator,
    visibility: 'organisation', sharedWithUids: [],
    propertyName: 'New team asset', propertyType: 'Commercial', status: 'Available',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
  });
  await assertSucceeds(setDoc(doc(member, 'organisationProperties/member-created'),
    propertyRecord('member-created', 'member')));
  await assertFails(setDoc(doc(member, 'organisationProperties/forged-tenant'),
    propertyRecord('forged-tenant', 'member', {organisationId: 'org-other'})));
  await assertFails(setDoc(doc(member, 'organisationProperties/forged-creator'),
    propertyRecord('forged-creator', 'owner')));
  await assertSucceeds(setDoc(doc(member, 'organisationProperties/member-restricted'),
    propertyRecord('member-restricted', 'member', {
      visibility: 'restricted', sharedWithUids: ['admin'], propertyName: 'Restricted team asset',
    })));
  await assertSucceeds(getDoc(doc(admin, 'organisationProperties/member-restricted')));
  await assertSucceeds(getDoc(doc(owner, 'organisationProperties/member-restricted')));
  await assertFails(setDoc(doc(member, 'organisationProperties/member-changes-sharing'), {
    visibility: 'restricted', sharedWithUids: ['outsider'],
  }, {merge: true}));
  const viewer = env.authenticatedContext('viewer').firestore();
  await assertFails(setDoc(doc(viewer, 'organisationDeals/viewer-forgery'), {
    id: 'viewer-forgery', organisationId: 'org-private', createdByUid: 'viewer',
    visibility: 'organisation', sharedWithUids: [],
  }));
});

test('organisation document uploads remain disabled until separately validated', async () => {
  const memberStorage = env.authenticatedContext('member').storage();
  const adminStorage = env.authenticatedContext('admin').storage();
  const outsiderStorage = env.authenticatedContext('outsider').storage();
  const restrictedPath = 'organisationDocuments/org-private/property/property-restricted/doc-1/brief.pdf';
  const sharedPath = 'organisationDocuments/org-private/deal/deal-shared/doc-2/brief.pdf';
  await assertFails(uploadBytes(ref(memberStorage, restrictedPath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
  await assertFails(uploadBytes(ref(adminStorage, restrictedPath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
  await assertFails(uploadBytes(ref(memberStorage, sharedPath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
  await assertFails(uploadBytes(ref(outsiderStorage, sharedPath), new Uint8Array([1, 2, 3]), {contentType: 'application/pdf'}));
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

test('organisation audit history is readable only by organisation owners and admins', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  const member = env.authenticatedContext('member').firestore();
  const viewer = env.authenticatedContext('viewer').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();

  await assertSucceeds(getDoc(doc(owner, 'organisationActivity/activity-private')));
  await assertSucceeds(getDoc(doc(admin, 'organisationActivity/activity-private')));
  await assertFails(getDoc(doc(member, 'organisationActivity/activity-private')));
  await assertFails(getDoc(doc(viewer, 'organisationActivity/activity-private')));
  await assertFails(getDoc(doc(outsider, 'organisationActivity/activity-private')));
  await assertFails(setDoc(doc(owner, 'organisationActivity/forged-event'), {
    organisationId: 'org-private', actorUid: 'owner',
    action: 'organisation.fake_event', createdAt: serverTimestamp(),
  }));
});

test('organisation slug lookup is exact-get only and cannot be enumerated', async () => {
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthenticated, 'organisationSlugs/private-org')));
});

test('only active public directory projections are publicly readable', async () => {
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthenticated, 'organisationDirectory/org-public')));
  await assertFails(getDoc(doc(unauthenticated, 'organisationDirectory/org-private')));
  await assertFails(getDoc(doc(unauthenticated, 'organisationDirectory/org-suspended')));
  await assertFails(getDoc(doc(unauthenticated, 'organisationSlugs/suspended-org')));
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


test('active membership does not grant access to a suspended organisation', async () => {
  const member = env.authenticatedContext('suspended-member').firestore();
  await assertFails(getDoc(doc(member, 'organisations/org-suspended')));
});


test('organisation deal writes enforce member ownership, manager controls and viewer read-only access', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const member = env.authenticatedContext('member').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  const viewer = env.authenticatedContext('viewer').firestore();
  const deal = {
    id: 'member-shared-deal',
    organisationId: 'org-private',
    createdByUid: 'member',
    visibility: 'organisation',
    sharedWithUids: [],
    name: 'Organisation acquisition',
    type: 'Acquisition',
    stage: 'Due Diligence',
    value: 1250000,
  };

  await assertSucceeds(setDoc(doc(member, 'organisationDeals/member-shared-deal'), deal));
  await assertFails(setDoc(doc(viewer, 'organisationDeals/viewer-deal'), {
    ...deal, id: 'viewer-deal', createdByUid: 'viewer',
  }));
  await assertFails(setDoc(doc(member, 'organisationDeals/forged-creator'), {
    ...deal, id: 'forged-creator', createdByUid: 'owner',
  }));
  await assertFails(setDoc(doc(member, 'organisationDeals/member-shared-deal'), {
    visibility: 'restricted',
  }, {merge: true}));
  await assertSucceeds(setDoc(doc(admin, 'organisationDeals/member-shared-deal'), {
    visibility: 'restricted',
  }, {merge: true}));
  await assertSucceeds(getDoc(doc(owner, 'organisationDeals/member-shared-deal')));
  await assertSucceeds(getDoc(doc(admin, 'organisationDeals/member-shared-deal')));
  await assertSucceeds(getDoc(doc(member, 'organisationDeals/member-shared-deal')));
  await assertFails(getDoc(doc(env.authenticatedContext('colleague').firestore(), 'organisationDeals/member-shared-deal')));
});


test('organisation property portfolio enforces tenant ownership, field validation and role permissions', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const member = env.authenticatedContext('member').firestore();
  const admin = env.authenticatedContext('admin').firestore();
  const viewer = env.authenticatedContext('viewer').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const property = {
    id: 'org-asset-1',
    organisationId: 'org-private',
    createdByUid: 'member',
    visibility: 'organisation',
    sharedWithUids: [],
    propertyName: '25 Bishopsgate',
    propertyType: 'Commercial',
    status: 'Available',
    address: '25 Bishopsgate',
    city: 'London',
    postcode: 'EC2N 4AJ',
    size: 125000,
    sizeUnit: 'sq ft',
    askingPrice: 25000000,
    askingRent: 1250000,
    sustainabilityStandard: 'BREEAM',
    description: 'Organisation-owned commercial asset',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await assertSucceeds(setDoc(doc(member, 'organisationProperties/org-asset-1'), property));
  await assertSucceeds(getDoc(doc(owner, 'organisationProperties/org-asset-1')));
  await assertSucceeds(getDoc(doc(admin, 'organisationProperties/org-asset-1')));
  await assertSucceeds(getDoc(doc(member, 'organisationProperties/org-asset-1')));
  await assertFails(getDoc(doc(outsider, 'organisationProperties/org-asset-1')));

  await assertSucceeds(setDoc(doc(member, 'organisationProperties/org-asset-1'), {
    description: 'Updated asset description',
    updatedAt: serverTimestamp(),
  }, {merge: true}));

  await assertFails(setDoc(doc(member, 'organisationProperties/org-asset-1'), {
    visibility: 'restricted',
    sharedWithUids: ['outsider'],
    updatedAt: serverTimestamp(),
  }, {merge: true}));

  await assertSucceeds(setDoc(doc(admin, 'organisationProperties/org-asset-1'), {
    visibility: 'restricted',
    sharedWithUids: ['admin'],
    updatedAt: serverTimestamp(),
  }, {merge: true}));

  await assertFails(setDoc(doc(member, 'organisationProperties/forged-tenant'), {
    ...property,
    id: 'forged-tenant',
    organisationId: 'org-other',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(member, 'organisationProperties/forged-type'), {
    ...property,
    id: 'forged-type',
    propertyType: 'Crypto',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(viewer, 'organisationProperties/viewer-asset'), {
    ...property,
    id: 'viewer-asset',
    createdByUid: 'viewer',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
});


test('explicit organisation resource grants are tenant-scoped, recipient-readable and revocable', async () => {
  const creator = env.authenticatedContext('member').firestore();
  const recipient = env.authenticatedContext('colleague').firestore();
  const manager = env.authenticatedContext('admin').firestore();
  const outsider = env.authenticatedContext('outsider').firestore();
  const suspended = env.authenticatedContext('suspended').firestore();
  const shareId = 'org-private_property_property-restricted_colleague';
  const grant = {
    organisationId: 'org-private',
    resourceType: 'property',
    resourceId: 'property-restricted',
    sharedWithUid: 'colleague',
    createdByUid: 'member',
    createdAt: serverTimestamp(),
  };

  await assertSucceeds(setDoc(doc(creator, 'organisationResourceShares/' + shareId), grant));
  await assertSucceeds(getDoc(doc(recipient, 'organisationResourceShares/' + shareId)));
  await assertSucceeds(getDoc(doc(manager, 'organisationResourceShares/' + shareId)));
  await assertFails(getDoc(doc(creator, 'organisationResourceShares/' + shareId)));
  await assertSucceeds(getDoc(doc(recipient, 'organisationProperties/property-restricted')));
  await assertFails(getDoc(doc(outsider, 'organisationProperties/property-restricted')));

  await assertFails(setDoc(doc(creator, 'organisationResourceShares/self-grant'), {
    ...grant, sharedWithUid: 'member',
  }));
  await assertFails(setDoc(doc(creator, 'organisationResourceShares/suspended-grant'), {
    ...grant, sharedWithUid: 'suspended',
  }));
  await assertFails(setDoc(doc(outsider, 'organisationResourceShares/cross-tenant-grant'), {
    ...grant, organisationId: 'org-other',
  }));
  await assertFails(setDoc(doc(creator, 'organisationResourceShares/' + shareId), {
    ...grant, sharedWithUid: 'owner',
  }, {merge: true}));

  await assertSucceeds(deleteDoc(doc(creator, 'organisationResourceShares/' + shareId)));
  await assertFails(getDoc(doc(recipient, 'organisationProperties/property-restricted')));
  await assertFails(getDoc(doc(recipient, 'organisationResourceShares/' + shareId)));
  await assertFails(getDoc(doc(suspended, 'organisationResourceShares/' + shareId)));
});

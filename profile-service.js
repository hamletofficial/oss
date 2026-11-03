(function (global) {
  'use strict';

  // Canonical client-side access layer for publicProfiles/{uid}.
  // Keep this module focused on profile data; authorization remains enforced by Firestore rules.
  if (global.ibrProfileService) return;

  function firestore() {
    if (!global.firebase || typeof global.firebase.firestore !== 'function') {
      return Promise.reject(new Error('Firebase Firestore is not available.'));
    }
    return Promise.resolve(global.firebase.firestore());
  }

  function profileRef(db, uid) {
    if (!uid || typeof uid !== 'string') throw new Error('A valid profile UID is required.');
    return db.collection('publicProfiles').doc(uid);
  }

  function normalizeProfile(data) {
    var profile = data && typeof data === 'object' ? data : {};
    var firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
    var lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
    var displayName = [firstName, lastName].filter(Boolean).join(' ')
      || (typeof profile.displayName === 'string' ? profile.displayName.trim() : '')
      || (typeof profile.name === 'string' ? profile.name.trim() : '');
    var imageDataUrl = typeof profile.imageDataUrl === 'string' ? profile.imageDataUrl.trim() : '';
    return Object.assign({}, profile, {
      firstName: firstName,
      lastName: lastName,
      displayName: displayName,
      imageDataUrl: imageDataUrl
    });
  }

  var service = {
    collectionName: 'publicProfiles',

    async getProfile(uid) {
      var db = await firestore();
      var snapshot = await profileRef(db, uid).get();
      return {
        exists: snapshot.exists,
        data: normalizeProfile(snapshot.exists ? snapshot.data() : {})
      };
    },

    async listPublicProfiles() {
      var db = await firestore();
      var snapshot = await db.collection('publicProfiles').where('isPublic', '==', true).get();
      return snapshot.docs.map(function (doc) {
        return { uid: doc.id, data: normalizeProfile(doc.data() || {}) };
      });
    },

    async saveProfile(uid, fields) {
      var db = await firestore();
      var payload = Object.assign({}, fields || {});
      // Identity verification is managed by the verification process, never by profile editing.
      delete payload.onfidoVerified;
      delete payload.uid;
      await profileRef(db, uid).set(Object.assign(payload, {
        uid: uid,
        updatedAt: global.firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
      return this.getProfile(uid);
    },

    async updateProfile(uid, fields) {
      var db = await firestore();
      var payload = Object.assign({}, fields || {});
      delete payload.onfidoVerified;
      delete payload.uid;
      await profileRef(db, uid).set(Object.assign(payload, {
        uid: uid,
        updatedAt: global.firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
      return this.getProfile(uid);
    },

    watchProfile(uid, onChange, onError) {
      if (typeof onChange !== 'function') throw new Error('A profile change callback is required.');
      if (!global.firebase || typeof global.firebase.firestore !== 'function') {
        throw new Error('Firebase Firestore is not available.');
      }
      return profileRef(global.firebase.firestore(), uid).onSnapshot(function (snapshot) {
        onChange({
          exists: snapshot.exists,
          data: normalizeProfile(snapshot.exists ? snapshot.data() : {})
        });
      }, typeof onError === 'function' ? onError : function (error) {
        console.error('Unable to watch profile data:', error);
      });
    }
  };

  global.ibrProfileService = Object.freeze(service);
})(window);

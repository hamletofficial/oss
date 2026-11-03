const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Parser = require('rss-parser');
const postmark = require('postmark');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();
const postmarkToken = defineSecret('POSTMARK_BROADCAST_TOKEN');

// Shared RSS parser and URL
const parser = new Parser();
const SUBSTACK_RSS_URL = 'https://blogs.ibrecruitment.com/feed';

// Cloud Function: Fetch RSS feed and store entries in Firestore
// Node.js 22+ compatible
exports.fetchAndStoreRssToInsightsFeed = functions
  .runWith({
    // Node.js 22 is default for new Firebase projects, but can be set in firebase.json if needed
    timeoutSeconds: 120,
    memory: '256MB',
  })
  .pubsub.schedule('every 15 minutes').onRun(async (context) => {
    const feed = await parser.parseURL(SUBSTACK_RSS_URL);
    const db = admin.firestore();
    const batch = db.batch();
    let newCount = 0;

    for (const entry of feed.items) {
      
      const docId = Buffer.from(entry.guid || entry.link).toString('base64').replace(/\//g, '_');
      const docRef = db.collection('insightsFeed').doc(docId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        batch.set(docRef, {
          title: entry.title || '',
          snippet: entry.contentSnippet || entry.summary || '',
          link: entry.link || '',
          timestamp: entry.isoDate ? new Date(entry.isoDate).getTime() : Date.now(),
          notified: false,
          test: false,
          rssSource: 'substack',
          guid: entry.guid || entry.link || '',
        });
        newCount++;
      }
    }
    if (newCount > 0) await batch.commit();
    return { inserted: newCount };
  });


exports.adminFetchAndRelayRss = functions
  .runWith({ secrets: [postmarkToken] })
  .firestore
  .document('insightsFeed/{postId}')
  .onCreate(async (snap, context) => {
    const post = snap.data();
    const postRef = snap.ref;
    // Get the secret value at runtime
    const postmarkClient = new postmark.ServerClient(postmarkToken.value());

    // 1. Idempotency: Check if already notified
    if (post.notified) return null;

    // 2 & 4. Time limit and test/old data filtering
    const now = Date.now();
    const postTime = post.timestamp || now;
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
    if ((now - postTime) > maxAgeMs) return null;
    if (post.test) return null;


    // 6. Unsubscribe/Opt-Out Logic
    let usersSnap;
    try {
      usersSnap = await admin.firestore().collection('publicProfiles').get();
    } catch (err) {
      console.error('Error fetching users:', err);
      return null;
    }
    const emails = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.email && !data.unsubscribed) emails.push(data.email);
    });
    if (emails.length === 0) return null;

    // HTML5 email template with unsubscribe link
    const htmlBody = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${post.title || 'New Premium Content'}</title>
      </head>
      <body style="font-family: 'Open Sans', Arial, sans-serif; color: #0f172a; background: #f5f9ff;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(2,6,23,0.08);padding:32px;">
          <h1 style="color:#0284c7;">${post.title || 'New Premium Content'}</h1>
          <p style="color:#475569;font-size:1.1rem;">${post.snippet || ''}</p>
          <a href="${post.link || '#'}" style="display:inline-block;margin:18px 0 0 0;padding:12px 24px;background:#0284c7;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Read More</a>
          <hr style="margin:32px 0 16px 0;border:none;border-top:1px solid #e5e7eb;">
          <div style="font-size:0.95rem;color:#475569;text-align:center;">
            You are receiving this email because you are a member of Impact in Business Recruitment.<br>
            <a href="https://www.ibrecruitment.com/unsubscribe?email={{email}}" style="color:#0284c7;text-decoration:underline;">Unsubscribe</a>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      for (let i = 0; i < emails.length; i += 50) {
        const batch = emails.slice(i, i + 50).map(email => ({
          From: 'admin-messages@ibrecruitment.com',
          To: email,
          Subject: `New Insight: ${post.title || 'Update from Impact in Business Recruitment'}`,
          HtmlBody: htmlBody.replace('{{email}}', encodeURIComponent(email)),
          TextBody: `${post.title || 'New Insight'}\n\n${post.snippet || ''}\n\nRead more: ${post.link || ''}\n\nUnsubscribe: https://www.ibrecruitment.com/unsubscribe?email=${encodeURIComponent(email)}`,
          MessageStream: 'broadcast'
        }));
        await postmarkClient.sendEmailBatch(batch);
      }
      // 1. Mark as notified
      await postRef.update({ notified: true });
    } catch (err) {
      console.error('Error sending emails or updating document:', err);
    }
    return null;
  });
// --- End adminFetchAndRelayRss and dependencies ---

function readRequisitionText(data, field, maxLength, required = false) {
  const value = data[field];
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new functions.https.HttpsError('invalid-argument', `${field} is required.`);
    }
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new functions.https.HttpsError('invalid-argument', `${field} must be text of at most ${maxLength} characters.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new functions.https.HttpsError('invalid-argument', `${field} is required.`);
  }
  return normalized;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

exports.submitJobRequisition = functions
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
    secrets: [postmarkToken],
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in before submitting a job requisition.');
    }

    const allowedFields = [
      'jobTitle', 'department', 'hiringManager', 'workLocation', 'workplaceType',
      'employmentType', 'numberOfOpenings', 'targetStartDate', 'salaryRange',
      'urgency', 'budgetApproved', 'applicationUrl', 'jobDescription',
      'requirements', 'additionalNotes',
    ];
    if (!data || typeof data !== 'object' || Object.keys(data).some((field) => !allowedFields.includes(field))) {
      throw new functions.https.HttpsError('invalid-argument', 'The requisition submission contains invalid fields.');
    }

    const requisition = {
      jobTitle: readRequisitionText(data, 'jobTitle', 160, true),
      department: readRequisitionText(data, 'department', 120, true),
      hiringManager: readRequisitionText(data, 'hiringManager', 120, true),
      workLocation: readRequisitionText(data, 'workLocation', 160, true),
      workplaceType: readRequisitionText(data, 'workplaceType', 20, true),
      employmentType: readRequisitionText(data, 'employmentType', 20, true),
      targetStartDate: readRequisitionText(data, 'targetStartDate', 10),
      salaryRange: readRequisitionText(data, 'salaryRange', 120),
      urgency: readRequisitionText(data, 'urgency', 20, true),
      budgetApproved: readRequisitionText(data, 'budgetApproved', 20, true),
      applicationUrl: readRequisitionText(data, 'applicationUrl', 500),
      jobDescription: readRequisitionText(data, 'jobDescription', 6000, true),
      requirements: readRequisitionText(data, 'requirements', 4000),
      additionalNotes: readRequisitionText(data, 'additionalNotes', 3000),
    };

    const workplaceTypes = ['On-site', 'Hybrid', 'Remote'];
    const employmentTypes = ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship'];
    const urgencyLevels = ['Standard', 'High', 'Urgent'];
    const budgetStatuses = ['Yes', 'No', 'Pending'];
    const openings = Number(data.numberOfOpenings);
    if (!Number.isInteger(openings) || openings < 1 || openings > 500) {
      throw new functions.https.HttpsError('invalid-argument', 'Number of openings must be between 1 and 500.');
    }
    if (!workplaceTypes.includes(requisition.workplaceType) || !employmentTypes.includes(requisition.employmentType) ||
        !urgencyLevels.includes(requisition.urgency) || !budgetStatuses.includes(requisition.budgetApproved)) {
      throw new functions.https.HttpsError('invalid-argument', 'One or more selected requisition options are invalid.');
    }
    requisition.numberOfOpenings = openings;

    if (requisition.targetStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(requisition.targetStartDate)) {
      throw new functions.https.HttpsError('invalid-argument', 'Target start date must use YYYY-MM-DD format.');
    }
    if (requisition.applicationUrl) {
      let applicationUrl;
      try {
        applicationUrl = new URL(requisition.applicationUrl);
      } catch (err) {
        throw new functions.https.HttpsError('invalid-argument', 'Application link must be a valid URL.');
      }
      if (!['http:', 'https:'].includes(applicationUrl.protocol)) {
        throw new functions.https.HttpsError('invalid-argument', 'Application link must use HTTP or HTTPS.');
      }
    }

    const requesterName = String(context.auth.token.name || 'Signed-in user').slice(0, 160);
    const requesterEmail = String(context.auth.token.email || '').slice(0, 254);
    const emailFields = [
      ['Job title', requisition.jobTitle],
      ['Department / team', requisition.department],
      ['Hiring manager', requisition.hiringManager],
      ['Work location', requisition.workLocation],
      ['Work arrangement', requisition.workplaceType],
      ['Employment type', requisition.employmentType],
      ['Number of openings', String(requisition.numberOfOpenings)],
      ['Target start date', requisition.targetStartDate || 'Not specified'],
      ['Salary range', requisition.salaryRange || 'Not specified'],
      ['Hiring priority', requisition.urgency],
      ['Budget approved', requisition.budgetApproved],
      ['Application / role link', requisition.applicationUrl || 'Not provided'],
      ['Role summary and responsibilities', requisition.jobDescription],
      ['Required experience and qualifications', requisition.requirements || 'Not provided'],
      ['Additional notes', requisition.additionalNotes || 'Not provided'],
      ['Submitted by', requesterName],
      ['Requester email', requesterEmail || 'Not available'],
    ];
    const htmlRows = emailFields.map(([label, value]) =>
      `<tr><th style="padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;color:#12304f;width:230px">${escapeHtml(label)}</th><td style="padding:10px;white-space:pre-wrap;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(value)}</td></tr>`
    ).join('');
    const textBody = emailFields.map(([label, value]) => `${label}:\n${value}`).join('\n\n');
    const subjectTitle = requisition.jobTitle.replace(/[\r\n]+/g, ' ').slice(0, 160);

    try {
      const postmarkClient = new postmark.ServerClient(postmarkToken.value());
      const email = {
        From: 'admin-messages@ibrecruitment.com',
        To: 'support@ibrecruitment.com',
        Subject: `Job requisition request: ${subjectTitle}`,
        HtmlBody: `<html><body style="font-family:Arial,sans-serif;color:#0f172a"><h1 style="color:#0b2a6f">New job requisition</h1><p>A requisition has been submitted through the Impact in Business Recruitment portal.</p><table style="width:100%;border-collapse:collapse">${htmlRows}</table></body></html>`,
        TextBody: `New job requisition\n\n${textBody}`,
        MessageStream: 'outbound',
      };
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) email.ReplyTo = requesterEmail;
      await postmarkClient.sendEmail(email);
      return { ok: true, message: 'Requisition notification sent.' };
    } catch (err) {
      console.error('Unable to send job requisition notification through Postmark:', err);
      throw new functions.https.HttpsError('internal', 'Unable to send your requisition notification. Please try again later.');
    }
  });
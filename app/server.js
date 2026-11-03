require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const app = express();

// Optional Firebase Admin SDK (used to verify ID tokens when running with server sessions)
let admin = null;
try {
    admin = require('firebase-admin');
} catch (e) {
    console.warn('firebase-admin not available; /sessionLogin will be disabled unless firebase-admin is installed');
}

// --- 1. Security Headers & Middleware ---
app.use(helmet()); // Sets secure HTTP headers
app.use(express.urlencoded({ extended: false })); // Replaces PHP $_POST
app.use(express.json()); // parse JSON bodies (for sessionLogin)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Ensures the 'views' folder is found

// --- Serve static site from repository root ---
// This makes /resource-centre.html, CSS and JS files available from the same origin
app.use(express.static(path.join(__dirname, '..')));

// Redirect root to the resource centre page for convenience
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Remote DB/session store removed. Local in-memory session store will be used.

// --- 3. Session Configuration ---
// Use a simple in-memory session store for local development.
app.use(session({
    name: 'ibr_resource_session',
    secret: process.env.SESSION_SECRET || '59c81a27a88a41f51677925579b821be37323c37ec21c73bf865c3f053a1698df3ac7d6e739149652c476897156dce7e',
    resave: false,
    saveUninitialized: false,
    cookie: {
        domain: process.env.COOKIE_DOMAIN || undefined,
        path: '/',
        // Set secure cookies only in production when running over HTTPS
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,  // Prevents XSS cookie theft
        sameSite: 'strict', // Prevents CSRF
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
}));

// --- Firebase Admin (for verifying ID tokens from client) ---
try {
    if (!admin) throw new Error('firebase-admin SDK not loaded');
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        // Load service account JSON from file path specified in env
        const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
        // Use default credentials (e.g., GOOGLE_APPLICATION_CREDENTIALS) or metadata on GCP
        admin.initializeApp();
    }
    console.log('Firebase Admin initialized');
} catch (err) {
    // Keep running without Firebase Admin; /sessionLogin endpoint will return 501 when called
    console.warn('Firebase Admin initialization skipped or failed: ', err && err.message);
}

// Endpoint: accept Firebase ID token from client, verify and create server session
app.post('/sessionLogin', async (req, res) => {
    const idToken = req.body && req.body.idToken;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });
    if (!admin || !admin.auth) {
        return res.status(501).json({ error: 'Server not configured to verify tokens (firebase-admin missing)' });
    }
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        // Create a minimal session
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regenerate error', err);
                return res.status(500).json({ error: 'Session error' });
            }
            req.session.user_id = decoded.uid;
            req.session.username = decoded.name || decoded.email || decoded.uid;
            req.session.logged_in_at = Math.floor(Date.now() / 1000);
            return res.json({ status: 'ok' });
        });
    } catch (err) {
        console.error('Invalid ID token', err && err.message);
        return res.status(401).json({ error: 'Invalid ID token' });
    }
});

// Endpoint: server-side logout (destroys session)
app.post('/sessionLogout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('ibr_resource_session');
        res.json({ status: 'ok' });
    });
});

// --- Passport Configuration (Google OAuth) ---
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    // Serialize minimal info into session
    done(null, { id: user.id, displayName: user.displayName, emails: user.emails });
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// Configure Google Strategy
// Initialize Google OAuth strategy only when credentials are provided.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Default to localhost callback for development; override with GOOGLE_CALLBACK_URL in production
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            // Here you could find or create a corresponding local user record.
            // For now we just pass the profile through.
            return done(null, profile);
        } catch (err) {
            return done(err);
        }
    }));
} else {
    console.warn('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable OAuth login.');
}

// --- 4. Auth Middleware ---
const authCheck = (req, res, next) => {
    const timeoutSeconds = 1800; // 30 minutes
    const now = Math.floor(Date.now() / 1000);

    if (req.session.logged_in_at && (now - req.session.logged_in_at > timeoutSeconds)) {
        return req.session.destroy(() => {
            res.clearCookie('ibr_resource_session');
            res.redirect('/login');
        });
    }

    // Allow authenticated via Passport (Google) or existing local session
    if (req.isAuthenticated && req.isAuthenticated()) {
        req.session.logged_in_at = now;
        return next();
    }

    if (!req.session.user_id || !req.session.username) {
        return res.redirect('/login');
    }

    req.session.logged_in_at = now;
    next();
};

// --- 5. Routes ---

// Login Page (GET)
// Serve client-only login page (static) for Firebase-based sign-in
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'login.html'));
});

// OAuth callback (kept for server-side OAuth flows). Redirect to client index page.
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    // Successful authentication (server-side). Redirect to client-protected page.
    req.session.user_id = req.user && (req.user.id || req.user.sub) || null;
    req.session.username = req.user && (req.user.displayName || (req.user.emails && req.user.emails[0] && req.user.emails[0].value)) || 'google-user';
    req.session.logged_in_at = Math.floor(Date.now() / 1000);
    res.redirect('/index.html');
});

// Logout
app.get('/logout', (req, res) => {
    req.logout(function(err) {
        // ignore errors from logout, destroy session anyway
        req.session.destroy(() => {
            res.clearCookie('ibr_resource_session');
            res.redirect('/login');
        });
    });
});

// Login Logic (POST)
// Local DB-backed login removed. Keep the route to provide a clear message.
app.post('/login', (req, res) => {
    res.status(501).render('login', { error: 'Local login disabled. Use Google Sign-In or server-provided authentication.' });
});

// Serve client-side index for client-only auth flows
app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


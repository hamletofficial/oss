/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at
 * https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";

import * as express from "express";
import * as admin from "firebase-admin";
import * as cookieParser from "cookie-parser";
import {existsSync, readFileSync} from "fs";
import {join} from "path";

setGlobalOptions({maxInstances: 10});
try {
  admin.initializeApp();
} catch {
  // Already initialized.
}

const app = express();
app.use(express.json());
app.use(cookieParser());

const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRES = 14 * 24 * 60 * 60 * 1000;

/**
 * Serves a file from the public directory with a mapped content type.
 * @param {express.Response} res Express response.
 * @param {string} filepath Relative public path.
 * @return {express.Response} Response result.
 */
function serveStatic(res: express.Response, filepath: string) {
  const root = join(__dirname, "..", "public");
  const full = join(root, filepath);

  if (!existsSync(full)) {
    return res.status(404).send("Not found");
  }

  const data = readFileSync(full);

  if (filepath.endsWith(".html")) {
    res.set("Content-Type", "text/html");
  } else if (filepath.endsWith(".js")) {
    res.set("Content-Type", "application/javascript");
  } else if (filepath.endsWith(".css")) {
    res.set("Content-Type", "text/css");
  } else if (filepath.endsWith(".png")) {
    res.set("Content-Type", "image/png");
  } else if (
    filepath.endsWith(".jpg") ||
    filepath.endsWith(".jpeg")
  ) {
    res.set("Content-Type", "image/jpeg");
  }

  return res.status(200).send(data);
}

app.post("/sessionLogin", async (req, res) => {
  const idToken = req.body && req.body.idToken;

  if (!idToken) {
    return res.status(400).json({error: "Missing idToken"});
  }

  try {
    const sessionCookie = await admin.auth().createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRES,
    });
    const cookieDomain =
      process.env.COOKIE_DOMAIN || ".ibrecruitment.com";
    const options: express.CookieOptions = {
      maxAge: SESSION_EXPIRES,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      domain: cookieDomain,
    };

    res.cookie(SESSION_COOKIE_NAME, sessionCookie, options);
    return res.json({status: "success"});
  } catch (err) {
    logger.error("sessionLogin failed", err);
    return res.status(401).json({error: "UNAUTHORIZED"});
  }
});

app.post("/sessionLogout", (req, res) => {
  const cookieDomain =
    process.env.COOKIE_DOMAIN || ".ibrecruitment.com";

  res.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    domain: cookieDomain,
  });

  return res.json({status: "logged_out"});
});

app.get("*", async (req, res) => {
  try {
    const sessionCookie =
      req.cookies && req.cookies[SESSION_COOKIE_NAME];
    const publicPaths = [
      "/login.html",
      "/firebase-config.js",
      "/firebase-config.json",
    ];

    if (!sessionCookie) {
      if (publicPaths.includes(req.path)) {
        const safePath = req.path.replace(/^\//, "") || "login.html";
        return serveStatic(res, safePath);
      }
      return res.redirect("/login.html");
    }

    const decoded = await admin
      .auth()
      .verifySessionCookie(sessionCookie, true)
      .catch(() => null);

    if (!decoded) {
      return res.redirect("/login.html");
    }

    let pathValue = req.path;
    if (pathValue === "/" || pathValue === "") {
      pathValue = "/index.html";
    }
    if (pathValue.startsWith("/")) {
      pathValue = pathValue.substring(1);
    }

    return serveStatic(res, pathValue || "index.html");
  } catch (err) {
    logger.error("auth proxy error", err);
    return res.redirect("/login.html");
  }
});

export const authProxy = onRequest(app);

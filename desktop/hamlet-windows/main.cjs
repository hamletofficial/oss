const { app, BrowserWindow, ipcMain, Notification, shell } = require("electron");
const path = require("node:path");
const { isTrustedAppUrl, isTrustedAuthUrl } = require("./security.cjs");

const APP_URL = "https://www.hamlet-ai.co.uk/";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "hamlet",
    autoHideMenuBar: true,
    backgroundColor: "#0b1120",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAuthUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
          }
        }
      };
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") shell.openExternal(parsed.toString());
    } catch {
      // Ignore malformed or non-HTTPS external links.
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedAppUrl(url) || isTrustedAuthUrl(url)) return;
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") shell.openExternal(parsed.toString());
    } catch {
      // Ignore malformed URLs.
    }
  });

  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.loadURL(APP_URL);
  return win;
}

ipcMain.handle("hamlet:version", () => app.getVersion());

ipcMain.handle("hamlet:notify", (event, payload) => {
  if (!isTrustedAppUrl(event.senderFrame?.url || "")) return false;
  if (!payload || typeof payload !== "object") return false;
  const title = typeof payload.title === "string" ? payload.title.slice(0, 100) : "hamlet";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 300) : "";
  if (!Notification.isSupported()) return false;
  new Notification({ title, body, silent: false }).show();
  return true;
});

app.setAppUserModelId("co.uk.hamletai.desktop");

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

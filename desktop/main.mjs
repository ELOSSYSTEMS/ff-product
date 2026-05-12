import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, shell } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
let serverPort = Number(process.env.PORT || 3008);
let serverUrl = `http://127.0.0.1:${serverPort}`;

let mainWindow = null;
let serverListener = null;

function resolveEnvPath() {
  if (process.env.FF_PRODUCT_ENV_PATH) {
    return process.env.FF_PRODUCT_ENV_PATH;
  }

  if (app.isPackaged) {
    return path.join(process.resourcesPath, ".env");
  }

  return path.join(appRoot, ".env");
}

function resolveGeneratedRoot() {
  if (process.env.FF_PRODUCT_GENERATED_ROOT) {
    return process.env.FF_PRODUCT_GENERATED_ROOT;
  }

  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "generated");
  }

  return path.join(appRoot, "generated");
}

async function waitForServerReady({ retries = 40, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/api/config`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep retrying until the local server is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for ${serverUrl} to respond.`);
}

async function ensureServer() {
  if (serverListener) {
    return;
  }

  process.env.FF_PRODUCT_ENV_PATH = resolveEnvPath();
  process.env.FF_PRODUCT_GENERATED_ROOT = resolveGeneratedRoot();
  const serverModuleUrl = pathToFileURL(
    path.join(appRoot, "src", "server.mjs")
  ).href;
  const { startServer } = await import(serverModuleUrl);

  for (let offset = 0; offset < 20; offset += 1) {
    const candidatePort = Number(process.env.PORT || 3008) + offset;
    try {
      serverListener = await startServer({ port: candidatePort });
      serverPort = candidatePort;
      serverUrl = `http://127.0.0.1:${serverPort}`;
      await waitForServerReady();
      return;
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!message.includes("EADDRINUSE")) {
        throw error;
      }
    }
  }

  throw new Error("Could not start the local FF Product server on an available port.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 820,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5efe8",
    title: "FF Product"
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(serverUrl);
}

async function shutdownServer() {
  if (!serverListener) {
    return;
  }

  await new Promise((resolve) => {
    serverListener.close(() => resolve());
  });
  serverListener = null;
}

async function bootDesktopApp() {
  try {
    await ensureServer();
    createWindow();
  } catch (error) {
    await dialog.showErrorBox(
      "FF Product failed to start",
      String(error?.message ?? error)
    );
    await shutdownServer();
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(bootDesktopApp);
}

app.on("window-all-closed", async () => {
  await shutdownServer();
  app.quit();
});

app.on("before-quit", () => {
  if (mainWindow) {
    mainWindow.removeAllListeners("closed");
  }
});

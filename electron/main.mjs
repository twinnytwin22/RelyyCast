import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const startUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";

let mainWindow = null;
let tray = null;
let isQuitting = false;

function getWindowState(win) {
  return {
    isMaximized: win.isMaximized(),
    isMinimized: win.isMinimized(),
    isFullScreen: win.isFullScreen(),
  };
}

function emitWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send("window:state-changed", getWindowState(win));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const isMac = process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1024,
    height: 425,
    minWidth: 1024,
    minHeight: 425,
    maxWidth: 1024,
    maxHeight: 425,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    simpleFullscreen: false,
    backgroundColor: "#0f172a",
    title: "RelyyCast",
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 9 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    emitWindowState(win);
  });

  win.on("maximize", () => emitWindowState(win));
  win.on("unmaximize", () => emitWindowState(win));
  win.on("minimize", () => emitWindowState(win));
  win.on("restore", () => emitWindowState(win));
  win.on("enter-full-screen", () => emitWindowState(win));
  win.on("leave-full-screen", () => emitWindowState(win));

  win.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.loadURL(startUrl);
  return win;
}

function createTray() {
  if (process.platform !== "darwin" || tray) {
    return;
  }

  const trayIconPath = path.join(__dirname, "..", "public", "window.svg");
  const trayImage = nativeImage.createFromPath(trayIconPath);
  trayImage.setTemplateImage(true);

  tray = new Tray(trayImage);
  tray.setToolTip("RelyyCast");
  tray.on("click", () => {
    showMainWindow();
  });

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show RelyyCast",
        click: () => showMainWindow(),
      },
      {
        type: "separator",
      },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

app.setName("RelyyCast");

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  mainWindow = createWindow();
  createTray();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.minimize();
  }
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.isMaximizable()) {
    return;
  }

  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
  }
});

ipcMain.handle("window:get-state", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return {
      isMaximized: false,
      isMinimized: false,
      isFullScreen: false,
    };
  }

  return getWindowState(win);
});

import { app, BrowserWindow } from 'electron';

app.setPath('userData', process.env.BOTDESK_TEST_DATA);
app.on('window-all-closed', () => app.quit());
// A hidden, isolated test window. Never attaches to a user's browser or desktop.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 390, height: 844, useContentSize: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadURL(process.env.BOTDESK_PHONE_TEST_URL);
}).catch((error) => { console.error(error); app.exit(1); });

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { _electron } from 'playwright-core';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botdesk-onboarding-proof-'));
const env = { ...process.env, BOTDESK_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['scripts/onboarding-fixture.mjs'], env, timeout: 30_000 });
const evidence = path.resolve('evidence'); await fs.mkdir(evidence, { recursive: true });
const checks = [], pageErrors = [], remoteRequests = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()); });
  await page.setViewportSize({ width: 980, height: 830 });
  await page.waitForSelector('html[data-botdesk-ui-loaded="true"]');
  const fixtureState = () => app.evaluate(() => globalThis.botdeskOnboardingFixture.state());
  const selectTab = async (step) => {
    await page.locator('#setupTabs [data-step="' + step + '"]').click();
    await page.waitForFunction((name) => document.querySelector('[data-panel="' + name + '"]').hidden === false, step);
  };
  const assertSelected = async (step) => {
    assert.equal(await page.locator('#setupTabs [aria-selected="true"]').getAttribute('data-step'), step);
    assert.equal(await page.locator('[data-panel="' + step + '"]').isVisible(), true);
  };
  const assertProgress = async (count) => {
    await page.waitForFunction((value) => document.querySelector('#readinessCount').textContent === value + ' / 3', count);
  };
  const assertLayout = async (width, height) => {
    await page.setViewportSize({ width, height });
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(dimensions.width, width);
    assert.ok(dimensions.scroll <= width, `Horizontal overflow at ${width}px: ${dimensions.scroll}`);
  };
  const screenshot = async (name) => {
    assert.equal(await page.locator('#advancedSettings').getAttribute('open'), null);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(evidence, name), fullPage: true });
  };

  await assertProgress(0); await assertSelected('pair');
  await assertLayout(980, 830);
  await screenshot('free-onboarding-pair.png');
  checks.push('initial-pair-step-and-zero-prepared', '980px-no-horizontal-overflow');

  assert.equal(await page.locator('#pairingJson').getAttribute('type'), 'password', 'Pairing JSON must remain visually masked while pasted');
  await page.locator('#pairingJson').fill('{invalid private data');
  await page.locator('#importPairing').click();
  await page.waitForFunction(() => document.querySelector('#pairFeedback').textContent.includes('Nothing has been saved'));
  await assertProgress(0);
  assert.equal((await fixtureState()).counts.saved, 0);
  checks.push('pairing-input-is-visually-masked', 'invalid-pairing-keeps-readiness-unchanged');

  await page.locator('#pairTab').focus();
  await page.keyboard.press('ArrowRight'); await assertSelected('window');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'windowTab');
  await page.keyboard.press('End'); await assertSelected('phone');
  await page.keyboard.press('Home'); await assertSelected('pair');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pairingJson');
  checks.push('arrow-home-end-navigation-and-panel-tab-order');

  const pairing = { config: { relayUrl: 'https://synthetic-relay.example.test', hostId: 'synthetic-demo-pc', hostToken: 'synthetic_host_'.padEnd(43, 'h'), ownerToken: 'synthetic_owner_'.padEnd(43, 'o'), botToken: 'synthetic_bot_'.padEnd(43, 'b') } };
  await page.locator('#pairingJson').fill(JSON.stringify(pairing));
  await page.locator('#importPairing').click();
  assert.equal(await page.locator('#pairingJson').inputValue(), '');
  await assertProgress(0);
  await page.locator('#saveButton').click();
  await assertProgress(1); await assertSelected('pair');
  assert.equal(await page.locator('#hostToken').inputValue(), 'saved');
  assert.equal(await page.locator('#ownerToken').inputValue(), 'saved');
  assert.equal(await page.locator('#botToken').inputValue(), 'saved');
  assert.equal(await page.locator('#pairStepState').textContent(), 'PC connected');
  checks.push('pairing-paste-cleared', 'saved-authenticated-pair-only-completes-one-step', 'tokens-replaced-with-saved-markers');

  await page.locator('#continueWindow').click(); await assertSelected('window');
  await page.locator('#refreshWindows').click();
  await page.waitForFunction(() => document.querySelector('#targetWindow').options.length === 2);
  await page.locator('#targetWindow').selectOption('1001');
  await assertProgress(2);
  assert.equal((await fixtureState()).counts.selected, 1);
  await screenshot('free-onboarding-window.png');
  checks.push('verified-fixture-window-selection-completes-second-step');

  await page.locator('#continuePhone').click(); await assertSelected('phone');
  await page.locator('#remoteArm').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#remoteArm').isChecked(), true);
  await assertProgress(2);
  assert.equal((await fixtureState()).config.allowRemoteArm, false);
  assert.match(await page.locator('#phoneFeedback').textContent(), /not saved/);
  await page.locator('#savePhoneButton').click();
  await assertProgress(3);
  assert.equal((await fixtureState()).config.allowRemoteArm, true);
  await assertSelected('phone');
  await page.locator('#copyOwnerLink').click();
  await page.waitForFunction(() => document.querySelector('#copyPhoneFeedback').textContent.includes('copied'));
  assert.equal((await fixtureState()).counts.copied, 1);
  assert.equal((await page.locator('#copyPhoneFeedback').textContent()).toLowerCase().includes('connected'), false);
  assert.equal(await page.locator('#copyOwnerLink span[aria-hidden="true"]').count(), 1, 'Pending operation preserves button icon markup');
  await screenshot('free-onboarding-phone.png');
  checks.push('unsaved-checkbox-does-not-complete-phone-step', 'save-phone-preferences-completes-third-step', 'copy-feedback-claims-only-copy', 'button-markup-restored-after-pending');

  await app.evaluate(() => globalThis.botdeskOnboardingFixture.emitStatus({ recording: true }));
  await page.waitForFunction(() => document.querySelector('#recordingState').textContent === 'Recording selected window');
  await assertSelected('phone');
  await app.evaluate(() => globalThis.botdeskOnboardingFixture.emitStatus({ recording: false }));
  checks.push('status-update-does-not-jump-tabs');

  await page.locator('#armButton').click();
  await page.waitForFunction(() => document.querySelector('#modeBadge').textContent === 'ARMED');
  const firstClock = await page.locator('#sessionClock').textContent();
  assert.match(firstClock, /^0[78]:[0-5]\d:[0-5]\d$/);
  await page.waitForFunction((value) => document.querySelector('#sessionClock').textContent !== value, firstClock, { timeout: 4000 });
  assert.equal(await page.locator('#sessionClock').getAttribute('aria-live'), 'off');
  await page.locator('#pauseButton').click();
  await page.waitForFunction(() => document.querySelector('#modeBadge').textContent === 'PAUSED');
  assert.equal(await page.locator('#sessionClock').textContent(), '—');
  await page.locator('#stopButton').click();
  await page.waitForFunction(() => document.querySelector('#modeBadge').textContent === 'OFF' && !document.querySelector('#unlockButton').hidden);
  await page.locator('#unlockButton').click();
  await page.waitForFunction(() => document.querySelector('#unlockButton').hidden);
  checks.push('arm-countdown-ticks-without-live-announcements', 'pause-and-stop-update-mode', 'local-stop-unlock');

  await selectTab('phone');
  await page.locator('#remoteArm').uncheck();
  await app.evaluate(() => globalThis.botdeskOnboardingFixture.holdSave());
  await page.locator('#savePhoneButton').click();
  await page.waitForFunction(() => document.querySelector('#savePhoneButton').disabled);
  assert.equal((await fixtureState()).pendingSave, true);
  assert.equal(await page.locator('#stopButton').isDisabled(), false);
  await assertLayout(760, 650);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const quickStop = await page.locator('#quickStopButton').boundingBox();
  assert.ok(quickStop && quickStop.x >= 0 && quickStop.y >= 0 && quickStop.x + quickStop.width <= 760 && quickStop.y + quickStop.height <= 650);
  const stopsBefore = (await fixtureState()).counts.stopped;
  await page.locator('#quickStopButton').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#modeBadge').textContent === 'OFF' && !document.querySelector('#unlockButton').hidden);
  assert.equal((await fixtureState()).counts.stopped, stopsBefore + 1);
  assert.equal((await fixtureState()).pendingSave, true);
  await app.evaluate(() => globalThis.botdeskOnboardingFixture.releaseSave());
  await page.waitForFunction(() => !document.querySelector('#savePhoneButton').disabled);
  await assertSelected('phone');
  checks.push('760px-no-horizontal-overflow', 'floating-stop-visible-when-short-and-scrolled', 'keyboard-stop-delivered-during-pending-save');

  // 490x380 CSS-pixel viewport matches the layout space of a 980x760 window at
  // 200% zoom. This is explicit reflow emulation, not a native OS zoom claim.
  await assertLayout(490, 380);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const compactStop = await page.locator('#quickStopButton').boundingBox();
  assert.ok(compactStop && compactStop.y >= 0 && compactStop.y + compactStop.height <= 380 && compactStop.x + compactStop.width <= 490);
  checks.push('490x380-reflow-equivalent-to-200-percent-layout', 'floating-stop-reachable-at-compact-reflow');
  const isolated = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => { const p = window.webContents.getLastWebPreferences(); return !window.isVisible() && p.sandbox && p.contextIsolation && !p.nodeIntegration; }));
  assert.equal(isolated, true); assert.deepEqual(pageErrors, []); assert.deepEqual(remoteRequests, []);
  const result = { ok: true, checks, screenshots: ['free-onboarding-pair.png', 'free-onboarding-window.png', 'free-onboarding-phone.png'], source: 'Hidden Electron with real host UI/preload and synthetic in-memory IPC. No native controls, real credentials, clipboard writes, network service, or desktop capture.', zoomCheck: '490x380 CSS reflow emulation; not native OS zoom validation' };
  await fs.writeFile(path.join(evidence, 'free-onboarding-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.evaluate(() => globalThis.botdeskOnboardingFixture.releaseSave()).catch(() => {});
  await app.close();
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true });
}

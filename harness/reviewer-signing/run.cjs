const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sdk = path.resolve(__dirname, '../..');
const tooling = process.env.SIGNING_TOOLING_ROOT || path.resolve(sdk, '../../feathery-frontend');
const browserTooling = process.env.SIGNING_PLAYWRIGHT_ROOT || path.resolve(sdk, '../../hosted-forms-next');
const { chromium } = require(path.join(browserTooling, 'node_modules/playwright'));
const { expect } = require(path.join(browserTooling, 'node_modules/@playwright/test'));
const esbuild = require(path.join(tooling, 'node_modules/esbuild'));
const output = process.env.SIGNING_OUTPUT || fs.mkdtempSync('/tmp/reviewer-signing-');
fs.mkdirSync(output, { recursive: true });

function browserPath() {
  if (process.env.SIGNING_BROWSER) return process.env.SIGNING_BROWSER;
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  for (const revision of ['1200', '1234']) {
    const candidate = path.join(cache, `chromium_headless_shell-${revision}`,
      'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Set SIGNING_BROWSER to an installed Chromium executable. No downloads are performed.');
}

async function bundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'fixture.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    jsx: 'automatic', jsxImportSource: '@emotion/react',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: {
      react: path.join(sdk, 'node_modules/react'),
      'react-dom': path.join(sdk, 'node_modules/react-dom')
    },
    plugins: [{ name: 'offline-viewer', setup(build) {
      build.onResolve({ filter: /utils\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
      build.onResolve({ filter: /^\.\/pdfjsLoader$/ }, () => ({ path: 'pdfjs', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
        contents: name === 'browser'
          ? 'export const runningInClient=()=>true;export const featheryDoc=()=>document;export const featheryWindow=()=>window;'
          : 'export const PDFJS_STANDARD_FONT_DATA_URL="";export const loadPdfjs=()=>new Promise(()=>{});',
        loader: 'js'
      }));
    }}]
  });
  return result.outputFiles[0].text;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
const calls = (page) => page.evaluate(() => window.harness.calls);

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled', timeout: 15000 });
}

async function assertFits(page, name) {
  const box = await dialog(page, name).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1
    && box.y + box.height <= viewport.height + 1, 'Dialog fits viewport');
  assert.ok(await dialog(page, name).evaluate(el => el.scrollWidth <= el.clientWidth + 1),
    'Dialog has no horizontal overflow');
}

async function signing(page, prefix) {
  await button(page, 'Sign').click();
  await expect(dialog(page, 'Configure signers')).toBeVisible();
  assert.equal((await calls(page)).length, 0);
  await assertFits(page, 'Configure signers');
  if (prefix.includes('scrolled')) assert.equal(await page.evaluate(() => window.scrollY), 700);
  await screenshot(page, `${prefix}-signers`);
  for (const invalid of ['0', '1.5', '']) {
    await page.getByLabel('Signing order 1', { exact: true }).fill(invalid);
    await button(page, 'Next').click();
    await expect(page.getByRole('alert')).toContainText('positive integer');
  }
  await page.getByLabel('Signing order 1', { exact: true }).fill('2');
  await page.getByLabel('Name 1', { exact: true }).fill('');
  await button(page, 'Next').click();
  await expect(page.getByRole('alert')).toContainText('Enter a name');
  await page.getByLabel('Name 1', { exact: true }).fill(' Alex Edited ');
  await page.getByLabel('Email 1', { exact: true }).fill('invalid');
  await button(page, 'Next').click();
  await expect(page.getByRole('alert')).toContainText('valid email');
  await page.getByLabel('Email 1', { exact: true }).fill('edited@example.com');
  await button(page, 'Next').click();
  await expect(dialog(page, 'Customize email')).toBeVisible();
  await page.getByLabel('Subject', { exact: true }).fill('Custom subject');
  await page.getByRole('textbox', { name: /^Message/ }).fill('Custom message');
  await button(page, 'Back').click();
  await expect(page.getByLabel('Name 1', { exact: true })).toHaveValue(' Alex Edited ');
  await expect(page.getByLabel('Signing order 1', { exact: true })).toHaveValue('2');
  await button(page, 'Next').click();
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Custom subject');
  await expect(page.getByRole('textbox', { name: /^Message/ })).toHaveValue('Custom message');
  await assertFits(page, 'Customize email');
  if (prefix.includes('scrolled')) assert.equal(await page.evaluate(() => window.scrollY), 700);
  await screenshot(page, `${prefix}-email`);
  assert.equal((await calls(page)).length, 0);
  await button(page, 'Send').click();
  await expect(button(page, 'Send')).toBeDisabled();
  await expect(button(page, 'Back')).toBeDisabled();
  await expect(button(page, 'Close signing options')).toBeDisabled();
  await expect(page.getByLabel('Subject', { exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const busyFocus = await page.evaluate(() => ({
    inDialog: document.activeElement?.getAttribute('role') === 'dialog',
    element: document.activeElement?.outerHTML.slice(0, 400)
  }));
  await screenshot(page, `${prefix}-busy`);
  await expect(dialog(page, 'Customize email')).toBeVisible();
  await page.keyboard.press('Enter');
  const expected = {
    envelopes: [
      { envelopeId: 'env-1', recipients: [{ recipient_index: 0, name: 'Alex Edited', email: 'edited@example.com', routing_order: 2 }] },
      { envelopeId: 'env-2', recipients: [{ recipient_index: 0, name: 'Sam', email: 'sam@example.com', routing_order: 1 }] }
    ], envelopeAction: 'sign', draft: false, emailSubject: 'Custom subject', emailBlurb: 'Custom message'
  };
  // JSON serialization removes optional undefined signerId, matching wire semantics.
  assert.deepEqual(JSON.parse(JSON.stringify(await calls(page))), [expected]);
  await page.evaluate(() => window.harness.settle({ status: 'error', message: 'Mock send failed' }));
  await expect(dialog(page, 'Customize email').getByRole('alert')).toContainText('Mock send failed');
  await screenshot(page, `${prefix}-error`);
  await button(page, 'Send').click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await page.evaluate(() => window.harness.settle({ status: 'sent' }));
  await expect(page.getByText('Viewer closed', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.harness.completed), 1);
  assert.ok(busyFocus.inDialog, `Busy Tab should retain modal focus; active element: ${busyFocus.element}`);
}

async function dismissAndDraft(page, prefix) {
  await button(page, 'Sign').click();
  await expect(page.getByRole('heading', { name: 'Configure signers' })).toBeFocused();
  await button(page, 'Next').focus();
  await page.keyboard.press('Tab');
  await expect(button(page, 'Close signing options')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(button(page, 'Next')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Configure signers')).toHaveCount(0);
  await expect(button(page, 'Sign')).toBeFocused();
  assert.equal(await page.evaluate(() => window.harness.closed), 0);
  assert.equal((await calls(page)).length, 0);
  await button(page, 'Sign').click();
  await button(page, 'Close signing options').click();
  await expect(dialog(page, 'Configure signers')).toHaveCount(0);
  await expect(button(page, 'Sign')).toBeFocused();
  await button(page, 'Create Draft').click();
  await button(page, 'Next').click();
  await screenshot(page, `${prefix}-draft`);
  await dialog(page, 'Customize email').getByRole('button', { name: 'Create Draft', exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  assert.equal((await calls(page))[0].draft, true);
  assert.equal((await calls(page))[0].envelopeAction, 'sign');
  await page.evaluate(() => window.harness.settle({ status: 'sent' }));
  await expect(page.getByText('Viewer closed', { exact: true })).toBeVisible();
}

async function blankEmail(page, prefix) {
  await button(page, 'Sign').click();
  await button(page, 'Next').click();
  await page.getByLabel('Subject', { exact: true }).fill('');
  await page.getByRole('textbox', { name: /^Message/ }).fill('');
  await button(page, 'Send').click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const params = (await calls(page))[0];
  if (prefix.includes('noPreset')) {
    assert.equal(Object.hasOwn(params, 'emailSubject'), false);
    assert.equal(Object.hasOwn(params, 'emailBlurb'), false);
  } else {
    assert.equal(params.emailSubject, '');
    assert.equal(params.emailBlurb, '');
  }
  await page.evaluate(() => window.harness.settle({ status: 'sent' }));
  await expect(page.getByText('Viewer closed', { exact: true })).toBeVisible();
}

async function main() {
  const script = await bundle();
  const executablePath = browserPath();
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  console.log(JSON.stringify({ executablePath, browserVersion: browser.version(),
    playwrightVersion: require(path.join(browserTooling, 'node_modules/playwright/package.json')).version,
    output }));
  try {
    for (const [device, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
      for (const [name, scenario] of Object.entries({ signing, dismissAndDraft, scrolled: signing, noPreset: blankEmail, clearedPreset: blankEmail })) {
        const context = await browser.newContext({ viewport, isMobile: device === 'mobile', hasTouch: device === 'mobile', serviceWorkers: 'block', offline: true });
        const requests = [];
        await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const id = `${device}-${name}`;
        try {
          await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><div style="height:3000px">Host form background</div></body></html>');
          if (name === 'scrolled') {
            await page.evaluate(() => window.scrollTo(0, 700));
            assert.equal(await page.evaluate(() => window.scrollY), 700);
          }
          await page.evaluate(noPreset => { window.fixtureOptions = { noPreset }; }, name === 'noPreset');
          await page.addScriptTag({ content: script });
          await scenario(page, `${device}-${name}`);
          assert.deepEqual(errors, [], 'No uncaught browser errors');
          assert.deepEqual(requests, [], 'Fixture should not attempt network access');
          results.push({ id, status: 'passed', requests, errors });
        } catch (error) {
          console.error(`${id}: ${error.stack}`);
          results.push({ id, status: 'failed', error: error.stack, requests, errors });
          await screenshot(page, `${id}-failure`).catch(e => console.error(`Screenshot failed: ${e.message}`));
        } finally { await context.close(); }
        console.log(`${id}: ${results.at(-1).status}`);
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Results and screenshots: ${output}`);
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });

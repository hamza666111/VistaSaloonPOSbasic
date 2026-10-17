import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    external.push(url.origin);
    return route.abort();
  }
  return route.continue();
});
page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
await mkdir('.qa', { recursive: true });
const persisted = () => page.evaluate(() => JSON.parse(localStorage.getItem('vistasaloon-demo-storage-v1') || localStorage.getItem('vistasaloon-basic-storage')).state);
try {
  console.log('Checking sign-in and checkout...');
  await page.goto(base);
  await page.getByLabel('Email address').fill('admin@vistasaloon.local');
  await page.getByLabel('Password', { exact: true }).fill('VistaLocal123!');
  await page.screenshot({ path: '.qa/login-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.getByRole('heading', { name: 'Good service starts here.' }).waitFor();
  assert.equal(await page.locator('.workspace-header').count(), 0);
  assert.equal(await page.locator('.demo-banner').count(), 0);
  const initial = await persisted();
  assert.equal(initial.isAuthenticated, true);
  const teamMember = initial.barbers.find(member => member.active).name;
  assert.equal(await page.locator('.workspace-label').count(), 0);
  await page.screenshot({ path: '.qa/pos-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: teamMember, exact: true }).click();
  await page.getByRole('button', { name: /Hair Cut - Regular Rs/ }).click();
  const pickerHeight = await page.locator('.customer-picker').evaluate(element => element.getBoundingClientRect().height);
  if (initial.customers.length) {
    const existing = initial.customers.find(customer => customer.active !== false);
    await page.getByRole('combobox', { name: 'Select customer', exact: true }).selectOption(existing.id);
    assert.equal((await page.locator('.customer-summary').textContent()).includes(existing.name), true);
    assert.equal(await page.getByPlaceholder('New customer name').count(), 0);
    await page.getByRole('button', { name: 'Change customer' }).click();
  }
  await page.getByRole('combobox', { name: 'Select customer', exact: true }).selectOption('');
  assert.match(await page.locator('.customer-summary').textContent(), /Walk-in Customer/);
  await page.getByRole('button', { name: 'Change customer' }).click();
  if (initial.customers.length) {
    const existing = initial.customers.find(customer => customer.active !== false);
    await page.getByPlaceholder('Search by name or phone', { exact: true }).fill(existing.name);
    await page.getByRole('button', { name: `${existing.name} ${existing.phone}`, exact: true }).click();
    assert.equal((await page.locator('.customer-summary').textContent()).includes(existing.name), true);
    await page.getByRole('button', { name: 'Change customer' }).click();
  }
  await page.getByPlaceholder('New customer name').fill('Local Test Client');
  await page.getByPlaceholder('Phone', { exact: true }).fill('00000999999');
  await page.getByRole('button', { name: 'Add & Select Customer' }).click();
  assert.match(await page.locator('.customer-summary').textContent(), /Local Test Client/);
  assert.equal(await page.locator('.customer-picker').count(), 0);
  const summaryHeight = await page.locator('.customer-summary').evaluate(element => element.getBoundingClientRect().height);
  assert.ok(summaryHeight < pickerHeight / 2, 'Customer summary should free bill space');
  await page.screenshot({ path: '.qa/customer-collapsed.png', fullPage: true, animations: 'disabled' });
  await page.locator('input[type="number"]').fill('50');
  await page.evaluate(() => { window.print = () => { window.__printed = true; window.__receipt = document.getElementById('printable-invoice')?.textContent; }; });
  await page.getByRole('button', { name: 'Save + Print', exact: true }).click();
  await page.waitForFunction(() => window.__printed === true);
  assert.ok((await page.evaluate(() => window.__receipt)).includes('Vista Saloon'));
  let state = await persisted();
  assert.equal(state.invoices.length, initial.invoices.length + 1);
  assert.equal(state.invoices[0].total, 350);
  assert.equal(state.invoices[0].status, 'paid');
  assert.equal(state.invoices[0].items[0].barberName, teamMember);
  assert.equal(state.customers.length, initial.customers.length + 1);
  assert.deepEqual(state.pendingMutations, []); // Local demo writes never queue for an online project.
  await page.getByPlaceholder('New customer name').waitFor();
  await page.reload();
  state = await persisted();
  assert.equal(state.invoices[0].total, 350);
  const routes = [['/dashboard','Business overview'],['/invoices','Sales & invoices'],['/customers','Your client book'],['/statistics','Salon insights'],['/settings','Make it your own']];
  console.log('Checking desktop routes...');
  for (const [path, heading] of routes) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    if (path === '/invoices') {
      const row = page.locator('.invoice-row').first();
      assert.equal(await row.getByRole('button', { name: /^(View|Print)$/ }).count(), 0);
      const invoiceId = (await row.locator('[data-label="ID"]').textContent()).trim();
      await row.locator('[data-label="Customer"]').click();
      const receipt = page.getByRole('dialog', { name: 'Invoice Receipt' });
      await receipt.waitFor();
      assert.ok((await receipt.textContent()).includes(invoiceId));
      await page.evaluate(() => { window.print = () => { window.__invoicePrinted = document.getElementById('printable-invoice')?.textContent; }; });
      await receipt.getByRole('button', { name: 'Print', exact: true }).click();
      await page.waitForFunction(() => !!window.__invoicePrinted);
      assert.ok((await page.evaluate(() => window.__invoicePrinted)).includes(invoiceId));
      await receipt.getByRole('button', { name: 'Close', exact: true }).click();
      await row.focus();
      await row.press('Enter');
      await receipt.waitFor();
      await receipt.getByRole('button', { name: 'Close', exact: true }).click();
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('heading', { name: 'Enter Edit PIN' }).waitFor();
      assert.equal(await receipt.count(), 0);
      await page.getByRole('button', { name: 'Close invoice PIN' }).click();
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      await row.getByRole('button', { name: 'No', exact: true }).click();
      assert.equal(await receipt.count(), 0);
    }
    assert.equal(await page.locator('.workspace-header, .demo-banner').count(), 0);
    await page.screenshot({ path: `.qa/${path.slice(1)}-desktop.png`, fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Desktop overflow on ${path}`);
  }
  for (const tab of ['app','categories','Deals & offers','Team','customers','account','services']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  console.log('Checking demo export and reset...');
  if (initial.invoices.length > 0) {
    assert.equal(initial.invoices.length, 84);
    assert.equal(initial.customers.length, 18);
    assert.equal(initial.services.length, 20);
    assert.ok(initial.invoices.some(invoice => invoice.status === 'pending'));
    assert.ok(initial.invoices.some(invoice => invoice.paymentMode === 'online'));
    assert.ok(initial.barbers.some(member => !member.active));
    assert.ok(initial.barbers.some(member => member.commissionRate > 0));
    await page.goto(base + '/customers');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Excel' }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /demo-customers.*xlsx$/);
    assert.equal(await page.evaluate(() => localStorage.getItem('vistasaloon-basic-storage')), null);
    page.removeAllListeners('dialog');
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/settings');
    await page.getByRole('button', { name: 'account', exact: true }).click();
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('vistasaloon-demo-storage-v1')).state.invoices.length === 84);
    await page.getByRole('heading', { name: 'Make it your own' }).waitFor();
    const resetState = await persisted();
    assert.equal(resetState.customers.length, 18);
    assert.deepEqual(resetState.pendingMutations, []);
  }
  console.log('Checking mobile layouts and logout...');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [['/','Good service starts here.'], ...routes]) {
    await page.goto(base + path);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Mobile overflow on ${path}`);
    await page.screenshot({ path: `.qa/${path.slice(1) || 'pos'}-mobile.png`, fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Client book' }).click();
  await page.getByRole('heading', { name: 'Your client book' }).waitFor();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
  await page.screenshot({ path: '.qa/login-mobile.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Login overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: login, all pages, settings tabs, local checkout with discount, print callback, persistence, responsive layouts, navigation and logout. No external requests or browser errors.');
} finally { await browser.close(); }

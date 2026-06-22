import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
const envVars: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim();
}

const ROUTES = [
  { name: 'dashboard', path: '/' },
  { name: 'chat', path: '/chat' },
];
const WIDTHS = [360, 375, 390];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Auth via Supabase login
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle');
  // Check if login required
  const needsLogin = await page.locator('input[type=email]').count() > 0;
  if (needsLogin) {
    const email = envVars.TEST_USER_EMAIL || envVars.NEXT_PUBLIC_TEST_USER_EMAIL;
    const pw = envVars.TEST_USER_PASSWORD || envVars.NEXT_PUBLIC_TEST_USER_PASSWORD;
    if (email && pw) {
      await page.fill('input[type=email]', email);
      await page.fill('input[type=password]', pw);
      await page.click('button:has-text("Sign in"), button:has-text("Login"), button[type=submit]');
      await page.waitForLoadState('networkidle');
    } else {
      console.log('NOTE: login page detected but no TEST_USER_EMAIL/PASSWORD in env — checking auth gate page itself');
    }
  }

  const results: Array<{ route: string; width: number; scrollWidth: number; clientWidth: number; overflows: boolean }> = [];

  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('http://localhost:3000' + route.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const overflows = metrics.scrollWidth > metrics.clientWidth;
      results.push({ route: route.name, width, ...metrics, overflows });
      console.log(`${route.name.padEnd(10)} ${width}px: scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}, overflows=${overflows ? 'YES' : 'no'}`);
    }
  }

  await browser.close();

  const anyOverflow = results.some(r => r.overflows);
  console.log('\n' + (anyOverflow ? 'FAIL: horizontal overflow detected' : 'PASS: no horizontal overflow at any tested width'));
  process.exit(anyOverflow ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });

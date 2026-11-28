// Opens a Shell cell on the scratch server, types a harmless marker, screenshots the page.
import { createRequire } from "node:module";
const [, , playwrightDir, url, shotPath] = process.argv;
const { chromium } = createRequire(playwrightDir + "/")("playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  await page.click('[data-testid="agent-picker-shell"]', { timeout: 15000 });
  await page.click('[data-testid="cell-dir-go"]', { timeout: 15000 });
  await page.waitForSelector(".xterm", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.locator(".xterm").first().click();
  await page.keyboard.type("echo VERIFY_MARKER_3593");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shotPath });
  console.log("driven");
} finally {
  await browser.close();
}


import { firefox } from 'playwright';
import path from 'path';

async function run() {
    const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');
    const context = await firefox.launchPersistentContext(TWITTER_PROFILE_DIR, {
        headless: true,
        viewport: { width: 1280, height: 720 }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://x.com/home', { waitUntil: 'networkidle' });
    // Beseitige Popups
    await page.evaluate(() => {
        const badElements = document.querySelectorAll('iframe[src*="google"], #google-one-tap-container, div[style*="z-index: 2147483647"]');
        badElements.forEach(el => (el as HTMLElement).style.display = 'none');
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'public/debug/twitter-home-live.png' });
    await context.close();
    console.log('Screenshot saved to public/debug/twitter-home-live.png');
}

run().catch(console.error);

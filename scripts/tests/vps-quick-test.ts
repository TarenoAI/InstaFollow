/**
 * Quick VPS Test - Testet nur 3 Profile und macht Screenshots
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

async function dismissPopups(page: Page) {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Accept All")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'div[role="dialog"] button',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(400);
            }
        } catch { }
    }

    await page.keyboard.press('Escape').catch(() => { });
    await page.waitForTimeout(200);
}

async function main() {
    console.log('\n' + '═'.repeat(50));
    console.log('🧪 VPS QUICK TEST - 3 PROFILE');
    console.log('═'.repeat(50) + '\n');

    if (!fs.existsSync(SESSION_PATH)) {
        console.log('❌ Keine Session-Datei!');
        return;
    }

    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
    console.log(`📂 Session: ${session.cookies?.length || 0} Cookies\n`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
    });
    await context.addCookies(session.cookies || []);
    const page = await context.newPage();

    // Test 1: Homepage
    console.log('1️⃣ Teste Homepage...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    const homeBodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    console.log(`   Body length: ${homeBodyLen}`);

    await page.screenshot({ path: '.incidents/vps-test-homepage.png' });
    console.log('   📸 Screenshot: vps-test-homepage.png\n');

    // Test 2-4: 3 Profile
    const testProfiles = ['morewatchez', 'fcbayern', 'leomessi'];

    for (const username of testProfiles) {
        console.log(`2️⃣ Teste @${username}...`);

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        }).catch(() => { });

        await page.waitForTimeout(3000);
        await dismissPopups(page);

        const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
        console.log(`   Body length: ${bodyLen}`);

        await page.screenshot({ path: `.incidents/vps-test-${username}.png` });
        console.log(`   📸 Screenshot: vps-test-${username}.png\n`);
    }

    await browser.close();

    // Git Push
    console.log('📤 Pushe Screenshots zu Git...');
    exec('cd ' + process.cwd() + ' && git add .incidents/vps-test-*.png && git commit -m "debug: vps quick test screenshots" && git push origin main', (err, stdout) => {
        if (err) {
            console.log('   ⚠️ Git push fehlgeschlagen:', err.message);
        } else {
            console.log('   ✅ Screenshots gepusht!');
        }
    });

    console.log('\n' + '═'.repeat(50) + '\n');
}

main().catch(console.error);

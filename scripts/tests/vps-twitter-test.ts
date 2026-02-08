/**
 * 🐦 VPS TWITTER POST TEST
 * 
 * Testet ob wir über die VPS einen Post auf X (Twitter) erstellen können.
 * NUTZT FIREFOX mit persistentem Profil - einmal einloggen, für immer aktiv!
 */

import 'dotenv/config';
import { firefox, BrowserContext, Page } from 'playwright';  // Firefox!
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

// Firefox Profil (mit kopierten System-Cookies)
const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');
const TWITTER_INCIDENTS_DIR = path.join(process.cwd(), '.twitter-incidents');
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

// Erstelle Ordner
[TWITTER_PROFILE_DIR, TWITTER_INCIDENTS_DIR, DEBUG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

// Speichert Screenshot
async function saveDebugScreenshot(page: Page, name: string): Promise<string> {
    const filename = `${name}.png`;
    const filepath = path.join(DEBUG_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`   📸 Screenshot: ${filename}`);
    return filepath;
}

async function postToTwitter(text: string): Promise<string | null> {
    console.log('\n🐦 Starte Twitter Post Test...\n');
    console.log(`📝 Text: "${text}"\n`);
    console.log(`📂 Browser-Profil: ${TWITTER_PROFILE_DIR}`);

    const context = await firefox.launchPersistentContext(TWITTER_PROFILE_DIR, {
        headless: false, // WICHTIG: false für VNC Sichtbarkeit
        viewport: { width: 1024, height: 600 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = context.pages()[0] || await context.newPage();

    try {
        // Prüfe ob eingeloggt
        console.log('🔍 Prüfe Twitter Login-Status...');
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        await saveDebugScreenshot(page, 'debug-twitter-before-post');

        // Check ob Login-Seite
        const url = page.url();
        if (url.includes('login') || url.includes('flow')) {
            console.log('\n❌ Nicht eingeloggt!');
            console.log('   ➡️ Führe aus: DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts');
            await context.close();
            return null;
        }

        console.log('✅ Twitter eingeloggt!');

        // Zum Compose-Bereich
        console.log('📝 Navigiere zu Tweet-Compose...');
        await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
        await humanDelay(2000, 3000);

        // Warte auf Tweet-Box (nimm die erste falls mehrere existieren)
        const tweetBox = page.locator('[data-testid="tweetTextarea_0"]').first();
        await tweetBox.waitFor({ timeout: 10000 });

        // Text eingeben - Twitter nutzt contenteditable, daher click + type
        console.log('✍️ Schreibe Tweet...');
        await tweetBox.click();
        await humanDelay(500, 800);
        await page.keyboard.type(text, { delay: 30 });  // Langsam tippen wie ein Mensch
        await humanDelay(1000, 2000);

        await saveDebugScreenshot(page, 'debug-twitter-before-submit');

        // Tweet absenden
        console.log('📤 Sende Tweet...');
        const postButton = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
        await postButton.click();
        await humanDelay(3000, 5000);

        await saveDebugScreenshot(page, 'debug-twitter-after-submit');

        // Prüfe ob erfolgreich
        const currentUrl = page.url();
        if (!currentUrl.includes('compose')) {
            console.log('\n✅ Tweet erfolgreich gepostet!');
            console.log(`   URL: ${currentUrl}`);

            // Git push screenshots
            exec(`cd ${process.cwd()} && git add public/debug/ && git commit -m "debug: twitter post test" && git push origin main`,
                (err) => { if (!err) console.log('📤 Screenshots gepusht'); });

            await context.close();
            return currentUrl;
        } else {
            console.log('\n⚠️ Tweet möglicherweise nicht gesendet (noch auf Compose-Seite)');
            await context.close();
            return null;
        }

    } catch (error: any) {
        console.log(`\n❌ Fehler: ${error.message}`);
        await saveDebugScreenshot(page, 'debug-twitter-error');
        await context.close();
        return null;
    }
}

// Main
async function main() {
    console.log('════════════════════════════════════════════════════════════');
    console.log('🐦 VPS TWITTER POST TEST - PERSISTENTES PROFIL');
    console.log('════════════════════════════════════════════════════════════');

    const testText = `🧪 Test-Post vom VPS - ${new Date().toLocaleString('de-DE')}

Dieser Post wurde automatisch über Playwright erstellt! 🤖

#AutomationTest #InstaFollows`;

    const result = await postToTwitter(testText);

    console.log('════════════════════════════════════════════════════════════');
    if (result) {
        console.log('✅ TEST ERFOLGREICH');
    } else {
        console.log('❌ TEST FEHLGESCHLAGEN');
        console.log('💡 Falls nicht eingeloggt, führe aus:');
        console.log('   DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts');
    }
    console.log('════════════════════════════════════════════════════════════');
}

main().catch(console.error);

/**
 * 🐦 VPS TWITTER POST TEST
 * 
 * Testet ob wir über die VPS einen Post auf X (Twitter) erstellen können
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function postToTwitter(text: string): Promise<string | null> {
    console.log('\n🐦 Starte Twitter Post Test...\n');
    console.log(`📝 Text: "${text}"\n`);

    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
        console.log('❌ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt in .env');
        return null;
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        storageState: fs.existsSync(TWITTER_SESSION_PATH) ? TWITTER_SESSION_PATH : undefined,
        viewport: { width: 1280, height: 800 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = await context.newPage();

    try {
        // Prüfe ob eingeloggt
        console.log('🔍 Prüfe Twitter Login-Status...');
        await page.goto('https://twitter.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Login wenn nötig
        const needsLogin = page.url().includes('login') || await page.$('input[autocomplete="username"]');

        // Debug Screenshot VOR Login
        console.log('📸 Erstelle Debug-Screenshot...');
        await page.screenshot({ path: 'debug-twitter-before-login.png', fullPage: true });
        console.log('   ✅ Screenshot: debug-twitter-before-login.png\n');

        if (needsLogin) {
            console.log('🔐 Nicht eingeloggt - führe Login durch...\n');

            if (!page.url().includes('login')) {
                await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);
            }

            // Warte auf Login-Seite
            await page.screenshot({ path: 'debug-twitter-login-page.png' });
            console.log('   📸 Login-Page Screenshot erstellt');

            // Suche nach Username-Feld mit mehreren Selektoren
            console.log(`   📧 Username: ${TWITTER_USERNAME}`);
            const usernameInput = await page.$('input[autocomplete="username"]') ||
                await page.$('input[name="text"]') ||
                await page.$('input[type="text"]');

            if (!usernameInput) {
                console.log('   ❌ Username-Feld nicht gefunden!');
                await page.screenshot({ path: 'debug-twitter-no-username-field.png' });
                await browser.close();
                return null;
            }

            await usernameInput.fill(TWITTER_USERNAME);
            await humanDelay(500, 1000);

            // "Weiter" klicken
            const nextButton = await page.$('text=Weiter') ||
                await page.$('text=Next') ||
                await page.$('[role="button"]:has-text("Next")') ||
                await page.$('[role="button"]:has-text("Weiter")');

            if (nextButton) {
                await nextButton.click();
            } else {
                await page.keyboard.press('Enter');
            }

            await page.waitForTimeout(2000);

            // Passwort eingeben
            console.log('   🔑 Passwort eingeben...');
            const passwordInput = await page.$('input[name="password"]') ||
                await page.$('input[type="password"]');

            if (passwordInput) {
                await passwordInput.fill(TWITTER_PASSWORD);
                await humanDelay(500, 1000);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(5000);
            } else {
                console.log('   ❌ Passwort-Feld nicht gefunden');
                await browser.close();
                return null;
            }

            // Session speichern
            console.log('   💾 Speichere Session...');
            const cookies = await context.cookies();
            const sessionDir = path.dirname(TWITTER_SESSION_PATH);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            fs.writeFileSync(TWITTER_SESSION_PATH, JSON.stringify({ cookies }, null, 2));
            console.log('   ✅ Session gespeichert!\n');
        } else {
            console.log('✅ Bereits eingeloggt!\n');
        }

        // Post erstellen
        console.log('📝 Erstelle Post...');

        // WICHTIG: Schließe eventuelle Popups die den Button blockieren
        console.log('   🔇 Schließe eventuelle Popups...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Versuche bekannte Popup-Buttons zu schließen
        const popupDismissers = [
            'button:has-text("Nicht jetzt")',
            'button:has-text("Not now")',
            'button:has-text("Vielleicht später")',
            'button:has-text("Maybe later")',
            '[aria-label="Close"]',
            '[aria-label="Schließen"]',
            '[data-testid="xMigrationBottomBar"] button'
        ];

        for (const selector of popupDismissers) {
            try {
                const btn = await page.$(selector);
                if (btn && await btn.isVisible()) {
                    await btn.click({ force: true });
                    console.log(`   ✅ Popup geschlossen: ${selector}`);
                    await page.waitForTimeout(500);
                }
            } catch { }
        }

        // Finde das Tweet-Textfeld
        const tweetBox = await page.$('[data-testid="tweetTextarea_0"]') ||
            await page.$('div[role="textbox"][contenteditable="true"]');

        if (!tweetBox) {
            console.log('❌ Tweet-Textfeld nicht gefunden');
            await page.screenshot({ path: 'debug-twitter-no-textbox.png' });
            await browser.close();
            return null;
        }

        // Text eingeben
        console.log('   ⌨️ Tippe Text...');
        await tweetBox.click({ force: true });
        await page.waitForTimeout(500);
        await tweetBox.fill(text);
        await humanDelay(1000, 2000);

        // "Posten" Button finden und klicken
        console.log('   🚀 Suche Post-Button...');
        const postButton = await page.$('[data-testid="tweetButtonInline"]') ||
            await page.$('[data-testid="tweetButton"]') ||
            await page.$('div[role="button"]:has-text("Posten")') ||
            await page.$('div[role="button"]:has-text("Post")');

        if (!postButton) {
            console.log('   ❌ Post-Button nicht gefunden');
            await page.screenshot({ path: 'debug-twitter-no-button.png' });
            await browser.close();
            return null;
        }

        console.log('   ✅ Post-Button gefunden - klicke...');
        // force: true umgeht das "element intercepts pointer events" Problem
        await postButton.click({ force: true });

        // Warte länger und prüfe auf verschiedene Erfolgsindikatoren
        console.log('   ⏳ Warte auf Bestätigung...');
        await page.waitForTimeout(3000);

        // Screenshot nach dem Posten
        await page.screenshot({ path: 'debug-twitter-after-post.png' });
        console.log('   📸 Screenshot nach Post erstellt');

        // Prüfe auf Erfolg durch verschiedene Methoden
        const currentUrl = page.url();
        console.log(`   📍 Aktuelle URL: ${currentUrl}`);

        // Methode 1: URL enthält /status/
        if (currentUrl.includes('/status/')) {
            console.log('\n✅ POST ERFOLGREICH! (URL geändert)');
            console.log(`🔗 Tweet URL: ${currentUrl}\n`);
            await browser.close();
            return currentUrl;
        }

        // Methode 2: Prüfe ob das Textfeld jetzt leer ist (= Post wurde gesendet)
        const textboxContent = await page.evaluate(() => {
            const textbox = document.querySelector('[data-testid="tweetTextarea_0"]');
            return textbox?.textContent || '';
        });

        if (textboxContent.trim() === '') {
            console.log('\n✅ POST WAHRSCHEINLICH ERFOLGREICH! (Textfeld ist leer)');
            console.log('   Das Textfeld wurde geleert, was auf einen erfolgreichen Post hindeutet.');
            console.log(`   Prüfe manuell: https://x.com/BuliFollows\n`);
            await browser.close();
            return `https://x.com/BuliFollows`;
        }

        // Methode 3: Suche nach Toast/Erfolgs-Nachricht
        const toastVisible = await page.$('[data-testid="toast"]');
        if (toastVisible) {
            const toastText = await toastVisible.innerText().catch(() => '');
            console.log(`   🔔 Toast gefunden: "${toastText}"`);
            if (toastText.includes('gesendet') || toastText.includes('posted') || toastText.includes('sent')) {
                console.log('\n✅ POST ERFOLGREICH! (Toast-Bestätigung)');
                await browser.close();
                return `https://x.com/BuliFollows`;
            }
        }

        console.log('\n⚠️ Post-Status unklar. Prüfe manuell: https://x.com/BuliFollows');
        console.log('   Screenshot wurde gespeichert: debug-twitter-after-post.png');
        await browser.close();
        return null;

    } catch (err: any) {
        console.log(`\n❌ Fehler: ${err.message}\n`);
        await page.screenshot({ path: 'debug-twitter-error.png' }).catch(() => { });
        await browser.close();
        return null;
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log('🧪 VPS TWITTER POST TEST');
    console.log('═'.repeat(60));

    const testMessage = `🧪 Test-Post vom VPS - ${new Date().toLocaleString('de-DE')}

Dieser Post wurde automatisch über Playwright erstellt! 🤖

#AutomationTest #InstaFollows`;

    const tweetUrl = await postToTwitter(testMessage);

    console.log('═'.repeat(60));
    if (tweetUrl) {
        console.log('✅ TEST ERFOLGREICH');
        console.log(`🔗 ${tweetUrl}`);
    } else {
        console.log('❌ TEST FEHLGESCHLAGEN');
        console.log('💡 Prüfe die Debug-Screenshots für Details');
    }
    console.log('═'.repeat(60));
}

main().catch(console.error);

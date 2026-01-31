/**
 * Debug Script: Prüft warum Following-Liste nicht scrollt
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

async function debugFollowing() {
    console.log('🔍 Debug: Following-Dialog...\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        storageState: fs.existsSync('data/sessions/instagram-session.json') ? 'data/sessions/instagram-session.json' : undefined,
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    try {
        // 1. Zur Following-Seite navigieren
        console.log('1. Navigiere zu morewatchez...');
        await page.goto('https://www.instagram.com/morewatchez/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'debug-1-profile.png' });
        console.log('   Screenshot: debug-1-profile.png');

        // 2. Following-Link klicken
        console.log('2. Klicke auf Following...');
        const followingLink = await page.$('a[href*="/following"]');
        if (!followingLink) {
            // Alternativ: Text suchen
            const followingText = await page.$('text=/\\d+\\s*(following|abonniert)/i');
            if (followingText) {
                await followingText.click();
            } else {
                console.log('   ❌ Following-Link nicht gefunden!');
                await page.screenshot({ path: 'debug-2-no-link.png' });
                return;
            }
        } else {
            await followingLink.click();
        }

        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'debug-2-dialog.png' });
        console.log('   Screenshot: debug-2-dialog.png');

        // 3. Dialog prüfen
        console.log('3. Prüfe Dialog...');
        const dialog = await page.$('div[role="dialog"]');
        console.log(`   Dialog gefunden: ${!!dialog}`);

        // 4. Scrollbare Container finden
        const scrollContainers = await page.$$('div[style*="overflow"]');
        console.log(`   Scrollbare Container: ${scrollContainers.length}`);

        // 5. Following-Einträge zählen
        const followingItems = await page.$$('div[role="dialog"] a[role="link"]');
        console.log(`   Following-Einträge sichtbar: ${followingItems.length}`);

        // 6. Versuche zu scrollen
        console.log('4. Versuche Scroll...');
        if (dialog) {
            // Scroll im Dialog
            await dialog.evaluate((el) => {
                const scrollable = el.querySelector('div[style*="overflow"]') || el;
                scrollable.scrollTop = scrollable.scrollHeight;
            });
            await page.waitForTimeout(2000);

            const afterScroll = await page.$$('div[role="dialog"] a[role="link"]');
            console.log(`   Nach Scroll: ${afterScroll.length} Einträge`);
        }

        await page.screenshot({ path: 'debug-3-after-scroll.png' });
        console.log('   Screenshot: debug-3-after-scroll.png');

        // 7. HTML-Struktur loggen
        console.log('\n5. Dialog HTML-Struktur:');
        if (dialog) {
            const dialogHtml = await dialog.evaluate((el) => {
                return el.innerHTML.substring(0, 2000);
            });
            console.log(dialogHtml.substring(0, 500) + '...');
        }

    } catch (err: any) {
        console.log(`❌ Fehler: ${err.message}`);
        await page.screenshot({ path: 'debug-error.png' });
    } finally {
        await browser.close();
        console.log('\n✅ Debug abgeschlossen. Screenshots erstellt.');
    }
}

debugFollowing();

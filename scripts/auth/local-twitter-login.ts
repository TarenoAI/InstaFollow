import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');

async function main() {
    console.log('🐦 TWITTER LOCAL LOGIN');
    console.log('   Ein Browser-Fenster wird sich öffnen.');
    console.log('   Bitte logge dich manuell bei Twitter ein.');
    console.log('   Drücke im Terminal ENTER, wenn du fertig bist und die Startseite siehst.');

    const browser = await chromium.launch({
        headless: false, // WICHTIG: Fenster sichtbar
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    try {
        await page.goto('https://twitter.com/login');

        // Warte auf User-Input im Terminal
        await new Promise(resolve => {
            process.stdin.once('data', resolve);
        });

        // Speichern
        await context.storageState({ path: TWITTER_SESSION_PATH });
        console.log(`\n✅ Session gespeichert in: ${TWITTER_SESSION_PATH}`);
        console.log('   Jetzt kannst du diese Datei auf den VPS hochladen!');

    } catch (err) {
        console.error('Fehler:', err);
    } finally {
        await browser.close();
        process.exit();
    }
}

main();

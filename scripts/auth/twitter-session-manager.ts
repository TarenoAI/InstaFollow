/**
 * 🔐 SMART TWITTER SESSION MANAGER
 * 
 * Verwaltet Twitter Sessions mit automatischem Fallback:
 * 1. Versucht bestehende Session zu nutzen
 * 2. Bei Problemen: Session refresh
 * 3. Fallback: Firefox Browser
 */

import { chromium, firefox, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

const CHROMIUM_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const FIREFOX_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-firefox-session.json');

export interface TwitterSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    browserType: 'chromium' | 'firefox';
}

export interface SessionOptions {
    headless?: boolean;
    preferredBrowser?: 'chromium' | 'firefox';
}

/**
 * Prüft ob eine Session noch gültig ist
 */
async function isSessionValid(page: Page): Promise<boolean> {
    try {
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        const url = page.url();

        // Prüfe ob wir auf der Login-Seite gelandet sind
        if (url.includes('login') || url.includes('flow/login')) {
            console.log('   ⚠️ Session ungültig - Login erforderlich');
            return false;
        }

        // Prüfe ob wir auf der Home-Seite sind
        const homeIndicator = await page.$('[data-testid="primaryColumn"]') ||
            await page.$('[data-testid="tweetTextarea_0"]');

        if (homeIndicator) {
            console.log('   ✅ Session ist gültig');
            return true;
        }

        console.log('   ⚠️ Session-Status unklar');
        return false;
    } catch (err) {
        console.log('   ❌ Fehler bei Session-Prüfung:', (err as Error).message);
        return false;
    }
}

/**
 * Startet einen Browser mit bestehender Session
 */
async function startWithSession(
    browserType: 'chromium' | 'firefox',
    sessionPath: string,
    headless: boolean
): Promise<TwitterSession | null> {
    const browserLabel = browserType === 'chromium' ? '🌐 Chromium' : '🦊 Firefox';
    console.log(`\n${browserLabel} starten...`);

    const browserEngine = browserType === 'chromium' ? chromium : firefox;

    const browser = await browserEngine.launch({
        headless,
        args: browserType === 'chromium' ? [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ] : []
    });

    const hasSession = fs.existsSync(sessionPath);
    console.log(`   Session-Datei: ${hasSession ? '✅ Vorhanden' : '❌ Nicht gefunden'}`);

    const context = await browser.newContext({
        storageState: hasSession ? sessionPath : undefined,
        viewport: { width: 1280, height: 800 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = await context.newPage();

    // Prüfe Session
    const valid = await isSessionValid(page);

    if (!valid) {
        await browser.close();
        return null;
    }

    return { browser, context, page, browserType };
}

/**
 * Speichert die aktuelle Session
 */
export async function saveSession(session: TwitterSession): Promise<void> {
    const sessionPath = session.browserType === 'chromium'
        ? CHROMIUM_SESSION_PATH
        : FIREFOX_SESSION_PATH;

    const sessionDir = path.dirname(sessionPath);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    await session.context.storageState({ path: sessionPath });
    console.log(`💾 Session gespeichert: ${session.browserType}`);
}

/**
 * Hauptfunktion: Holt eine gültige Twitter Session
 * Versucht automatisch verschiedene Ansätze
 */
export async function getTwitterSession(options: SessionOptions = {}): Promise<TwitterSession | null> {
    const headless = options.headless ?? false;
    const preferredBrowser = options.preferredBrowser ?? 'chromium';

    console.log('═'.repeat(50));
    console.log('🔐 TWITTER SESSION MANAGER');
    console.log('═'.repeat(50));

    // 1. Versuche bevorzugten Browser mit bestehender Session
    const primarySessionPath = preferredBrowser === 'chromium'
        ? CHROMIUM_SESSION_PATH
        : FIREFOX_SESSION_PATH;

    console.log(`\n📌 Versuch 1: ${preferredBrowser} mit bestehender Session`);
    let session = await startWithSession(preferredBrowser, primarySessionPath, headless);

    if (session) {
        console.log(`\n✅ Erfolgreich mit ${preferredBrowser} verbunden!`);
        return session;
    }

    // 2. Versuche alternativen Browser
    const fallbackBrowser = preferredBrowser === 'chromium' ? 'firefox' : 'chromium';
    const fallbackSessionPath = fallbackBrowser === 'chromium'
        ? CHROMIUM_SESSION_PATH
        : FIREFOX_SESSION_PATH;

    console.log(`\n📌 Versuch 2: ${fallbackBrowser} als Fallback`);
    session = await startWithSession(fallbackBrowser, fallbackSessionPath, headless);

    if (session) {
        console.log(`\n✅ Erfolgreich mit ${fallbackBrowser} (Fallback) verbunden!`);
        return session;
    }

    // 3. Keine gültige Session gefunden
    console.log('\n❌ Keine gültige Session gefunden!');
    console.log('\n💡 Empfohlene Aktionen:');
    console.log('   1. VNC verbinden: vnc://31.97.32.40:5901');
    console.log('   2. Fix-Script ausführen:');
    console.log('      npx tsx scripts/auth/fix-twitter-vnc.ts');

    return null;
}

/**
 * Schließt eine Session sauber
 */
export async function closeSession(session: TwitterSession): Promise<void> {
    try {
        await session.browser.close();
        console.log('🔒 Session geschlossen');
    } catch { }
}

// Wenn direkt ausgeführt, zeige Session-Status
if (require.main === module) {
    (async () => {
        const session = await getTwitterSession({ headless: false });

        if (session) {
            console.log('\n═'.repeat(50));
            console.log('✅ SESSION AKTIV');
            console.log(`   Browser: ${session.browserType}`);
            console.log('   Status: Eingeloggt');
            console.log('═'.repeat(50));

            // Session speichern und schließen
            await saveSession(session);
            await closeSession(session);
        } else {
            console.log('\n═'.repeat(50));
            console.log('❌ KEINE GÜLTIGE SESSION');
            console.log('═'.repeat(50));
            process.exit(1);
        }
    })();
}

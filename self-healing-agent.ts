/**
 * 🤖 SELF-HEALING INSTAGRAM MONITOR AGENT
 * 
 * Intelligenter Agent der automatisch Probleme erkennt und behebt:
 * - Login-Session abgelaufen → Automatisch neu einloggen
 * - Scraping-Quote zu niedrig → Retry mit anderen Strategien
 * - Popups/Dialoge → Automatisch schließen
 * - Rate-Limiting → Wartezeit und Retry
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import 'dotenv/config';

// ============ CONFIGURATION ============
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL!;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN!;
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME!;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD!;
const INSTAGRAM_SESSION_PATH = 'instagram-session.json';
const N8N_FAIL_WEBHOOK_URL = process.env.N8N_FAIL_WEBHOOK_URL || ''; // Webhook für Fehlerbenachrichtigungen

const MAX_RETRIES = 3;
const MIN_SCRAPE_QUOTA = 0.95; // 95% - Realistische Quote für Mobile Scraping

// ============ AGENT STATE ============
interface AgentState {
    isLoggedIn: boolean;
    lastError: string | null;
    retryCount: number;
    currentProfile: string | null;
    screenshots: string[];
}

const agentState: AgentState = {
    isLoggedIn: false,
    lastError: null,
    retryCount: 0,
    currentProfile: null,
    screenshots: []
};

// ============ DATABASE ============
const db = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN
});

// ============ HELPER FUNCTIONS ============
function log(emoji: string, message: string, indent: number = 0) {
    const prefix = '   '.repeat(indent);
    console.log(`${prefix}${emoji} ${message}`);
}

async function humanDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function takeDebugScreenshot(page: Page, name: string): Promise<string> {
    const filename = `agent-debug-${name}-${Date.now()}.png`;
    await page.screenshot({ path: filename, fullPage: true });
    agentState.screenshots.push(filename);
    log('📸', `Screenshot: ${filename}`, 1);
    return filename;
}

// Sende Fehler-Benachrichtigung an n8n
async function sendFailWebhook(
    username: string,
    reason: string,
    details: {
        expected: number;
        scraped: number;
        quota: number;
        viewport: string;
        screenshots: string[];
    }
): Promise<void> {
    if (!N8N_FAIL_WEBHOOK_URL) {
        log('⚠️', 'N8N_FAIL_WEBHOOK_URL nicht konfiguriert - kein Webhook gesendet', 1);
        return;
    }

    try {
        // Lese letzten Screenshot als Base64
        let screenshotBase64 = '';
        const lastScreenshot = details.screenshots[details.screenshots.length - 1];
        if (lastScreenshot && fs.existsSync(lastScreenshot)) {
            screenshotBase64 = fs.readFileSync(lastScreenshot).toString('base64');
        }

        const payload = {
            type: 'SCRAPING_FAILED',
            timestamp: new Date().toISOString(),
            profile: username,
            reason: reason,
            expected: details.expected,
            scraped: details.scraped,
            quotaPercent: (details.quota * 100).toFixed(1),
            viewport: details.viewport,
            screenshotBase64: screenshotBase64,
            screenshotFilename: lastScreenshot || 'none'
        };

        const response = await fetch(N8N_FAIL_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            log('📤', `Fehler-Webhook gesendet an n8n`, 1);
        } else {
            log('❌', `Webhook-Fehler: ${response.status}`, 1);
        }
    } catch (err: any) {
        log('❌', `Webhook-Exception: ${err.message}`, 1);
    }
}

// 🚩 Erstellt einen Incident-Report im Repo und pusht ihn zu GitHub
async function createIncidentReport(
    username: string,
    reason: string,
    details: {
        expected: number;
        scraped: number;
        quota: number;
        viewport: string;
        screenshots: string[];
    }
): Promise<void> {
    const incidentDir = path.join(process.cwd(), '.incidents');
    if (!fs.existsSync(incidentDir)) {
        fs.mkdirSync(incidentDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportId = `incident-${username}-${timestamp}`;
    const reportPath = path.join(incidentDir, `${reportId}.md`);

    // Letzten Screenshot in den Incident-Ordner verschieben/kopieren
    let incidentScreenshot = '';
    const lastScreenshot = details.screenshots[details.screenshots.length - 1];
    if (lastScreenshot && fs.existsSync(lastScreenshot)) {
        incidentScreenshot = `${reportId}.png`;
        fs.copyFileSync(lastScreenshot, path.join(incidentDir, incidentScreenshot));
    }

    const content = `
# 🚨 INCIDENT REPORT: Scraping Failed for @${username}
**Datum:** ${new Date().toLocaleString()}
**Status:** FAILED
**Grund:** ${reason}

## 📊 Statistik
- **Erwartet:** ${details.expected}
- **Gescrapt:** ${details.scraped}
- **Quote:** ${(details.quota * 100).toFixed(1)}% (Limit: ${(MIN_SCRAPE_QUOTA * 100).toFixed(1)}%)
- **Viewport:** ${details.viewport}

## 📸 Letzter Zustand
![Screenshot](${incidentScreenshot})

## 📝 Analyse-Log
- Retry-Versuche: ${MAX_RETRIES}
- Strategien: js-scroll, keyboard, mouse-wheel
- Letzte Screenshots: ${details.screenshots.slice(-3).join(', ')}

---
*Dieser Report wurde automatisch vom Self-Healing Agenten erstellt.*
`;

    fs.writeFileSync(reportPath, content);
    log('📝', `Incident-Report erstellt: ${reportPath}`, 1);

    try {
        log('🚀', 'Pushe Incident zu GitHub für automatische Analyse...', 1);
        execSync(`git add .incidents/${reportId}.*`);
        execSync(`git commit -m "incident: scrape fail @${username} [skip ci]"`);
        execSync('git push origin main');
        log('✅', 'Incident erfolgreich zu GitHub gepusht!', 1);
    } catch (err: any) {
        log('❌', `Git-Push fehlgeschlagen: ${err.message}`, 1);
    }
}

// ============ PROBLEM DETECTION ============
interface ProblemAnalysis {
    type: 'LOGIN_REQUIRED' | 'POPUP_BLOCKING' | 'RATE_LIMITED' | 'SCRAPING_FAILED' | 'UNKNOWN';
    confidence: number;
    suggestedAction: string;
}

async function analyzeProblem(page: Page): Promise<ProblemAnalysis> {
    const screenshotPath = await takeDebugScreenshot(page, 'analysis');

    // Analyse basierend auf Page-Content
    const pageContent = await page.content();
    const url = page.url();

    // 1. Login-Seite erkennen
    if (url.includes('/accounts/login') ||
        pageContent.includes('Log into Instagram') ||
        pageContent.includes('Log in') && pageContent.includes('Password')) {
        return {
            type: 'LOGIN_REQUIRED',
            confidence: 0.95,
            suggestedAction: 'Automatisch mit gespeicherten Credentials einloggen'
        };
    }

    // 2. Popups erkennen
    const hasPopup = await page.$('div[role="dialog"]');
    if (hasPopup) {
        const popupText = await hasPopup.textContent() || '';

        if (popupText.includes('Turn on Notifications') ||
            popupText.includes('Benachrichtigungen')) {
            return {
                type: 'POPUP_BLOCKING',
                confidence: 0.9,
                suggestedAction: 'Notification-Popup schließen'
            };
        }

        if (popupText.includes('Save Your Login Info') ||
            popupText.includes('Anmeldeinformationen')) {
            return {
                type: 'POPUP_BLOCKING',
                confidence: 0.9,
                suggestedAction: 'Login-Info Popup schließen'
            };
        }
    }

    // 3. Rate-Limiting erkennen
    if (pageContent.includes('Please wait a few minutes') ||
        pageContent.includes('Try Again Later') ||
        pageContent.includes('Action Blocked')) {
        return {
            type: 'RATE_LIMITED',
            confidence: 0.85,
            suggestedAction: 'Warte 5 Minuten und versuche erneut'
        };
    }

    // 4. Scraping fehlgeschlagen
    if (agentState.lastError?.includes('Scraping-Quote')) {
        return {
            type: 'SCRAPING_FAILED',
            confidence: 0.8,
            suggestedAction: 'Versuche alternative Scroll-Strategie'
        };
    }

    return {
        type: 'UNKNOWN',
        confidence: 0.5,
        suggestedAction: 'Manuelles Eingreifen erforderlich'
    };
}

// ============ AUTO-FIX ACTIONS ============
async function performLogin(page: Page): Promise<boolean> {
    log('🔐', 'Führe automatischen Login durch...', 1);

    try {
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        // Screenshot vor Login
        await takeDebugScreenshot(page, 'login-page');

        // Cookie Consent schließen (falls vorhanden)
        const cookieButtons = [
            'button:has-text("Allow all cookies")',
            'button:has-text("Alle Cookies erlauben")',
            'button:has-text("Accept All")',
            'button:has-text("Akzeptieren")',
            'button:has-text("Allow essential and optional cookies")',
            '[data-testid="cookie-policy-manage-dialog-accept-button"]'
        ];

        for (const selector of cookieButtons) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click();
                    log('🍪', 'Cookie-Consent akzeptiert', 2);
                    await page.waitForTimeout(2000);
                    break;
                }
            } catch { }
        }

        // Warte auf Login-Formular
        await page.waitForTimeout(2000);

        // Versuche verschiedene Selektoren für Username
        const usernameSelectors = [
            'input[name="username"]',
            'input[aria-label="Phone number, username, or email"]',
            'input[aria-label="Telefonnummer, Benutzername oder E-Mail"]',
            'input[type="text"]'
        ];

        let usernameInput = null;
        for (const selector of usernameSelectors) {
            usernameInput = await page.$(selector);
            if (usernameInput) {
                log('📝', `Username-Feld gefunden: ${selector}`, 2);
                break;
            }
        }

        if (!usernameInput) {
            await takeDebugScreenshot(page, 'login-no-username');
            log('❌', 'Kein Username-Feld gefunden', 2);
            return false;
        }

        // Username eingeben
        await usernameInput.fill(INSTAGRAM_USERNAME);
        await humanDelay(500, 1000);

        // Password eingeben
        const passwordInput = await page.$('input[name="password"], input[type="password"]');
        if (passwordInput) {
            await passwordInput.fill(INSTAGRAM_PASSWORD);
        } else {
            log('❌', 'Kein Password-Feld gefunden', 2);
            return false;
        }
        await humanDelay(500, 1000);

        // Screenshot vor Submit
        await takeDebugScreenshot(page, 'login-before-submit');

        // Login Button klicken - verschiedene Selektoren
        const loginButtonSelectors = [
            'button[type="submit"]',
            'button:has-text("Log in")',
            'button:has-text("Anmelden")',
            'div[role="button"]:has-text("Log in")',
            'div[role="button"]:has-text("Anmelden")'
        ];

        let buttonClicked = false;
        for (const selector of loginButtonSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click();
                    log('🔘', `Login-Button geklickt: ${selector}`, 2);
                    buttonClicked = true;
                    break;
                }
            } catch { }
        }

        if (!buttonClicked) {
            // Fallback: Enter drücken
            log('⌨️', 'Fallback: Enter drücken', 2);
            await page.keyboard.press('Enter');
        }

        await page.waitForTimeout(8000);

        // Prüfe ob Login erfolgreich
        const currentUrl = page.url();
        if (!currentUrl.includes('/accounts/login')) {
            log('✅', 'Login erfolgreich!', 1);

            // Session speichern
            await page.context().storageState({ path: INSTAGRAM_SESSION_PATH });
            log('💾', 'Session gespeichert', 1);

            agentState.isLoggedIn = true;
            return true;
        }

        log('❌', 'Login fehlgeschlagen', 1);
        return false;

    } catch (err: any) {
        log('❌', `Login-Fehler: ${err.message}`, 1);
        return false;
    }
}

async function dismissAllPopups(page: Page): Promise<boolean> {
    log('🚫', 'Schließe Popups...', 1);

    let popupsClosed = 0;

    // Verschiedene Popup-Schließ-Strategien
    const closeSelectors = [
        'button:has-text("Not Now")',
        'button:has-text("Nicht jetzt")',
        'button:has-text("Cancel")',
        'button:has-text("Abbrechen")',
        '[aria-label="Close"]',
        '[aria-label="Schließen"]',
        'svg[aria-label="Close"]'
    ];

    for (const selector of closeSelectors) {
        try {
            const button = await page.$(selector);
            if (button) {
                await button.click();
                popupsClosed++;
                await page.waitForTimeout(1000);
            }
        } catch { }
    }

    // ESC drücken als Fallback
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    log('✅', `${popupsClosed} Popups geschlossen`, 1);
    return popupsClosed > 0;
}

async function handleRateLimiting(): Promise<void> {
    log('⏳', 'Rate-Limiting erkannt. Warte 5 Minuten...', 1);

    for (let i = 5; i > 0; i--) {
        log('⏳', `Noch ${i} Minuten...`, 2);
        await new Promise(resolve => setTimeout(resolve, 60000));
    }

    log('✅', 'Wartezeit beendet, versuche erneut', 1);
}

// ============ INTELLIGENT SCRAPING ============
async function intelligentScrape(
    page: Page,
    username: string,
    expectedCount: number
): Promise<{ success: boolean; following: string[]; retryReason?: string }> {
    log('🔍', `Scrape ${username} (erwartet: ${expectedCount})`, 1);

    const following: Set<string> = new Set();
    const apiFollowing: Set<string> = new Set();

    // API Response Interception
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/api/v1/friendships/') && url.includes('/following/')) {
            try {
                const json = await response.json();
                if (json.users) {
                    for (const user of json.users) {
                        if (user.username) apiFollowing.add(user.username);
                    }
                }
            } catch { }
        }
    });

    // Navigiere zum Profil
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Screenshot vor dem Klick
    await takeDebugScreenshot(page, `${username}-profile`);

    // Following klicken - In Mobile oft durch "App öffnen" Banner blockiert
    log('🖱️', 'Versuche Following-Liste zu öffnen...', 2);

    const clickAttempt = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const fl = links.find(a =>
            a.href.includes('following') ||
            a.innerText.toLowerCase().includes('following') ||
            a.innerText.toLowerCase().includes('abonniert')
        );
        if (fl) {
            (fl as HTMLElement).click();
            return true;
        }
        return false;
    });

    if (!clickAttempt) {
        try {
            await page.click('a[href*="following"]', { timeout: 3000, force: true });
        } catch { }
    }

    await page.waitForTimeout(5000);

    // Screenshot nach Klick-Versuch
    await takeDebugScreenshot(page, `${username}-after-click-check`);

    // Prüfen, ob die Liste wirklich geladen wurde - In Mobile oft kein [role="dialog"]!
    const listOpened = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const listContainer = document.querySelector('div._aano');
        const ulList = document.querySelector('ul');
        return !!(dialog || listContainer || ulList);
    });

    if (!listOpened) {
        log('⚠️', 'Liste scheint nicht offen zu sein nach Klick. Erneuter Versuch...', 2);
        await page.keyboard.press('Escape'); // Schließe evtl. Banner
        await page.waitForTimeout(1000);
        await page.click('text=/\\d+\\s*(following|abonniert)/i', { force: true, timeout: 5000 }).catch(() => { });
        await page.waitForTimeout(4000);
    }

    // Scrolling mit verschiedenen Strategien
    const strategies = ['js-scroll', 'keyboard', 'mouse-wheel'];
    let strategyIndex = 0;
    let noNewCount = 0;
    const maxScrolls = Math.max(80, Math.ceil(expectedCount / 8) + 20);

    log('📜', `Starte Scrolling-Prozess (Max: ${maxScrolls}, Erwartet: ${expectedCount})`, 1);

    for (let scroll = 0; scroll < maxScrolls && noNewCount < 25; scroll++) {
        // DOM auslesen
        const users = await page.evaluate(() => {
            const links: string[] = [];

            // In Mobile ist der Dialog oft der gesamte Body oder ein spezielles div
            // Instagram Mobile UI nutzt oft div[role="dialog"] oder einfach die Hauptliste
            const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div._aano');

            const target = dialog || document.body;
            target.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && href.match(/^\/[a-zA-Z0-9._\-]+\/?$/)) {
                    const username = href.replace(/\//g, '');
                    if (!['explore', 'reels', 'p', 'direct', 'accounts'].includes(username)) {
                        links.push(username);
                    }
                }
            });
            return Array.from(new Set(links));
        });

        const currentDOMCount = users.length;
        const currentAPICount = apiFollowing.size;
        const totalFound = new Set([...users, ...apiFollowing]).size;

        if (scroll % 5 === 0 || scroll === 1) {
            log('📜', `Scroll ${scroll}: DOM=${currentDOMCount} | API=${currentAPICount} | Total=${totalFound} / ${expectedCount}`, 2);
        }

        const prevTotal = following.size;
        for (const u of users) following.add(u);
        for (const u of apiFollowing) following.add(u);

        if (following.size > prevTotal) {
            noNewCount = 0;
        } else {
            noNewCount++;
            if (noNewCount === 10) {
                const strategy = strategies[strategyIndex % strategies.length];
                log('🔄', `Keine neuen Daten - Wechsle Strategie zu: ${strategy}`, 2);
                strategyIndex++;
            }
        }

        // Scrolling ausführen
        try {
            const strategy = strategies[strategyIndex % strategies.length];
            if (strategy === 'js-scroll') {
                await page.evaluate(() => {
                    const scrollers = [
                        document.querySelector('[role="dialog"] div'),
                        document.querySelector('div._aano'),
                        window
                    ];
                    for (const s of scrollers) {
                        if (s) {
                            if (s === window) window.scrollBy(0, 800);
                            else (s as Element).scrollTop += 800;
                        }
                    }
                });
            } else if (strategy === 'keyboard') {
                await page.keyboard.press('End');
                await page.keyboard.press('PageDown');
            } else {
                await page.mouse.wheel(0, 800);
            }
        } catch {
            strategyIndex++;
        }

        await humanDelay(1000, 1800);

        // Alle 10 Scrolls: Extra warten + Strategie wechseln wenn nötig
        if (scroll % 10 === 9) {
            await page.waitForTimeout(2500);
            if (following.size < expectedCount * 0.5 && strategyIndex < strategies.length - 1) {
                strategyIndex++;
                log('🔄', `Wechsle zu Strategie: ${strategies[strategyIndex]}`, 2);
            }
        }
    }

    // Kombiniere DOM und API
    const combined = new Set([...following, ...apiFollowing]);
    combined.delete(username);

    const scraped = Array.from(combined);
    const quota = scraped.length / expectedCount;

    log('📊', `Ergebnis: ${scraped.length}/${expectedCount} (${(quota * 100).toFixed(1)}%)`, 1);

    if (quota < MIN_SCRAPE_QUOTA) {
        return {
            success: false,
            following: scraped,
            retryReason: `Nur ${(quota * 100).toFixed(1)}% gescrapt`
        };
    }

    return { success: true, following: scraped };
}

// ============ MAIN AGENT LOOP ============
async function runAgent() {
    console.log('\n' + '═'.repeat(60));
    console.log('🤖 SELF-HEALING INSTAGRAM AGENT');
    console.log('═'.repeat(60) + '\n');

    const browser = await chromium.launch({ headless: true });

    try {
        // Context mit Session erstellen - MOBILE VIEW für besseres Scraping!
        const context = await browser.newContext({
            storageState: fs.existsSync(INSTAGRAM_SESSION_PATH) ? INSTAGRAM_SESSION_PATH : undefined,
            viewport: { width: 390, height: 844 }, // iPhone 12 Pro
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            isMobile: true,
            hasTouch: true
        });

        const page = await context.newPage();

        // 1. Login prüfen
        log('🔍', 'Prüfe Login-Status...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        const problem = await analyzeProblem(page);

        if (problem.type === 'LOGIN_REQUIRED') {
            log('⚠️', 'Login erforderlich');
            const loginSuccess = await performLogin(page);
            if (!loginSuccess) {
                throw new Error('Automatischer Login fehlgeschlagen');
            }
        } else if (problem.type === 'POPUP_BLOCKING') {
            await dismissAllPopups(page);
        } else if (problem.type === 'RATE_LIMITED') {
            await handleRateLimiting();
        }

        log('✅', 'Login bestätigt!\n');

        // 2. Profile laden
        const profiles = await db.execute(`
            SELECT id, username, followingCount 
            FROM MonitoredProfile 
            ORDER BY lastCheckedAt ASC
        `);

        log('📋', `${profiles.rows.length} Profile zu prüfen\n`);

        // 3. Profile durchgehen mit Self-Healing
        for (const profile of profiles.rows) {
            const username = profile.username as string;
            const dbCount = profile.followingCount as number;

            agentState.currentProfile = username;
            agentState.retryCount = 0;

            console.log('─'.repeat(60));
            log('👤', `@${username} (DB: ${dbCount})`);

            // Aktuellen Count holen
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);

            const currentCount = await page.evaluate(() => {
                const text = document.body.innerText;
                const match = text.match(/(\d+)\s*(following|abonniert)/i);
                return match ? parseInt(match[1]) : null;
            });

            if (!currentCount) {
                log('⚠️', 'Konnte Count nicht lesen', 1);
                continue;
            }

            log('📊', `Aktuell: ${currentCount}`, 1);

            if (currentCount === dbCount) {
                log('✅', 'Keine Änderung', 1);
                continue;
            }

            log('🚨', `ÄNDERUNG: ${dbCount} → ${currentCount}`, 1);

            // Scraping mit Retry-Logic
            let scrapeResult = { success: false, following: [] as string[], retryReason: '' };

            while (agentState.retryCount < MAX_RETRIES && !scrapeResult.success) {
                const result = await intelligentScrape(page, username, currentCount);
                scrapeResult = {
                    success: result.success,
                    following: result.following,
                    retryReason: result.retryReason || 'Unbekannter Fehler'
                };

                if (!scrapeResult.success) {
                    agentState.retryCount++;
                    log('🔄', `Retry ${agentState.retryCount}/${MAX_RETRIES}: ${scrapeResult.retryReason}`, 1);

                    // Problem analysieren und beheben
                    const problem = await analyzeProblem(page);

                    if (problem.type === 'LOGIN_REQUIRED') {
                        await performLogin(page);
                    } else if (problem.type === 'POPUP_BLOCKING') {
                        await dismissAllPopups(page);
                    } else if (problem.type === 'RATE_LIMITED') {
                        await handleRateLimiting();
                    } else {
                        // Warte etwas und versuche erneut
                        await page.waitForTimeout(5000);
                    }
                }
            }

            if (scrapeResult.success) {
                log('✅', `Erfolgreich: ${scrapeResult.following.length} Following`, 1);

                // TODO: Change Detection und Twitter-Post hier einfügen

            } else {
                // Detaillierte Fehleranalyse
                const scrapedCount = scrapeResult.following.length;
                const quotaPercent = (scrapedCount / currentCount * 100).toFixed(1);

                log('❌', `SCRAPING FEHLGESCHLAGEN nach ${MAX_RETRIES} Versuchen`, 1);
                log('�', `Diagnose für @${username}:`, 1);
                log('', `   • Erwartet: ${currentCount} Accounts`, 0);
                log('', `   • Gescrapt: ${scrapedCount} Accounts (${quotaPercent}%)`, 0);
                log('', `   • Benötigt: mindestens ${Math.ceil(currentCount * MIN_SCRAPE_QUOTA)} (${MIN_SCRAPE_QUOTA * 100}%)`, 0);
                log('', `   • Viewport: Mobile (iPhone 12 Pro)`, 0);
                log('', `   • Mögliche Ursachen:`, 0);
                log('', `     1. Instagram Rate-Limiting / Lazy-Load Block`, 0);
                log('', `     2. Session abgelaufen während Scraping`, 0);
                log('', `     3. Netzwerk-Probleme auf VPS`, 0);
                log('', `     4. Instagram UI-Änderung`, 0);
                log('📸', `Screenshots: ${agentState.screenshots.slice(-3).join(', ')}`, 1);

                // Webhook an n8n senden
                await sendFailWebhook(username, scrapeResult.retryReason, {
                    expected: currentCount,
                    scraped: scrapedCount,
                    quota: scrapedCount / currentCount,
                    viewport: 'Mobile (iPhone 12 Pro)',
                    screenshots: agentState.screenshots
                });

                // Incident Report an GitHub senden
                await createIncidentReport(username, scrapeResult.retryReason, {
                    expected: currentCount,
                    scraped: scrapedCount,
                    quota: scrapedCount / currentCount,
                    viewport: 'Mobile (iPhone 12 Pro)',
                    screenshots: agentState.screenshots
                });
            }

            await humanDelay(5000, 10000);
        }

        // Session speichern
        await context.storageState({ path: INSTAGRAM_SESSION_PATH });
        log('💾', 'Session gespeichert');

    } catch (err: any) {
        log('❌', `Agent-Fehler: ${err.message}`);
        agentState.lastError = err.message;
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🤖 AGENT BEENDET');
    console.log('═'.repeat(60) + '\n');
}

// ============ RUN ============
runAgent();

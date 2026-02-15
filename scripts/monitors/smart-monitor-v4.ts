/**
 * 🕵️‍♂️ SMART MONITORING v4 - MIT SCREENSHOTS & TWITTER POST
 * 
 * - Screenshots der Profile bei Änderungen
 * - Automatischer Twitter-Post via Playwright (keine API nötig!)
 * - Webhook-Bestätigung nach Post
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, firefox, devices, Page, BrowserContext, Browser } from 'playwright';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { saveMonitoringLog, ensureMonitoringLogTable, LogStatus } from '../lib/monitoring-log';
import { addToQueue } from '../lib/twitter-queue';
import { getTwitterContext, closeTwitterContext, checkTwitterSession } from '../lib/twitter-auto-login';

// === KONFIGURATION ===
const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'public/screenshots');
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');
const INCIDENTS_DIR = path.join(process.cwd(), '.incidents');
const iPhone = devices['iPhone 13 Pro'];

const LOCK_FILE = path.join(process.cwd(), '.monitor.lock');
const RATE_LIMIT_FILE = path.join(process.cwd(), '.rate_limit.lock');
let globalRateLimited = false;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

// Erstelle Ordner
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
if (!fs.existsSync(INCIDENTS_DIR)) fs.mkdirSync(INCIDENTS_DIR, { recursive: true });

// === TYPEN ===
interface ProfileInfo {
    username: string;
    fullName: string;
    profilePicUrl: string;
    followerCount: string;
    followingCount: string;
    isVerified: boolean;
    screenshotPath?: string;
}

interface WebhookPayload {
    event: 'FOLLOW' | 'UNFOLLOW';
    monitoredProfile: ProfileInfo;
    targets: ProfileInfo[];
    timestamp: string;
    summary: string;
    tweetUrl?: string;
}

// === HELPER ===
async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

/**
 * Pusht Debug-Screenshots automatisch zu Git für Remote-Debugging
 */
async function pushDebugScreenshot(filepath: string, message: string = 'debug screenshot'): Promise<boolean> {
    const { execSync } = require('child_process');
    try {
        // Erst pullen um Konflikte zu vermeiden
        execSync('git pull --rebase', { cwd: process.cwd(), stdio: 'ignore' });
        execSync(`git add -f "${filepath}"`, { cwd: process.cwd(), stdio: 'pipe' });
        execSync(`git commit -m "${message}" --allow-empty`, { cwd: process.cwd(), stdio: 'pipe' });
        execSync('git push', { cwd: process.cwd(), stdio: 'pipe' });
        console.log(`   📤 Screenshot gepusht: ${path.basename(filepath)}`);
        return true;
    } catch (err: any) {
        console.log(`   ⚠️ Git-Push für Screenshot fehlgeschlagen: ${err.message?.substring(0, 100)}`);
        return false;
    }
}

/**
 * Macht einen Screenshot vom aktuellen Profil und speichert ihn
 * Gibt die GitHub RAW URL zurück (für Vercel-Zugriff)
 */
async function captureProfileScreenshot(page: Page, username: string): Promise<string | null> {
    try {
        // Erstelle Screenshots-Ordner falls nicht vorhanden
        if (!fs.existsSync(SCREENSHOTS_DIR)) {
            fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        }

        const timestamp = Date.now();
        const filename = `${username}-${timestamp}.png`;
        const filepath = path.join(SCREENSHOTS_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: false });
        console.log(`   📸 Screenshot gespeichert: ${filename}`);

        // GitHub Raw URL für Vercel-Zugriff
        const githubRawUrl = `https://raw.githubusercontent.com/TarenoAI/InstaFollow/main/public/screenshots/${filename}`;
        return githubRawUrl;
    } catch (err: any) {
        console.log(`   ⚠️ Screenshot fehlgeschlagen: ${err.message}`);
        return null;
    }
}

const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

/**
 * Führt einen automatischen Login bei Instagram durch
 */
async function performLogin(page: Page): Promise<boolean> {
    try {
        console.log('🏁 Starte Auto-Login Prozess...');
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000);
        await dismissPopups(page);

        // FALL 1: Gespeichertes Konto ("Weiter" / "Continue as")
        // Instagram verwendet nicht immer <button> - manchmal div, span, oder andere Elemente
        const continueBtnSelectors = [
            // Deutsche Varianten
            'button:has-text("Weiter")',
            'div[role="button"]:has-text("Weiter")',
            'span:has-text("Weiter")',
            '[role="button"]:has-text("Weiter")',
            // Englische Varianten
            'button:has-text("Continue")',
            'div[role="button"]:has-text("Continue")',
            'button:has-text("Log in as")',
            'div[role="button"]:has-text("Log in as")',
            // Fallback: Blauer Button (typisch für Instagram Continue)
            'button[style*="background-color: rgb(0, 149, 246)"]',
            'div[style*="background-color: rgb(0, 149, 246)"]',
        ];

        let continueBtnClicked = false;
        for (const selector of continueBtnSelectors) {
            try {
                const continueBtn = page.locator(selector).first();
                if (await continueBtn.count() > 0 && await continueBtn.isVisible()) {
                    console.log(`   🖱️ Klicke "Weiter" Button (${selector})...`);
                    await continueBtn.click({ force: true });
                    continueBtnClicked = true;
                    break;
                }
            } catch { }
        }

        if (continueBtnClicked) {
            await page.waitForTimeout(3000);
            await dismissPopups(page);

            // FALL 1b: Nach "Weiter" kommt Passwort-Abfrage (Saved Login mit Passwort-Bestätigung)
            const passFieldOnly = page.locator('input[name="password"], input[type="password"]');
            const userFieldCheck = page.locator('input[name="username"]');

            // Prüfe ob nur Passwort-Feld sichtbar (gespeicherter Account)
            if (await passFieldOnly.isVisible() && !(await userFieldCheck.isVisible())) {
                console.log('   🔐 Passwort-Abfrage erkannt (gespeicherter Account)...');

                if (INSTAGRAM_PASSWORD) {
                    await passFieldOnly.fill(INSTAGRAM_PASSWORD);
                    await page.waitForTimeout(1000);

                    // Klicke "Anmelden" / "Log In"
                    const loginBtnSelectors = [
                        'button[type="submit"]',
                        'button:has-text("Anmelden")',
                        'button:has-text("Log In")',
                        'div[role="button"]:has-text("Anmelden")',
                        'div[role="button"]:has-text("Log In")',
                    ];

                    for (const sel of loginBtnSelectors) {
                        try {
                            const btn = page.locator(sel).first();
                            if (await btn.isVisible()) {
                                console.log(`   🖱️ Klicke Anmelden-Button (${sel})...`);
                                await btn.click({ force: true });
                                break;
                            }
                        } catch { }
                    }

                    await page.waitForTimeout(8000);
                    await dismissPopups(page);

                    if (!page.url().includes('login')) {
                        console.log('   ✅ Login via gespeichertes Konto + Passwort erfolgreich!');
                        return true;
                    }
                } else {
                    console.log('   ⚠️ INSTAGRAM_PASSWORD nicht in .env gesetzt!');
                }
            }

            if (!page.url().includes('login')) {
                console.log('   ✅ Login via gespeichertes Konto erfolgreich!');
                return true;
            }
            console.log('   ⚠️ Weiter-Klick hat nicht funktioniert, versuche Standard-Login...');
        }

        // FALL 2: Standard Login-Felder
        console.log('   ⏳ Warte auf Login-Felder...');
        const userField = page.locator('input[name="username"]');
        try {
            await userField.waitFor({ state: 'visible', timeout: 15000 });
        } catch (e) {
            console.log('   ⚠️ Login-Feld nicht erschienen (Timeout).');
        }

        if (await userField.isVisible()) {
            console.log(`   ⌨️ Tippe Username ${INSTAGRAM_USERNAME}...`);
            await userField.fill(INSTAGRAM_USERNAME || '');
            await page.waitForTimeout(1000);

            // Passwort eingeben
            const passField = page.locator('input[name="password"]');
            await passField.fill(INSTAGRAM_PASSWORD || '');
            await page.waitForTimeout(1000);

            // Login Button klicken (verschiedene Strategien)
            const loginSelectors = [
                'button[type="submit"]',
                'button:has-text("Log In")',
                'button:has-text("Anmelden")',
                'div[role="button"]:has-text("Log In")',
                'div[role="button"]:has-text("Anmelden")'
            ];

            let clicked = false;
            for (const sel of loginSelectors) {
                try {
                    const btn = page.locator(sel).first();
                    if (await btn.isVisible()) {
                        console.log(`   🖱️ Klicke Login-Button (${sel})...`);
                        await btn.click({ force: true, timeout: 5000 });
                        clicked = true;
                        break;
                    }
                } catch { }
            }

            if (!clicked) {
                console.log('   ⌨️ Kein Button gefunden, drücke Enter...');
                await page.keyboard.press('Enter');
            }

            // Warte auf Navigation oder spezifische Home-Elemente
            console.log('   ⏳ Warte auf Login-Abschluss...');
            await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { });
            await page.waitForTimeout(5000);
            await dismissPopups(page);

            // Prüfen ob wir drin sind
            const currentUrl = page.url();
            const hasNav = await page.$('nav').then(el => !!el);
            const hasSearch = await page.$('svg[aria-label="Suchen"], svg[aria-label="Search"]').then(el => !!el);

            if (currentUrl.includes('checkpoint') || currentUrl.includes('challenge')) {
                console.log('   🚨 SICHERHEITS-CHECK ERFORDERLICH! Bitte via VNC einloggen!');
                return false;
            }

            if (!currentUrl.includes('login') || hasNav || hasSearch) {
                console.log('   ✅ Login erfolgreich!');
                return true;
            }
        }

        const title = await page.title();
        const bodyContent = await page.evaluate("document.body ? document.body.innerText.substring(0, 200) : 'Kein Body'");
        console.log(`   ❌ Login fehlgeschlagen. Seite: "${title}" | Body: "${bodyContent}"`);
        const debugPic = path.join(DEBUG_DIR, `login-failed-${Date.now()}.png`);
        await page.screenshot({ path: debugPic });
        await pushDebugScreenshot(debugPic, `debug: login failed - ${title}`);
        return false;
    } catch (err: any) {
        console.log(`   ❌ Auto-Login Fehler: ${err.message}`);
        const debugPic = path.join(DEBUG_DIR, `login-error-${Date.now()}.png`);
        await page.screenshot({ path: debugPic });
        await pushDebugScreenshot(debugPic, `debug: login error - ${err.message?.substring(0, 50)}`);
        return false;
    }
}

async function checkForRateLimit(page: Page): Promise<boolean> {
    const rateLimitTexts = [
        "Versuche es später noch einmal",
        "Try again later",
        "Handlungen auf Instagram ein",
        "community zu schützen"
    ];

    try {
        const bodyText = await page.evaluate(() => document.body.innerText);
        for (const text of rateLimitTexts) {
            if (bodyText.includes(text)) {
                console.log(`\n🚨 RATE LIMIT ERKANNT! Message: "${text}"`);
                // Erstelle Lock-Datei für 2 Stunden Pause
                fs.writeFileSync(RATE_LIMIT_FILE, Date.now().toString());
                globalRateLimited = true;
                return true;
            }
        }
    } catch { }
    return false;
}

async function dismissPopups(page: Page): Promise<boolean> {
    // Vorab-Check auf Rate Limit (Text-basiert)
    const isBlocked = await checkForRateLimit(page);
    if (isBlocked) return true;

    const selectors = [
        // Cookie consent
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Accept All")',
        // "Not Now" buttons  
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        'button:has-text("Nicht jetzt")',
        // Save login info popup
        'button:has-text("Informationen speichern")',
        'button:has-text("Save Info")',
        'button:has-text("Informationen nicht speichern")',
        'button:has-text("Not now")',
        // Turn on notifications
        'button:has-text("Nicht aktivieren")',
        'button:has-text("Not Now")',
        'button:has-text("Jetzt nicht")',
        // Close buttons (X icons)
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'svg[aria-label="Schließen"]',
        'svg[aria-label="Close"]',
        // Cancel/Dismiss
        'button:has-text("Abbrechen")',
        'button:has-text("Cancel")',
        // RATE LIMIT POPUP - "Versuche es später noch einmal"
        'button:has-text("OK")',
        'button:has-text("Ok")',
        'button:has-text("Bestätigen")',
        // "View profile in app" popup - X button at top right
        'div[role="dialog"] button[type="button"]',
        'div[role="dialog"] svg[aria-label="Schließen"]',
        'div[role="dialog"] svg[aria-label="Close"]',
        // The X button specifically
        'button svg[aria-label="Schließen"]',
        'button svg[aria-label="Close"]',
        // Problem melden link (nicht klicken, aber OK daneben)
    ];

    // Vorab-Check auf Rate Limit
    await checkForRateLimit(page);

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                // Bei "OK" Buttons prüfen wir kurz den Kontext
                if (sel.includes('OK') || sel.includes('Ok')) {
                    const popupText = await page.evaluate((el: any) => {
                        const dialog = el.closest('[role="dialog"]');
                        return dialog ? dialog.innerText : 'Unbekannter Dialog';
                    }, btn);

                    if (popupText.includes('Versuche es später') || popupText.includes('Try again later')) {
                        console.log(`\n🚨 RATE LIMIT ERKANNT: Setze 2 Std. Pause und breche ab...`);
                        fs.writeFileSync(RATE_LIMIT_FILE, Date.now().toString());
                        globalRateLimited = true;
                        await btn.click({ force: true });
                        await page.waitForTimeout(500);
                        return true;
                    }
                    console.log(`      🔇 Info-Popup geschlossen: "${popupText.substring(0, 30)}..."`);
                } else {
                    console.log(`      🔇 Popup geschlossen: ${sel}`);
                }

                await btn.click({ force: true });
                await page.waitForTimeout(300);
            }
        } catch { }
    }

    // ESC drücken um Dialoge zu schließen
    try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape'); // Nochmal für hartnäckige Popups
        await page.waitForTimeout(200);
    } catch { }

    // Klicke außerhalb des Dialogs um ihn zu schließen
    try {
        const dialog = await page.$('div[role="dialog"]');
        if (dialog) {
            // Klicke auf den Hintergrund
            await page.mouse.click(10, 10);
            await page.waitForTimeout(300);
        }
    } catch { }
    return false;
}

/**
 * Macht einen Screenshot des Profils (Profil-Header mit Bild, Stats, Bio)
 */
async function takeProfileScreenshot(page: Page, username: string): Promise<string> {
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_${Date.now()}.png`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(4000); // Mehr Zeit für Bilder
        await dismissPopups(page);

        // Warte auf Profilbild als Indikator dass Seite geladen ist
        await page.waitForSelector('header img', { timeout: 5000 }).catch(() => { });

        // Screenshot des oberen Bereichs (Profilbild + Stats + Bio)
        await page.screenshot({
            path: screenshotPath,
            clip: { x: 0, y: 0, width: 390, height: 500 }
        });

        console.log(`      📸 Screenshot: ${screenshotPath}`);
        return screenshotPath;
    } catch (err: any) {
        console.log(`      ⚠️ Screenshot fehlgeschlagen: ${err.message}`);
        return '';
    }
}

/**
 * Holt vollständige Profilinformationen + Screenshot
 */
async function getProfileInfo(page: Page, username: string, takeScreenshot: boolean = false): Promise<ProfileInfo | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(4000);
        if (page.url().includes('login') || (await page.$('input[name="username"]'))) {
            console.log(`      ⚠️ Nicht eingeloggt (in getProfileInfo)! Starte Login...`);
            const loginOk = await performLogin(page);
            if (!loginOk) return null;

            // Nach Login: Navigiere erneut zum Profil
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(4000);
        }
        await dismissPopups(page);

        // Screenshot wenn gewünscht
        let screenshotPath = '';
        if (takeScreenshot && page && !page.isClosed()) {
            try {
                await page.waitForSelector('header img', { timeout: 5000 }).catch(() => { });
                screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_${Date.now()}.png`);
                await page.screenshot({
                    path: screenshotPath,
                    clip: { x: 0, y: 0, width: 390, height: 500 }
                });
            } catch (err: any) {
                console.log(`      ⚠️ Screenshot fehlgeschlagen (Browser ggf. zu): ${err.message}`);
            }
        }

        // Extrahiere Profilbild
        let profilePicUrl = '';
        try {
            const img = await page.$('header img');
            if (img) profilePicUrl = await img.getAttribute('src') || '';
        } catch { }

        // Extrahiere Full Name
        let fullName = username;
        try {
            fullName = await page.evaluate(() => {
                // Selektoren für den echten Namen (Fett gedruckt unter dem Bild oder im Header)
                // Auf Mobile oft ein <span> im h2 oder h1 Bereich
                const selectors = [
                    'h2',                     // Oft Name im Header
                    'header section span',    // Standard mobile
                    'header h1',              // Desktop/Tablet
                    'span[dir="auto"]'        // Bio/Name container
                ];

                for (const sel of selectors) {
                    const el = document.querySelector(sel) as HTMLElement;
                    if (el && el.innerText && el.innerText.length > 1 && !el.innerText.includes('\n')) {
                        return el.innerText.trim();
                    }
                }
                return '';
            }) || username;

            // Clean: Falls es "(username)" oder ähnliches enthält
            fullName = fullName.replace(/\s*\(@.*\).*$/, '').trim();
            if (fullName === '') fullName = username;
        } catch { }

        // Extrahiere Follower/Following
        let followerCount = '0';
        let followingCount = '0';
        let isVerified = false;

        try {
            isVerified = await page.$('[aria-label*="Verified"], svg[aria-label*="Verifiziert"]') !== null;

            const stats = await page.$$eval('a[href*="followers"], a[href*="following"]', function (links) {
                return links.map(function (l: any) { return { href: l.href, text: l.innerText.trim() }; });
            });

            for (const stat of stats) {
                if (stat.href.includes('followers')) followerCount = stat.text.split(' ')[0] || '0';
                if (stat.href.includes('following')) followingCount = stat.text.split(' ')[0] || '0';
            }
        } catch { }

        return {
            username,
            fullName,
            profilePicUrl,
            followerCount,
            followingCount,
            isVerified,
            screenshotPath
        };
    } catch (err: any) {
        console.log(`      ⚠️ Profil @${username} nicht ladbar: ${err.message}`);
        return null;
    }
}

/**
 * Holt die Following-Liste mit API-Interception für 100% Erfassung
 * Fängt Instagram's API-Responses ab während gescrollt wird
 * @param expectedCount - Die erwartete Anzahl an Following für dynamische Scroll-Berechnung
 */
async function getFollowingList(page: Page, username: string, expectedCount: number = 200): Promise<{ following: string[], picMap: Map<string, string> }> {
    try {
        // API-Response Sammler
        const apiFollowing = new Set<string>();
        const userPicMap = new Map<string, string>();

        // Intercepte Instagram API-Responses
        const responseHandler = async (response: any) => {
            const url = response.url();

            // Instagram Following API
            if (url.includes('/api/v1/friendships/') || (url.includes('/api/') && url.includes('/following/'))) {
                try {
                    const json = await response.json();
                    if (json.users) {
                        for (const user of json.users) {
                            if (user.username) {
                                apiFollowing.add(user.username);
                                if (user.profile_pic_url) userPicMap.set(user.username, user.profile_pic_url);
                            }
                        }
                    }
                } catch { }
            }

            // GraphQL Following
            if (url.includes('graphql') && url.includes('following')) {
                try {
                    const json = await response.json();
                    const edges = json?.data?.user?.edge_follow?.edges ||
                        json?.data?.user?.following?.edges || [];
                    for (const edge of edges) {
                        const u = edge?.node?.username;
                        if (u) apiFollowing.add(u);
                    }
                } catch { }
            }
        };

        page.on('response', responseHandler);

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'networkidle',  // Warte bis Netzwerk komplett ruhig ist
            timeout: 60000
        });
        await page.waitForTimeout(5000);  // Extra warten
        await dismissPopups(page);
        await page.waitForTimeout(2000);  // Nochmal warten nach Popup-Handling
        await dismissPopups(page);  // Nochmal Popups schließen

        // Screenshot vor dem Klick für Debugging
        await page.screenshot({ path: `${DEBUG_DIR}/before-following-click-${username}.png` });

        // DEBUG: Was ist auf der Seite?
        const pageDebug: any = await page.evaluate(`(function() {
            const links = document.querySelectorAll('a');
            const foundLinks = [];
            for (let i = 0; i < links.length; i++) {
                const a = links[i];
                const text = a.innerText.toLowerCase();
                if (a.href.includes('following') || text.includes('following') || text.includes('gefolgt')) {
                    foundLinks.push({ href: a.href, text: a.innerText.substring(0, 50) });
                }
            }
            return {
                linksCount: links.length,
                links: foundLinks,
                bodyTextPreview: document.body ? document.body.innerText.substring(0, 500) : '',
                hasDialog: !!document.querySelector('[role=\"dialog\"]'),
                url: window.location.href
            };
        })()`);

        console.log(`   🔍 DEBUG: ${pageDebug.linksCount} Links auf der Seite`);
        console.log(`   🔍 Following-Links gefunden: ${pageDebug.links.length}`);
        if (pageDebug.links.length > 0) {
            console.log(`   🔗 Links:`, pageDebug.links);
        }
        console.log(`   📄 URL: ${pageDebug.url}`);
        console.log(`   💬 Dialog offen: ${pageDebug.hasDialog}`);
        console.log(`   📝 Body Preview: ${pageDebug.bodyTextPreview.substring(0, 100)}...`);

        // Versuche verschiedene Selektoren für den Following-Link
        const followingSelectors = [
            `a[href="/${username}/following/"]`,  // Exakter Pfad
            `a[href*="/following"]`,              // Enthält /following
            'a[href*="following"]',               // Enthält following
            'li:nth-child(3) a',                  // Drittes Element in Stats (Posts, Followers, Following)
            'header ul li:nth-child(3) a',        // Im Header
            'section ul li:nth-child(3) a',       // In Section
        ];

        let clickedFollowing = false;
        for (const selector of followingSelectors) {
            try {
                const followingLink = await page.$(selector);
                if (followingLink) {
                    const text = await followingLink.innerText().catch(() => '');
                    // Prüfe ob es wirklich der Following-Link ist
                    if (text.toLowerCase().includes('following') ||
                        text.toLowerCase().includes('gefolgt') ||
                        text.toLowerCase().includes('abonniert') ||
                        text.match(/\d+/)) {
                        console.log(`   ✅ Following-Link gefunden mit: ${selector}`);
                        await followingLink.click({ timeout: 5000 });
                        clickedFollowing = true;
                        break;
                    }
                }
            } catch (e) {
                // Weiter zum nächsten Selektor
            }
        }

        if (page.url().includes('login') || (await page.$('input[name="username"]'))) {
            console.log(`   ⚠️ Login-Seite erkannt vor JS-Klick! Starte Login...`);
            await performLogin(page);
            // Nach Login: Navigiere erneut zum Profil
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(4000);
        }

        if (!clickedFollowing) {
            // Letzter Versuch: Via JavaScript klicken
            console.log('   ⚠️ Versuche JavaScript-Klick auf Following...');
            clickedFollowing = await page.evaluate(`(function(un) {
                const links = document.querySelectorAll('a');
                for (let i = 0; i < links.length; i++) {
                    const l = links[i];
                    if (l.href.includes('login')) return 'LOGIN_REQUIRED'; // Erkennung im Browser-Kontext
                    if (l.href.includes('following') || l.href.includes('/following')) {
                        l.click();
                        return true;
                    }
                }
                for (let i = 0; i < links.length; i++) {
                    const l = links[i];
                    const t = l.innerText.toLowerCase();
                    if (t.includes('gefolgt') || t.includes('following')) {
                        l.click();
                        return true;
                    }
                }
                return false;
            })("${username}")`);
        }

        if (!clickedFollowing) {
            console.log('   ❌ Following-Link nicht gefunden');
            const screenshotPath = `${DEBUG_DIR}/no-following-link-${username}.png`;
            await page.screenshot({ path: screenshotPath });
            await pushDebugScreenshot(screenshotPath, `debug: no following link - @${username}`);
            return { following: [], picMap: new Map() };
        }

        await page.waitForTimeout(3000);

        // 🔍 Prüfe ob Dialog geöffnet oder zur Following-Seite navigiert
        const currentUrl = page.url();
        const hasDialog = await page.$('[role="dialog"]');

        console.log(`   📍 URL nach Klick: ${currentUrl}`);
        console.log(`   💬 Dialog gefunden: ${!!hasDialog}`);

        // Falls kein Dialog und nicht auf Following-Seite → Direkt navigieren
        if (!hasDialog && !currentUrl.includes('/following')) {
            console.log('   ⚠️ Weder Dialog noch Following-Seite - navigiere direkt...');
            await page.goto(`https://www.instagram.com/${username}/following/`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            await page.waitForTimeout(3000);
            console.log(`   📍 Neue URL: ${page.url()}`);
        }

        // NICHT dismissPopups aufrufen, da dies das Following-Fenster schließt!

        // DEBUG: Screenshot nach Dialog-Öffnung
        await page.screenshot({ path: `${DEBUG_DIR}/dialog-${username}.png` });
        console.log(`   📸 Debug Screenshot: debug-dialog-${username}.png`);

        // ⏳ WARTE BIS DIE DATEN WIRKLICH GELADEN SIND (keine Skeleton mehr)
        console.log(`   ⏳ Warte auf Laden der Following-Liste...`);
        let dataLoaded = false;
        for (let waitAttempt = 0; waitAttempt < 15; waitAttempt++) {
            const checkResult: any = await page.evaluate(`(function() {
                let container = document.querySelector('[role="dialog"]');
                let containerType = 'dialog';

                if (!container) {
                    container = document.body;
                    containerType = 'body';
                }

                const links = container.querySelectorAll('a[href]');
                let realUserCount = 0;
                const foundUsers = [];

                for (let i = 0; i < links.length; i++) {
                    const a = links[i];
                    const href = a.getAttribute('href');
                    if (href && href.match(/^\\/[a-zA-Z0-9._]+\\/?$/) &&
                        !href.includes('/following') &&
                        !href.includes('/followers') &&
                        !href.includes('/explore') &&
                        !href.includes('/reels')) {
                        const uname = href.replace(/\\//g, '');
                        if (uname.length >= 2 && uname.length <= 30) {
                            realUserCount++;
                            if (foundUsers.length < 5) foundUsers.push(uname);
                        }
                    }
                }

                return {
                    containerType,
                    realUserCount,
                    foundUsers,
                    hasDialog: !!document.querySelector('[role="dialog"]')
                };
            })()`);

            console.log(`   🔍 Check ${waitAttempt + 1}: container=${checkResult.containerType}, users=${checkResult.realUserCount}, hasDialog=${checkResult.hasDialog}`);
            if (checkResult.foundUsers.length > 0) {
                console.log(`   📋 Gefunden: ${checkResult.foundUsers.join(', ')}...`);
            }

            if (checkResult.realUserCount >= 3) {
                console.log(`   ✅ Following-Liste geladen (Versuch ${waitAttempt + 1})`);
                dataLoaded = true;
                break;
            }
            await page.waitForTimeout(1000);
            console.log(`   ⏳ Warte auf Daten... (${waitAttempt + 1}/15)`);
        }

        if (!dataLoaded) {
            console.log(`   ⚠️ Following-Liste lädt sehr langsam - versuche trotzdem...`);
            const slowLoadPath = `${DEBUG_DIR}/slow-load-${username}.png`;
            await page.screenshot({ path: slowLoadPath });
            await pushDebugScreenshot(slowLoadPath, `debug: slow loading - @${username}`);
        }

        let noNewCount = 0;

        // Dynamische Scroll-Anzahl: ~10 Accounts pro Scroll sichtbar
        // Bei 500 Following = 60 Scrolls, bei 1000 Following = 120 Scrolls
        const maxScrolls = Math.max(80, Math.ceil(expectedCount / 8) + 20);
        const maxNoNewCount = 15; // Nach 15 Scrolls ohne neue Daten aufhören (erhöht für langsame APIs)

        console.log(`   📜 Max Scrolls: ${maxScrolls} (für ${expectedCount} Following)`);

        // Versuche verschiedene Selektoren für den scrollbaren Container
        let scrollContainer = await page.$('div[role="dialog"] div[style*="overflow"]');
        if (!scrollContainer) {
            scrollContainer = await page.$('[role="dialog"] div[class*="x1n2onr6"]');
        }

        console.log(`   📦 Scroll-Container gefunden: ${!!scrollContainer}`);

        // NUR API INTERCEPTION - DOM SCRAPING ENTFERNT (war unzuverlässig)
        for (let scroll = 0; scroll < maxScrolls && noNewCount < maxNoNewCount; scroll++) {

            const prevSize = apiFollowing.size;

            // Logge Status alle 5 Scrolls
            if (scroll % 5 === 0) {
                console.log(`   Scroll ${scroll + 1}/${maxScrolls}: API=${apiFollowing.size}`);
            }

            // SCROLLING
            try {
                // Strategie 1: JS-Scroll im Dialog
                await page.evaluate(`(function() {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (!dialog) return;
                    const divs = dialog.querySelectorAll('div');
                    for (let i = 0; i < divs.length; i++) {
                        const el = divs[i];
                        if (el.scrollHeight > el.clientHeight + 10) {
                            el.scrollTop += 600;
                            return;
                        }
                    }
                })()`);

                await page.waitForTimeout(300);

                // Strategie 2: Mouse wheel
                const dialogBox = await page.$('[role="dialog"]');
                if (dialogBox) {
                    const box = await dialogBox.boundingBox();
                    if (box) {
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        await page.mouse.wheel(0, 400);
                    }
                }

                // Strategie 3: Keyboard
                await page.keyboard.press('PageDown');

            } catch (scrollErr: any) {
                await page.mouse.wheel(0, 600);
            }

            await dismissPopups(page);
            // Wir brechen nicht mehr sofort ab, sondern lassen die "noNewCount" Logik entscheiden ob es noch weitergeht

            // 🎯 EARLY EXIT: Wenn wir alle Accounts haben, aufhören!
            if (apiFollowing.size >= expectedCount && expectedCount > 0) {
                console.log(`   🎯 ZIEL ERREICHT: ${apiFollowing.size}/${expectedCount} Accounts gescrapt. Beende Scrolling.`);
                break;
            }

            await humanDelay(3500, 5500); // Mehr Zeit für API-Response

            // Check ob neue API-Daten kamen
            if (apiFollowing.size === prevSize) {
                noNewCount++;
                if (noNewCount >= 3 && scroll % 3 === 0) {
                    console.log(`   ⏳ Keine neuen Daten seit ${noNewCount} Scrolls (API=${apiFollowing.size})...`);
                }
            } else {
                noNewCount = 0;
            }

            // 🚨 MOBILE LOGIN-CHECK WÄHREND DES SCROLLENS
            // Falls Session plötzlich abläuft
            if (page.url().includes('login') && scroll % 5 === 0) {
                console.log(`   ⚠️ Session verloren während Scraping! Versuche Re-Login...`);
                await performLogin(page);
            }
        }

        // Response Handler entfernen
        page.off('response', responseHandler);

        console.log(`   ✅ Scraping beendet: API=${apiFollowing.size} Accounts`);

        // Dialog schließen
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        return {
            following: Array.from(apiFollowing),
            picMap: userPicMap
        };
    } catch (err: any) {
        console.log(`   ❌ Scrape-Fehler: ${err.message}`);
        await page.screenshot({ path: `${DEBUG_DIR}/scrape-critical-error-${username}.png` });
        console.log(`   📸 Screenshot vom Fehler gespeichert: debug-scrape-critical-error-${username}.png`);
        return { following: [], picMap: new Map() };
    }
}

/**
 * Quick-Check: Nur Following-Zahl abrufen (mit mehreren Fallback-Methoden)
 */
async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    try {
        console.log(`      🔍 Suche @${username}...`);

        // 📱 MOBILE LOGIN-CHECK (iPhone 13)
        // Prüfe URL und UI-Elemente
        const isLoginPage = page.url().includes('login') || page.url().includes('accounts/login');
        const hasLoginButton = (await page.$('a[href*="/accounts/login/"]')) !== null || (await page.$('button:has-text("Log In")')) !== null;

        if (isLoginPage || hasLoginButton) {
            console.log(`      ⚠️ Nicht eingeloggt (Mobile UI) - Starte aggressiven Login-Fix...`);

            // Erst Cookies probieren
            if (process.env.INSTAGRAM_SESSION_ID) {
                console.log('      🔄 Versuche Auto-Login via .env Cookies...');
                await page.context().addCookies([
                    { name: 'sessionid', value: process.env.INSTAGRAM_SESSION_ID, domain: '.instagram.com', path: '/', secure: true, httpOnly: true }
                ]);
                await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
                await dismissPopups(page);
            }

            // Dann Auto-Login mit User/Pass wenn immer noch Login-Seite
            if (page.url().includes('login') || (await page.$('input[name="username"]'))) {
                console.log('      ⚠️ Cookies reichen nicht. Versuche Auto-Login mit Passwort...');
                const loginOk = await performLogin(page);
                if (!loginOk) return null; // Abbruch
            }
            await dismissPopups(page);
        }

        // 🧑 MENSCHLICHES VERHALTEN: Über Suche zum Profil navigieren
        const useSearch = Math.random() > 0.3; // 70% via Suche, 30% direkt (Mix ist natürlicher)

        if (useSearch) {
            try {
                // Klicke auf Suche-Icon
                const searchIcon = await page.$('svg[aria-label="Suchen"]') || await page.$('svg[aria-label="Search"]');
                if (searchIcon) {
                    await searchIcon.click();
                    await page.waitForTimeout(1000);

                    // Username eintippen (menschliche Geschwindigkeit)
                    const searchInput = await page.$('input[placeholder*="Suchen"]') || await page.$('input[placeholder*="Search"]');
                    if (searchInput) {
                        await searchInput.click();
                        await page.waitForTimeout(500);

                        // Tippe langsam
                        for (const char of username) {
                            await searchInput.type(char, { delay: 50 + Math.random() * 100 });
                        }
                        await page.waitForTimeout(1500); // Warte auf Suchergebnisse

                        // Klicke auf erstes Ergebnis
                        const firstResult = await page.$(`a[href="/${username}/"]`);
                        if (firstResult) {
                            await firstResult.click();
                            await page.waitForTimeout(2000);
                            console.log(`      ✅ Via Suche gefunden`);
                        } else {
                            // Fallback: Direkte Navigation
                            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        }
                    } else {
                        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    }
                } else {
                    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                }
            } catch {
                // Bei Fehler: Direkte Navigation
                await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
            }
        } else {
            // Manchmal direkt navigieren (auch natürlich, z.B. aus Lesezeichen)
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        }

        // Warte auf Content - prüfe Instagram-spezifische Elemente statt nur Body-Länge
        let pageReady = false;
        let bodyLen = 0;
        for (let i = 0; i < 5; i++) {
            // Check 0: Login detection
            if (page.url().includes('login') || (await page.$('input[name="username"]'))) {
                console.log(`      ⚠️ Login-Seite erkannt während Lade-Wait (${i + 1}/5)!`);
                const loginOk = await performLogin(page);
                if (loginOk) {
                    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
                    continue;
                }
            }

            // Check 1: Body text length
            bodyLen = await page.evaluate("document.body ? document.body.innerText.length : 0");

            // Check 2: Instagram-spezifische Elemente
            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            const hasHeader = await page.$('header').then(el => !!el).catch(() => false);
            const hasAvatar = await page.$('img[alt*="Profilbild"], img[alt*="profile picture"]').then(el => !!el).catch(() => false);

            if (bodyLen > 150 || hasFollowingLink || (hasHeader && hasAvatar)) {
                pageReady = true;
                break;
            }

            console.log(`      ⏳ Warte auf Content (${i + 1}/5)... [bodyLen=${bodyLen}] [URL=${page.url().substring(0, 40)}...]`);
            await page.waitForTimeout(2000);
            await dismissPopups(page);
        }

        console.log(`      📄 Body text length: ${bodyLen}, pageReady: ${pageReady}`);

        if (!pageReady) {
            console.log(`      ⚠️ Seite nicht bereit - mache Debug-Screenshot und versuche Reload...`);
            const debugPic = path.join(DEBUG_DIR, `not-ready-${username}-${Date.now()}.png`);
            await page.screenshot({ path: debugPic });

            await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(5000);
            await dismissPopups(page);

            // Nochmal checken
            if (page.url().includes('login')) {
                console.log('      ⚠️ Redirect zu Login nach Reload erkannt!');
                await performLogin(page);
                await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
            }

            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            bodyLen = await page.evaluate("document.body ? document.body.innerText.length : 0");
            pageReady = bodyLen > 150 || hasFollowingLink;
        }

        // Letzter Versuch: Direkte Navigation falls Suche fehlgeschlagen
        if (!pageReady) {
            console.log(`      🔄 Letzter Versuch mit direkter URL...`);
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(3000);
            await dismissPopups(page);

            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            bodyLen = await page.evaluate("document.body ? document.body.innerText.length : 0");
            pageReady = bodyLen > 150 || hasFollowingLink;
            console.log(`      📄 Nach direkter URL: bodyLen=${bodyLen}, hasFollowing=${hasFollowingLink}`);
        }

        if (!pageReady) {
            // Detailliertes Incident erstellen
            const timestamp = Date.now();
            const debugPath = path.join(process.cwd(), '.incidents', `empty-page-${username}-${timestamp}.png`);
            await page.screenshot({ path: debugPath, fullPage: true });

            // Zusätzliche Debug-Infos
            const pageUrl = page.url();
            const pageTitle = await page.title().catch(() => 'unknown');
            console.log(`      📸 Empty page debug: ${debugPath}`);
            console.log(`      🔍 URL: ${pageUrl}`);
            console.log(`      🔍 Title: ${pageTitle}`);
            console.log(`      🔍 Body length: ${bodyLen}`);
            return null;
        }

        // Methode 1: Link mit "following" im href
        const followingLink = await page.$('a[href*="following"]');
        if (followingLink) {
            const text = await followingLink.innerText();
            const match = text.match(/[\d,.]+/);
            if (match) {
                const count = parseInt(match[0].replace(/[,.]/g, ''));
                console.log(`      [M1] Following via Link: ${count}`);
                return count;
            }
        }

        // Methode 2: Meta Description
        const metaDesc = await page.$eval('meta[name="description"]', (el: any) => el.content).catch(() => '');
        if (metaDesc) {
            // Pattern: "123 Following" oder "123 Gefolgt" oder "123 abonniert"
            const match = metaDesc.match(/([\d,\.]+)\s*(Following|Gefolgt|abonniert)/i);
            if (match) {
                let numStr = match[1].replace(/[,\.]/g, '');
                const count = parseInt(numStr);
                console.log(`      [M2] Following via Meta: ${count}`);
                return count;
            }
        }

        // Methode 3: Suche im Header nach Stats
        const stats = await page.$$eval('header section ul li, header ul li', (lis: any[]) => {
            return lis.map(li => li.innerText.trim());
        });

        for (const stat of stats) {
            if (stat.toLowerCase().includes('following') || stat.toLowerCase().includes('abonniert') || stat.toLowerCase().includes('gefolgt')) {
                const match = stat.match(/[\d,.]+/);
                if (match) {
                    const count = parseInt(match[0].replace(/[,.]/g, ''));
                    console.log(`      [M3] Following via Stats: ${count}`);
                    return count;
                }
            }
        }

        // Methode 4: Alle Links durchsuchen
        const allLinks = await page.$$eval('a', (links: any[]) => {
            return links.map(l => ({ href: l.href, text: l.innerText.trim() }));
        });

        for (const link of allLinks) {
            if (link.href.includes('/following')) {
                const match = link.text.match(/[\d,.]+/);
                if (match) {
                    const count = parseInt(match[0].replace(/[,.]/g, ''));
                    console.log(`      [M4] Following via All Links: ${count}`);
                    return count;
                }
            }
        }

        // Methode 5: Suche im ganzen Seitentext nach "X Gefolgt" oder "X Following"
        const pageText: any = await page.evaluate("document.body ? document.body.innerText : ''");
        // Pattern: "78 Gefolgt" oder "78 Following" oder "123 abonniert"
        const textMatches = pageText.match(/(\d+[\d,.]*)\s*(Gefolgt|Following|abonniert)/gi);
        if (textMatches && textMatches.length > 0) {
            for (const m of textMatches) {
                const numMatch = m.match(/[\d,.]+/);
                if (numMatch) {
                    const count = parseInt(numMatch[0].replace(/[,.]/g, ''));
                    console.log(`      [M5] Following via Page Text: ${count} (found: "${m}")`);
                    return count;
                }
            }
        }

        // Methode 6: Suche nach Header-Text mit Follower/Following
        const headerText = await page.$eval('header', (h: any) => h.innerText).catch(() => '');
        if (headerText) {
            // Pattern: "44,1 Mio. Follower • 78 Gefolgt"
            const followingMatch = headerText.match(/(\d+[\d,.\s]*(?:Mio\.?|K|M)?)\s*(Gefolgt|Following)/i);
            if (followingMatch) {
                let numStr = followingMatch[1].replace(/[,.\s]/g, '');
                // Handle "Mio" = Millionen
                if (followingMatch[1].toLowerCase().includes('mio')) {
                    numStr = numStr.replace(/mio/i, '');
                    const num = parseFloat(numStr) * 1000000;
                    console.log(`      [M6] Following via Header: ${num}`);
                    return Math.round(num);
                }
                // Handle K = Tausend
                if (followingMatch[1].toLowerCase().includes('k')) {
                    numStr = numStr.replace(/k/i, '');
                    const num = parseFloat(numStr) * 1000;
                    console.log(`      [M6] Following via Header: ${num}`);
                    return Math.round(num);
                }
                const count = parseInt(numStr);
                console.log(`      [M6] Following via Header: ${count}`);
                return count;
            }
        }

        // DEBUG: Auto-Screenshot bei Fehler
        console.log(`      ⚠️ Keine Methode hat funktioniert - mache Debug-Screenshot...`);
        const debugPath = path.join(process.cwd(), '.incidents', `debug-${username}-${Date.now()}.png`);
        try {
            await page.screenshot({ path: debugPath });
            console.log(`      📸 Debug: ${debugPath}`);
            // Auto-push to git
            const { exec } = await import('child_process');
            exec(`cd ${process.cwd()} && git add .incidents/ && git commit -m "debug: ${username} profile issue" && git push origin main`,
                (err) => { if (!err) console.log('      📤 Debug gepusht'); });
        } catch { }

        return null;
    } catch (err: any) {
        console.log(`      ❌ getFollowingCount Error: ${err.message}`);
        return null;
    }
}

/**
 * 🐦 Twitter-Post via Playwright (ohne API!)
 * Startet separaten Browser mit headless: false um Passcode-Dialog zu vermeiden
 */
async function postToTwitter(
    _browser: Browser, // Wird nicht mehr verwendet, starten eigenen Browser
    text: string,
    imagePath?: string
): Promise<string | null> {
    if (!TWITTER_USERNAME) {
        console.log('   ⚠️ TWITTER_USERNAME fehlt');
        return null;
    }

    console.log('\n   🐦 Poste auf Twitter (via Firefox Persistent Profile)...');

    const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');

    // Launch Firefox mit persistentem Profil
    const context = await firefox.launchPersistentContext(TWITTER_PROFILE_DIR, {
        headless: true, // Für echten Betrieb headless: true
        viewport: { width: 1024, height: 600 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = context.pages()[0] || await context.newPage();

    try {
        // Prüfe ob eingeloggt
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Check: Sind wir auf der Login-Seite gelandet?
        if (page.url().includes('login') || page.url().includes('flow')) {
            console.log('   ❌ Twitter Session abgelaufen oder nicht eingeloggt!');
            console.log('   ➡️ Führe aus: DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts');
            const twitterLoginPath = `${DEBUG_DIR}/twitter-session-expired-${Date.now()}.png`;
            await page.screenshot({ path: twitterLoginPath });
            await pushDebugScreenshot(twitterLoginPath, 'debug: twitter session expired');
            await context.close();
            return null;
        }

        console.log('   ✅ Twitter eingeloggt');

        // Zum Compose-Bereich
        await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Text eingeben - Twitter nutzt contenteditable, daher click + type
        const tweetBox = page.locator('[data-testid="tweetTextarea_0"]').first();
        await tweetBox.waitFor({ timeout: 10000 });
        await tweetBox.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(1000);

        // Bild hochladen wenn vorhanden
        if (imagePath && fs.existsSync(imagePath)) {
            console.log('   📂 Lade Bild hoch...');
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(5000); // Mehr Zeit für Upload
        }

        // Tweet absenden via Shortcut (zuverlässiger)
        console.log('   📤 Sende Tweet (Shortcut)...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(6000);

        // Tweet-URL extrahieren (von der Timeline)
        console.log('   🔍 Suche Tweet-URL...');
        await page.goto(`https://x.com/${TWITTER_USERNAME}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const tweetLink = page.locator('article a[href*="/status/"]').first();
        let tweetUrl = '';
        try {
            const href = await tweetLink.getAttribute('href');
            if (href) tweetUrl = `https://x.com${href}`;
        } catch (e) {
            console.log('   ⚠️ Konnte Tweet-URL nicht direkt finden');
        }

        console.log(`   ✅ Tweet gepostet! ${tweetUrl || '(URL unbekannt)'}`);

        await context.close();
        return tweetUrl || 'https://x.com';
    } catch (err: any) {
        console.log(`   ❌ Twitter Fehler: ${err.message}`);
        // 📸 Screenshot vom Fehler
        try {
            const twitterErrorPath = `${DEBUG_DIR}/twitter-post-error-${Date.now()}.png`;
            await page.screenshot({ path: twitterErrorPath });
            await pushDebugScreenshot(twitterErrorPath, `debug: twitter post error - ${err.message?.substring(0, 30)}`);
        } catch { }
        await context.close().catch(() => { });
        return null;
    }
}

/**
 * Webhook senden
 */
async function sendWebhook(payload: WebhookPayload) {
    if (!N8N_WEBHOOK_URL) return;

    try {
        console.log('   📤 Sende Webhook...');
        await axios.post(N8N_WEBHOOK_URL, payload);
        console.log('   ✅ Webhook gesendet!');
    } catch (err: any) {
        console.log(`   ⚠️ Webhook Fehler: ${err.message}`);
    }
}

/**
 * Formatiert den Tweet-Text bilingual (DE/EN) mit Emojis
 * Zeigt max 5 Accounts um Tweet-Länge zu respektieren
 */
function formatTweetText(event: 'FOLLOW' | 'UNFOLLOW', profile: ProfileInfo, targets: ProfileInfo[]): string {
    const isFollow = event === 'FOLLOW';
    const emoji = isFollow ? '✅' : '👀';
    const actionEmoji = isFollow ? '➕' : '❌';
    const count = targets.length;
    const personDE = count === 1 ? 'Person' : 'Personen';
    const personEN = count === 1 ? 'person' : 'people';

    // Erste Zeile: Deutsch
    const actionDE = isFollow ? `folgt ${count} neuen ${personDE}` : `entfolgte ${count} ${personDE}`;
    let text = `${emoji} @${profile.username} ${actionDE}:`;

    // Zweite Zeile: Englisch
    const actionEN = isFollow ? `now follows ${count} ${personEN}` : `unfollowed ${count} ${personEN}`;
    text += `\n${emoji} @${profile.username} ${actionEN}:`;

    text += '\n\n';

    // Max 5 Targets anzeigen um Tweet-Länge zu respektieren
    const displayCount = Math.min(targets.length, 5);
    for (let i = 0; i < displayCount; i++) {
        const target = targets[i];
        text += `${actionEmoji} @${target.username}\n`;
        text += `🔗 instagram.com/${target.username}\n`;
        if (i < displayCount - 1) text += '\n';
    }

    if (targets.length > 5) {
        text += `\n... und ${targets.length - 5} weitere / ... and ${targets.length - 5} more`;
    }

    text += '\n\n#Instagram #FollowerWatch #Bundesliga';

    return text.trim();
}


/**
 * Pushes all screenshots and debug logs to Git
 */
async function pushProgressToGit(username: string) {
    try {
        const { execSync } = await import('child_process');
        console.log(`   📤 Push progress für @${username}...`);

        // 1. Config setzen
        execSync(`git config user.email "bot@tareno.ai" && git config user.name "InstaBot"`, { stdio: 'ignore' });

        // 2. Einzelne Verzeichnisse hinzufügen (nur wenn sie existieren)
        const dirs = ['public/screenshots', 'public/debug', '.incidents'];
        for (const dir of dirs) {
            if (fs.existsSync(path.join(process.cwd(), dir))) {
                execSync(`git add ${dir}/`, { stdio: 'ignore' });
            }
        }

        // 3. Nur committen wenn Änderungen vorhanden sind
        const status = execSync('git status --porcelain').toString();
        if (status.trim().length > 0) {
            execSync(`git add -A`, { stdio: 'ignore' });
            execSync(`git commit -m "auto: progress update @${username}"`, { stdio: 'ignore' });
            console.log(`   🔄 Git Pull & Push...`);
            execSync(`git pull --rebase origin main && git push origin main`, { stdio: 'ignore' });
            console.log(`   ✅ Gepusht!`);
        } else {
            console.log(`   ℹ️ Keine neuen Bilder zum Pushen.`);
        }
    } catch (err: any) {
        console.log(`   ⚠️ Git-Push fehlgeschlagen: ${err.message}`);
    }
}

// === MAIN ===
/**
 * 🐦 Prüft den Twitter Login-Status für alle Accounts in der DB
 */
async function updateTwitterStatusInDb(db: any) {
    console.log('\n🐦 Prüfe X/Twitter Login-Status für Datenbank...');

    // Hole alle Twitter Accounts
    const accounts = await db.execute("SELECT id, username FROM TwitterAccount");

    if (accounts.rows.length === 0) return;

    // Wir brauchen nur EINE Session um zu prüfen ob die globale Session (Firefox Profile) noch geht
    const result = await getTwitterContext(true);

    let isLoggedIn = false;
    if (result.success && result.page) {
        isLoggedIn = await checkTwitterSession(result.page);
        await closeTwitterContext(result.context!);
    }

    console.log(`   📊 Status: ${isLoggedIn ? '✅ Eingeloggt' : '❌ Login erforderlich'}`);

    for (const row of accounts.rows) {
        await db.execute({
            sql: "UPDATE TwitterAccount SET lastLoginStatus = ?, lastStatusCheckAt = datetime('now') WHERE id = ?",
            args: [isLoggedIn ? 1 : 0, row.id]
        });
        console.log(`   💾 DB aktualisiert für @${row.username}`);
    }
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING v4 - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');

    // 🕒 1. RATE LIMIT COOLDOWN CHECK (2 Stunden)
    if (fs.existsSync(RATE_LIMIT_FILE)) {
        try {
            const stats = fs.statSync(RATE_LIMIT_FILE);
            const mtime = stats.mtimeMs;
            const now = Date.now();
            const diffHours = (now - mtime) / (1000 * 60 * 60);

            if (diffHours < 1.5) {
                const remaining = (1.5 - diffHours).toFixed(1);
                console.log(`\n⏳ PAUSE AKTIV: Instagram blockiert uns noch (${remaining} Std. verbleibend).`);
                console.log(`🚀 Wir warten bis die Sperre abläuft um den Account zu schützen.\n`);
                return;
            } else {
                console.log('✅ Cooldown abgelaufen. Lösche Sperre...');
                fs.unlinkSync(RATE_LIMIT_FILE);
            }
        } catch (e) {
            console.log('⚠️ Fehler beim Cooldown-Check:', e);
        }
    }

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Stelle sicher dass MonitoringLog-Tabelle existiert
    await ensureMonitoringLogTable(db);

    // Stelle sicher dass MonitoringLog-Tabelle existiert
    await ensureMonitoringLogTable(db);

    // Nutze PERSISTENT CONTEXT für langlebige Sessions
    // Speichert alles: Cookies, LocalStorage, IndexedDB, Cache, etc.
    const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/instagram');

    // Erstelle Profil-Ordner wenn nicht vorhanden
    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    console.log('🌐 Starte Browser mit persistentem Profil...');

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    let createdLock = false;
    const targetUsername = process.argv[2];

    try {
        // Login Check für Instagram (einmalig mit temporärer Page)
        const checkPage = await context.newPage();
        console.log('🌐 Prüfe Instagram Login...');
        try {
            await checkPage.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
            await checkPage.waitForTimeout(3000);
            await dismissPopups(checkPage);

            if (checkPage.url().includes('login')) {
                console.log('⚠️ Nicht eingeloggt! Versuche Session aus .env wiederherzustellen...');

                const cookies = [];
                if (process.env.INSTAGRAM_SESSION_ID) {
                    cookies.push({
                        name: 'sessionid',
                        value: process.env.INSTAGRAM_SESSION_ID,
                        domain: '.instagram.com',
                        path: '/',
                        secure: true,
                        httpOnly: true
                    });
                }
                if (process.env.INSTAGRAM_CSRF_TOKEN) {
                    cookies.push({
                        name: 'csrftoken',
                        value: process.env.INSTAGRAM_CSRF_TOKEN,
                        domain: '.instagram.com',
                        path: '/',
                        secure: true
                    });
                }
                if (process.env.INSTAGRAM_DS_USER_ID) {
                    cookies.push({
                        name: 'ds_user_id',
                        value: process.env.INSTAGRAM_DS_USER_ID,
                        domain: '.instagram.com',
                        path: '/',
                        secure: true
                    });
                }

                if (cookies.length > 0) {
                    await context.addCookies(cookies);
                    console.log(`   🍪 ${cookies.length} Cookies injiziert. Lade neu...`);
                    await checkPage.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
                    await checkPage.waitForTimeout(3000);
                    await dismissPopups(checkPage);
                }

                if (checkPage.url().includes('login')) {
                    console.log('⚠️ Cookies allein reichen nicht. Starte Auto-Login mit User/Pass...');
                    const loginSuccess = await performLogin(checkPage);
                    if (!loginSuccess) {
                        console.log('❌ Auto-Login fehlgeschlagen! Bitte Session via VNC erneuern.');
                        await checkPage.close();
                        await context.close();
                        return;
                    }
                } else {
                    console.log('✅ Session erfolgreich via .env wiederhergestellt!');
                }
            }
        } finally {
            await checkPage.close();
        }

        let query = `
            SELECT DISTINCT mp.id, mp.username, mp.followingCount, mp.isBaselineComplete, mp.screenshotUrl 
            FROM MonitoredProfile mp
            LEFT JOIN _MonitoredProfileToProfileSet pts ON mp.id = pts.A
            LEFT JOIN ProfileSet ps ON pts.B = ps.id
            WHERE 1=1
        `;
        let args: any[] = [];

        if (targetUsername) {
            console.log(`🎯 Modus: Einzel-Profil Check (@${targetUsername}) - Ignoriere Set-Status`);
            query += " AND mp.username = ?";
            args.push(targetUsername);
        } else {
            // Im Automatik-Modus: Nur aktive Sets!
            query += " AND ps.isActive = 1";
            query += " ORDER BY lastCheckedAt ASC"; // Älteste zuerst!

            // LOCK-System (nur bei Full Run)
            if (fs.existsSync(LOCK_FILE)) {
                const stats = fs.statSync(LOCK_FILE);
                const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
                if (ageMinutes < 60) {
                    console.log(`\n🔒 ABBRUCH: Ein anderer Prozess läuft bereits (Lock: ${ageMinutes.toFixed(1)} Min alt)`);
                    console.log(`   Lock-File: ${LOCK_FILE}\n   Falls dies ein Fehler ist, lösche die Datei manuell.\n`);
                    await context.close();
                    return;
                }
                fs.unlinkSync(LOCK_FILE);
            }
            fs.writeFileSync(LOCK_FILE, Date.now().toString());
            createdLock = true;
            console.log(`🔓 Lock gesetzt`);
        }

        // Profile laden
        const profiles = await db.execute({ sql: query, args });

        if (profiles.rows.length === 0) {
            console.log(targetUsername ? `❌ Profil @${targetUsername} nicht in der Datenbank gefunden.` : `⚠️ Keine Profile zum Überwachen gefunden.`);
            return;
        }

        console.log(`📋 ${profiles.rows.length} Profile zu prüfen:\n`);

        for (const row of profiles.rows) {
            if (globalRateLimited) {
                console.log('\n🛑 ABBRUCH: Rate Limit global erkannt. Stoppe Monitoring-Run.');
                break;
            }
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;
            const isBaselineComplete = Boolean(row.isBaselineComplete);
            const existingScreenshot = row.screenshotUrl as string | null;

            console.log('─'.repeat(60));
            console.log(`🔍 @${username}`);

            // Frische Page für jedes Profil für maximale Robustheit
            const page = await context.newPage();

            try {
                // 📊 DB-GESUNDHEITSCHECK: Zeige wie aktuell die DB ist
                const dbEntries = await db.execute({
                    sql: 'SELECT COUNT(*) as cnt FROM FollowingEntry WHERE profileId = ?',
                    args: [profileId]
                });
                const actualDbCount = (dbEntries.rows[0]?.cnt as number) || 0;
                const dbCoverage = lastCount > 0 ? ((actualDbCount / lastCount) * 100).toFixed(1) : '0';

                console.log(`   📊 DB-Status: ${actualDbCount} Einträge | Soll: ${lastCount} | Abdeckung: ${dbCoverage}%`);
                console.log(`   📋 Baseline: ${isBaselineComplete ? '✅ Komplett' : '⚠️ Nicht komplett'}`);

                // Warnung wenn DB-Abdeckung schlecht ist
                if (isBaselineComplete && actualDbCount < lastCount * 0.9) {
                    console.log(`   ⚠️ WARNUNG: DB hat nur ${dbCoverage}% der erwarteten Einträge!`);
                }

                const currentCount = await getFollowingCount(page, username);

                if (currentCount === null) {
                    console.log('   ⚠️ Konnte Zahl nicht lesen\n');
                    await saveMonitoringLog(db, {
                        profileId,
                        profileUsername: username,
                        status: 'ERROR',
                        followingCountLive: 0,
                        followingCountDb: lastCount,
                        errorMessage: 'Following-Count konnte nicht gelesen werden'
                    });
                    continue;
                }

            console.log(`   📡 Live: ${currentCount} Following`);

            // ⚠️ Skip Profile mit zu vielen Followings (nicht zuverlässig scrapbar)
            const MAX_FOLLOWING = 1000;
            if (currentCount > MAX_FOLLOWING) {
                console.log(`   ⏭️ ÜBERSPRUNGEN: ${currentCount} > ${MAX_FOLLOWING} Following`);
                console.log(`      Profile mit >1000 Following können nicht zuverlässig gescrapt werden.`);
                console.log(`      Nur Count aktualisieren, keine Changes.\n`);

                await db.execute({
                    sql: `UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?`,
                    args: [currentCount, profileId]
                });

                await saveMonitoringLog(db, {
                    profileId,
                    profileUsername: username,
                    status: 'SKIPPED',
                    followingCountLive: currentCount,
                    followingCountDb: lastCount,
                    errorMessage: `Übersprungen: ${currentCount} > ${MAX_FOLLOWING} Following`
                });

                await humanDelay(8000, 12000);
                continue;
            }

            // Variablen initialisieren
            let changeScreenshotUrl: string | null = null;
            let currentFollowing: string[] = [];
            let userPicMap = new Map<string, string>();
            let scrapeQuote = '0';
            let addedUsernames: string[] = [];
            let removedUsernames: string[] = [];

            // Scrape nur wenn Änderung erkannt ODER Baseline fehlt ODER DB-Einträge stimmen nicht mit Live überein
            // KRITISCH: Wenn DB-Einträge ≠ Live-Count, gibt es unidentifizierte Changes!
            const dbMismatch = actualDbCount !== currentCount;
            const needsScrape = currentCount !== lastCount || !isBaselineComplete || dbMismatch;

            if (dbMismatch && isBaselineComplete && currentCount === lastCount) {
                console.log(`   🚨 DB-DISKREPANZ ERKANNT: DB hat ${actualDbCount} Einträge, Live zeigt ${currentCount}`);
                console.log(`   ℹ️ Es gibt ${currentCount - actualDbCount} unidentifizierte Following - starte Full Scrape!`);
            }

            if (needsScrape) {
                if (currentCount !== lastCount) {
                    console.log(`   🚨 ÄNDERUNG ERKANNT: ${lastCount} → ${currentCount}`);
                } else if (dbMismatch) {
                    console.log(`   🔄 Starte Full Scrape wegen DB-Diskrepanz...`);
                } else {
                    console.log(`   ℹ️ Erstelle initiale Baseline...`);
                }

                // 📸 Screenshot machen
                changeScreenshotUrl = await captureProfileScreenshot(page, username);
                if (changeScreenshotUrl) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET screenshotUrl = ? WHERE id = ?`,
                        args: [changeScreenshotUrl, profileId]
                    });
                }

                let followerNum = 0;
                try {
                    const info = await getProfileInfo(page, username, false);
                    if (info) followerNum = parseInt(info.followerCount.replace(/[.,KMB]/g, '') || '0');
                } catch { }

                // Full Scrape
                const scrapeResult = await getFollowingList(page, username, currentCount);
                currentFollowing = scrapeResult.following;
                userPicMap = scrapeResult.picMap;

                console.log(`   📋 ${currentFollowing.length} Following gescrapt`);

                scrapeQuote = currentCount > 0 ? ((currentFollowing.length / currentCount) * 100).toFixed(1) : '100';
                console.log(`   📈 Scraping-Quote: ${currentFollowing.length}/${currentCount} (${scrapeQuote}%)`);

                // ════════════════════════════════════════════════════════════
                // 🔄 MERGE-BASIERTE BASELINE: Partielle Ergebnisse ergänzen
                // ════════════════════════════════════════════════════════════
                // Statt 95%-Abbruch: Jedes Ergebnis wird gemergt.
                // Scrape 1: A,B,C,D (93%) + Scrape 2: A,B,E,F (92%) = DB: A,B,C,D,E,F (≈99%)

                if (currentFollowing.length > 0) {
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));

                    // Finde User, die im Scrape sind aber NICHT in der DB
                    const newlyDiscovered = currentFollowing.filter(u => !oldFollowing.has(u));
                    // Finde User, die in der DB sind aber NICHT im Scrape
                    const missingFromScrape = Array.from(oldFollowing).filter(u => !currentFollowing.includes(u));

                    console.log(`   📊 DB: ${oldFollowing.size} | Scrape: ${currentFollowing.length} | Neu entdeckt: ${newlyDiscovered.length} | Nicht im Scrape: ${missingFromScrape.length}`);

                    // === BASELINE NOCH NICHT KOMPLETT ===
                    if (!isBaselineComplete) {
                        console.log(`\n   🔄 BASELINE AUFBAU (Merge-Modus)...`);
                        console.log(`      Bisherige Einträge in DB: ${oldFollowing.size}`);
                        console.log(`      Neu entdeckt in diesem Scrape: ${newlyDiscovered.length}`);

                        // Nur NEUE User hinzufügen (bestehende behalten!)
                        if (newlyDiscovered.length > 0) {
                            let addedCount = 0;
                            for (const uname of newlyDiscovered) {
                                const pPic = userPicMap.get(uname) || null;
                                try {
                                    await db.execute({
                                        sql: `INSERT INTO FollowingEntry (id, username, position, profileId, profilePicUrl, addedAt, lastSeenAt, missedScans) 
                                              VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                        args: [`v4_${Date.now()}_${addedCount}`, uname, oldFollowing.size + addedCount, profileId, pPic]
                                    });
                                    addedCount++;
                                } catch (e: any) {
                                    // Duplikat ignorieren
                                    if (!e.message?.includes('UNIQUE')) {
                                        console.log(`      ⚠️ Fehler beim Einfügen von ${uname}: ${e.message}`);
                                    }
                                }
                            }
                            console.log(`      💾 ${addedCount} neue User zur DB hinzugefügt`);
                        }

                        // Prüfe: Haben wir jetzt 100%?
                        const newDbCount = oldFollowing.size + newlyDiscovered.length;
                        const completionPercent = currentCount > 0 ? ((newDbCount / currentCount) * 100).toFixed(1) : '100';
                        console.log(`      📊 DB-Fortschritt: ${newDbCount}/${currentCount} (${completionPercent}%)`);

                        if (newDbCount >= currentCount) {
                            // 🎉 100% erreicht!
                            console.log(`      🎉 BASELINE KOMPLETT! 100% erreicht!`);

                            const baselineProfileInfo = await getProfileInfo(page, username, false);
                            await db.execute({
                                sql: `UPDATE MonitoredProfile SET 
                                      followingCount = ?, 
                                      followerCount = ?,
                                      lastCheckedAt = datetime('now'),
                                      isBaselineComplete = 1,
                                      baselineCreatedAt = datetime('now'),
                                      baselineFollowingCount = ?,
                                      profilePicUrl = ?,
                                      fullName = ?,
                                      isVerified = ?,
                                      lastSuccessfulScrapeAt = datetime('now')
                                      WHERE id = ?`,
                                args: [
                                    currentCount,
                                    parseInt(baselineProfileInfo?.followerCount.replace(/[.,KMB]/g, '') || '0'),
                                    currentCount,
                                    baselineProfileInfo?.profilePicUrl || null,
                                    baselineProfileInfo?.fullName || username,
                                    baselineProfileInfo?.isVerified ? 1 : 0,
                                    profileId
                                ]
                            });

                            console.log(`   ✅ Baseline komplett (${newDbCount} Einträge) - Ab jetzt werden Änderungen erkannt!`);
                        } else {
                            // Noch nicht 100% - weiter aufbauen
                            console.log(`      ⏳ Noch nicht komplett. Fehlende User werden beim nächsten Scrape ergänzt.`);

                            await db.execute({
                                sql: `UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now'), lastSuccessfulScrapeAt = datetime('now') WHERE id = ?`,
                                args: [currentCount, profileId]
                            });
                        }

                        await saveMonitoringLog(db, {
                            profileId,
                            profileUsername: username,
                            status: newDbCount >= currentCount ? 'SUCCESS' : 'PARTIAL',
                            followingCountLive: currentCount,
                            followingCountDb: lastCount,
                            followerCountLive: followerNum,
                            scrapedCount: currentFollowing.length,
                            scrapeQuote: parseFloat(scrapeQuote),
                            newFollowsCount: newlyDiscovered.length,
                            unfollowsCount: 0,
                            errorMessage: `Baseline: ${newDbCount}/${currentCount} (${completionPercent}%)`
                        });

                        await humanDelay(10000, 15000);
                        continue; // Zum nächsten Profil!
                    }

                    // === BASELINE KOMPLETT: Echte Changes erkennen ===
                    addedUsernames = newlyDiscovered;
                    removedUsernames = missingFromScrape;

                    // 🛡️ SANITY CHECK: Zu viele "Änderungen" = wahrscheinlich Scrape-Problem
                    const expectedChange = Math.abs(currentCount - lastCount);
                    const isSuspiciouslyManyChanges = (addedUsernames.length + removedUsernames.length) > Math.max(expectedChange * 3, 20);
                    const scrapeRatio = currentFollowing.length / currentCount;

                    if (isSuspiciouslyManyChanges && scrapeRatio < 0.95) {
                        console.log(`\n   ⚠️ VERDÄCHTIGER SCRAPE: ${addedUsernames.length} neu + ${removedUsernames.length} entfernt bei ${(scrapeRatio * 100).toFixed(1)}% Scrape-Quote`);
                        console.log(`      → Nur ${scrapeQuote}% gescrapt - Merge statt Change-Detection!`);

                        // Merge: Neue User hinzufügen, aber keine "Entfernungen" melden
                        if (newlyDiscovered.length > 0) {
                            let addedCount = 0;
                            for (const uname of newlyDiscovered) {
                                const pPic = userPicMap.get(uname) || null;
                                try {
                                    await db.execute({
                                        sql: `INSERT INTO FollowingEntry (id, username, position, profileId, profilePicUrl, addedAt, lastSeenAt, missedScans) 
                                              VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                        args: [`v4_${Date.now()}_${addedCount}`, uname, oldFollowing.size + addedCount, profileId, pPic]
                                    });
                                    addedCount++;
                                } catch { }
                            }
                            console.log(`      💾 ${addedCount} neue User gemergt (keine Changes gemeldet)`);
                        }

                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?`,
                            args: [currentCount, profileId]
                        });

                        await saveMonitoringLog(db, {
                            profileId,
                            profileUsername: username,
                            status: 'PARTIAL',
                            followingCountLive: currentCount,
                            followingCountDb: lastCount,
                            scrapedCount: currentFollowing.length,
                            scrapeQuote: parseFloat(scrapeQuote),
                            errorMessage: `Verdächtiger Scrape: ${scrapeQuote}% - Merge statt Changes`
                        });

                        await humanDelay(10000, 15000);
                        continue;
                    }

                    console.log(`   ➕ Neu: ${addedUsernames.length} | ➖ Entfolgt: ${removedUsernames.length}`);

                    // === ECHTER CHANGE: Profilinfos laden und tweeten ===
                    if (addedUsernames.length > 0 || removedUsernames.length > 0) {
                        console.log('\n   📊 Lade Profilinfos mit Screenshots...');

                        const monitoredProfileInfo = await getProfileInfo(page, username, true);
                        if (!monitoredProfileInfo) continue;

                        followerNum = parseInt(monitoredProfileInfo.followerCount.replace(/[,.KMB]/g, '') || '0');

                        // Verarbeite FOLLOWS (max 10 um Zeit zu sparen)
                        if (addedUsernames.length > 0) {
                            const maxToProcess = Math.min(addedUsernames.length, 10);
                            console.log(`\n   🆕 Verarbeite ${maxToProcess} von ${addedUsernames.length} neuen Follows...`);
                            const addedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of addedUsernames.slice(0, maxToProcess)) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername, true);
                                if (info) addedProfiles.push(info);
                                await humanDelay(5000, 8000);
                            }

                            if (addedProfiles.length > 0) {
                                const tweetText = formatTweetText('FOLLOW', monitoredProfileInfo, addedProfiles);

                                // Screenshot: Immer Monitor-Screenshot (morewatchez)
                                const screenshotToUse = monitoredProfileInfo.screenshotPath;

                                const tweetUrl = await postToTwitter(
                                    context.browser()!,
                                    tweetText,
                                    screenshotToUse
                                );

                                // 📤 Falls Twitter-Post fehlgeschlagen -> In Queue speichern
                                if (!tweetUrl) {
                                    console.log('   📥 Twitter-Post fehlgeschlagen - speichere in Queue...');
                                    addToQueue({
                                        text: tweetText,
                                        imagePath: screenshotToUse,
                                        monitoredProfile: monitoredProfileInfo.username,
                                        changeType: 'FOLLOW',
                                        targetUsernames: addedUsernames
                                    });
                                }

                                await sendWebhook({
                                    event: 'FOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: addedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${addedUsernames.length} neuen Personen`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern mit korrektem Screenshot
                                for (const target of addedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, targetFullName, targetPicUrl, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'FOLLOW', ?, ?, ?, ?, datetime('now'), 1, 1, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, target.fullName || null, target.profilePicUrl || null, changeScreenshotUrl, profileId]
                                    });
                                }
                            }
                        }

                        // Verarbeite UNFOLLOWS (max 10 um Zeit zu sparen)
                        if (removedUsernames.length > 0) {
                            const maxToProcess = Math.min(removedUsernames.length, 10);
                            console.log(`\n   ❌ Verarbeite ${maxToProcess} von ${removedUsernames.length} Entfolgungen...`);
                            const removedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of removedUsernames.slice(0, maxToProcess)) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername, true);
                                if (info) removedProfiles.push(info);
                                await humanDelay(5000, 8000);
                            }

                            if (removedProfiles.length > 0) {
                                const tweetText = formatTweetText('UNFOLLOW', monitoredProfileInfo, removedProfiles);
                                // Screenshot: Immer Monitor-Screenshot
                                const unfollowScreenshot = monitoredProfileInfo.screenshotPath;

                                const tweetUrl = await postToTwitter(
                                    context.browser()!,
                                    tweetText,
                                    unfollowScreenshot
                                );

                                // 📤 Falls Twitter-Post fehlgeschlagen -> In Queue speichern
                                if (!tweetUrl) {
                                    console.log('   📥 Twitter-Post fehlgeschlagen - speichere in Queue...');
                                    addToQueue({
                                        text: tweetText,
                                        imagePath: unfollowScreenshot,
                                        monitoredProfile: monitoredProfileInfo.username,
                                        changeType: 'UNFOLLOW',
                                        targetUsernames: removedUsernames
                                    });
                                }

                                await sendWebhook({
                                    event: 'UNFOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: removedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${removedUsernames.length} Personen nicht mehr`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern mit korrektem Screenshot
                                for (const target of removedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, targetFullName, targetPicUrl, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'UNFOLLOW', ?, ?, ?, ?, datetime('now'), 1, 1, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, target.fullName || null, target.profilePicUrl || null, changeScreenshotUrl, profileId]
                                    });
                                }
                            }
                        }

                        // DB aktualisieren (Merge: Neue hinzufügen, Entfolgte entfernen)
                        console.log('\n   💾 Aktualisiere Datenbank (Merge)...');

                        // Neue User hinzufügen
                        for (const uname of addedUsernames) {
                            const pPic = userPicMap.get(uname) || null;
                            try {
                                await db.execute({
                                    sql: `INSERT INTO FollowingEntry (id, username, position, profileId, profilePicUrl, addedAt, lastSeenAt, missedScans) 
                                          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                    args: [`v4_${Date.now()}_${Math.random().toString(36).slice(2)}`, uname, 0, profileId, pPic]
                                });
                            } catch { }
                        }

                        // Entfolgte User entfernen
                        for (const uname of removedUsernames) {
                            await db.execute({
                                sql: `DELETE FROM FollowingEntry WHERE profileId = ? AND username = ?`,
                                args: [profileId, uname]
                            });
                        }

                        console.log(`      ➕ ${addedUsernames.length} hinzugefügt, ➖ ${removedUsernames.length} entfernt`);

                        // Aktualisiere auch Profilinfos
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  followerCount = ?,
                                  fullName = ?,
                                  profilePicUrl = ?,
                                  isVerified = ?,
                                  lastCheckedAt = datetime('now'),
                                  lastSuccessfulScrapeAt = datetime('now')
                                  WHERE id = ?`,
                            args: [
                                currentCount,
                                followerNum,
                                monitoredProfileInfo.fullName || username,
                                monitoredProfileInfo.profilePicUrl || null,
                                monitoredProfileInfo.isVerified ? 1 : 0,
                                profileId
                            ]
                        });
                    } else {
                        // Keine neuen/entfernten Follows, nur Count und Timestamp updaten
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  lastCheckedAt = datetime('now'),
                                  lastSuccessfulScrapeAt = datetime('now') 
                                  WHERE id = ?`,
                            args: [currentCount, profileId]
                        });
                    }

                    // 📊 Log: SUCCESS mit Änderungen
                    await saveMonitoringLog(db, {
                        profileId,
                        profileUsername: username,
                        status: 'SUCCESS',
                        followingCountLive: currentCount,
                        followingCountDb: lastCount,
                        followerCountLive: followerNum,
                        scrapedCount: currentFollowing.length,
                        scrapeQuote: parseFloat(scrapeQuote),
                        newFollowsCount: addedUsernames.length,
                        unfollowsCount: removedUsernames.length,
                        newFollows: addedUsernames.slice(0, 20), // Max 20 speichern
                        unfollows: removedUsernames.slice(0, 20)
                    });
                }
            } else {
                console.log('   ✅ Keine Änderung');

                // 📊 Log: NO_CHANGE
                await saveMonitoringLog(db, {
                    profileId,
                    profileUsername: username,
                    status: 'NO_CHANGE',
                    followingCountLive: currentCount,
                    followingCountDb: lastCount
                });

                // Trotzdem Profilinfos aktualisieren (Bild, Name, etc.)
                const profileInfo = await getProfileInfo(page, username, false);
                if (profileInfo?.profilePicUrl) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET 
                              profilePicUrl = ?,
                              fullName = ?,
                              isVerified = ?,
                              lastCheckedAt = datetime('now')
                              WHERE id = ?`,
                        args: [
                            profileInfo.profilePicUrl,
                            profileInfo.fullName || username,
                            profileInfo.isVerified ? 1 : 0,
                            profileId
                        ]
                    });
                } else {
                    await db.execute({
                        sql: "UPDATE MonitoredProfile SET lastCheckedAt = datetime('now') WHERE id = ?",
                        args: [profileId]
                    });
                }
            }

            } catch (err: any) {
                console.log(`   ❌ Fehler bei @${username}: ${err.message}`);
                await saveMonitoringLog(db, {
                    profileId,
                    profileUsername: username,
                    status: 'ERROR',
                    followingCountLive: 0,
                    followingCountDb: lastCount,
                    errorMessage: `Loop-Error: ${err.message}`
                });
            } finally {
                await page.close().catch(() => { });
                // Push progress at the end of each profile if you want, 
                // but maybe only if changes occurred? For now, I'll keep it disabled for speed.
                // await pushProgressToGit(username);
            }

            console.log('');
            await humanDelay(10000, 15000);
        }

        // Globaler Push am Ende
        await pushProgressToGit("final_sync");

        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Instagram Session gespeichert');

    } catch (err: any) {
        console.error('\n❌ Fehler:', err.message);
    } finally {
        if (createdLock && fs.existsSync(LOCK_FILE)) {
            try { fs.unlinkSync(LOCK_FILE); } catch { }
        }
        await context.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Monitoring abgeschlossen');
    console.log('═'.repeat(60) + '\n');
}

main();

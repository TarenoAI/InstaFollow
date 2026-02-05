/**
 * 🕵️‍♂️ SMART MONITORING v4 - MIT SCREENSHOTS & TWITTER POST
 * 
 * - Screenshots der Profile bei Änderungen
 * - Automatischer Twitter-Post via Playwright (keine API nötig!)
 * - Webhook-Bestätigung nach Post
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page, BrowserContext, Browser } from 'playwright';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

// === KONFIGURATION ===
const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'public/screenshots');
const iPhone = devices['iPhone 13 Pro'];
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

// Erstelle Screenshots-Ordner
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

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

async function dismissPopups(page: Page) {
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
        'button:has-text("Informationen nicht speichern")',
        'button:has-text("Not now")',
        // Turn on notifications
        'button:has-text("Nicht aktivieren")',
        'button:has-text("Not Now")',
        // Close buttons (X icons)
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'svg[aria-label="Schließen"]',
        'svg[aria-label="Close"]',
        // Cancel/Dismiss
        'button:has-text("Abbrechen")',
        'button:has-text("Cancel")',
        // "View profile in app" popup - X button at top right
        'div[role="dialog"] button[type="button"]',
        'div[role="dialog"] svg[aria-label="Schließen"]',
        'div[role="dialog"] svg[aria-label="Close"]',
        // The X button specifically
        'button svg[aria-label="Schließen"]',
        'button svg[aria-label="Close"]',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(300);
                console.log(`      🔇 Popup geschlossen: ${sel}`);
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
        await dismissPopups(page);

        // Screenshot wenn gewünscht
        let screenshotPath = '';
        if (takeScreenshot) {
            await page.waitForSelector('header img', { timeout: 5000 }).catch(() => { });
            screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_${Date.now()}.png`);
            await page.screenshot({
                path: screenshotPath,
                clip: { x: 0, y: 0, width: 390, height: 500 }
            });
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
            const nameEl = await page.$('header section span');
            if (nameEl) {
                fullName = await nameEl.innerText() || username;
                fullName = fullName.replace(/\s*\(@.*\).*$/, '').trim();
            }
        } catch { }

        // Extrahiere Follower/Following
        let followerCount = '0';
        let followingCount = '0';
        let isVerified = false;

        try {
            isVerified = await page.$('[aria-label*="Verified"], svg[aria-label*="Verifiziert"]') !== null;

            const stats = await page.$$eval('a[href*="followers"], a[href*="following"]', (links: any[]) => {
                return links.map(l => ({ href: l.href, text: l.innerText.trim() }));
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
async function getFollowingList(page: Page, username: string, expectedCount: number = 200): Promise<string[]> {
    try {
        // API-Response Sammler
        const apiFollowing = new Set<string>();

        // Intercepte Instagram API-Responses
        const responseHandler = async (response: any) => {
            const url = response.url();

            // Instagram Following API
            if (url.includes('/api/v1/friendships/') && url.includes('/following/')) {
                try {
                    const json = await response.json();
                    if (json.users) {
                        for (const user of json.users) {
                            if (user.username) {
                                apiFollowing.add(user.username);
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
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        await page.click('a[href*="following"]', { timeout: 10000 });
        await page.waitForTimeout(4000);
        // NICHT dismissPopups aufrufen, da dies das Following-Fenster schließt!

        // DEBUG: Screenshot nach Dialog-Öffnung
        await page.screenshot({ path: `debug-dialog-${username}.png` });
        console.log(`   📸 Debug Screenshot: debug-dialog-${username}.png`);

        // DOM-basierte Sammlung als Backup
        const domFollowing = new Set<string>();
        let noNewCount = 0;

        // Dynamische Scroll-Anzahl: ~10 Accounts pro Scroll sichtbar
        // Bei 500 Following = 60 Scrolls, bei 1000 Following = 120 Scrolls
        const maxScrolls = Math.max(80, Math.ceil(expectedCount / 8) + 20);
        const maxNoNewCount = 25; // Mehr Versuche bevor wir aufgeben

        console.log(`   📜 Max Scrolls: ${maxScrolls} (für ${expectedCount} Following)`);

        // Warte auf Dialog und finde das scrollbare Element
        await page.waitForTimeout(2000);

        // Versuche verschiedene Selektoren für den scrollbaren Container
        let scrollContainer = await page.$('div[role="dialog"] div[style*="overflow"]');
        if (!scrollContainer) {
            scrollContainer = await page.$('[role="dialog"] div[class*="x1n2onr6"]');
        }
        if (!scrollContainer) {
            // Fallback: Finde das div das die Following-Liste enthält
            scrollContainer = await page.$('[role="dialog"] div > div > div');
        }

        console.log(`   📦 Scroll-Container gefunden: ${!!scrollContainer}`);

        for (let scroll = 0; scroll < maxScrolls && noNewCount < maxNoNewCount; scroll++) {
            // Sammle alle sichtbaren Usernames - ALLE STRATEGIEN PARALLEL
            const users = await page.evaluate(() => {
                const found = new Set<string>();
                const dialog = document.querySelector('[role="dialog"]');
                if (!dialog) return [];

                const excludeList = ['explore', 'reels', 'p', 'direct', 'accounts', 'stories', 'search', 'following', 'followers', 'suchen', 'folgen', 'gefolgt', 'nachricht', 'senden'];

                // Strategie 1: Alle Links mit href die wie Usernames aussehen
                dialog.querySelectorAll('a[href]').forEach(a => {
                    const href = a.getAttribute('href');
                    if (href && href.match(/^\/[a-zA-Z0-9._]+\/?$/)) {
                        const username = href.replace(/\//g, '');
                        if (!excludeList.includes(username.toLowerCase()) && username.length >= 2) {
                            found.add(username);
                        }
                    }
                });

                // Strategie 2: IMMER span/div-Elemente mit Username-Pattern durchsuchen
                dialog.querySelectorAll('span, div').forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && text.match(/^[a-zA-Z0-9._]{2,30}$/) && !text.includes(' ')) {
                        const lower = text.toLowerCase();
                        // Filter bekannte Nicht-Usernames
                        if (!excludeList.includes(lower) &&
                            !lower.includes('follower') &&
                            !lower.includes('beitr') &&
                            !lower.includes('abonniert')) {
                            // Prüfe ob es neben einem Avatar ist
                            const parent = el.closest('a') || el.parentElement;
                            if (parent && (parent.querySelector('img') || parent.tagName === 'A')) {
                                found.add(text);
                            }
                        }
                    }
                });

                // Strategie 3: IMMER Profilbilder durchsuchen
                dialog.querySelectorAll('img').forEach(img => {
                    let container = img.parentElement;
                    for (let i = 0; i < 4 && container; i++) {
                        container.querySelectorAll('span').forEach(span => {
                            const text = span.textContent?.trim();
                            if (text && text.match(/^[a-z0-9._]{2,30}$/i) && !text.includes(' ')) {
                                const lower = text.toLowerCase();
                                if (!excludeList.includes(lower) && text.length >= 3) {
                                    found.add(text);
                                }
                            }
                        });
                        container = container.parentElement;
                    }
                });

                return Array.from(found);
            });

            const prevSize = domFollowing.size;
            users.forEach(u => u && domFollowing.add(u));

            if (domFollowing.size === prevSize) noNewCount++;
            else noNewCount = 0;

            // Logge Status
            if (scroll % 5 === 0) {
                console.log(`   Scroll ${scroll + 1}/${maxScrolls}: DOM=${domFollowing.size} | API=${apiFollowing.size}`);
            }

            // Debug: Screenshot nach 10 Scrolls um zu prüfen ob gescrollt wird
            if (scroll === 10) {
                await page.screenshot({ path: `.incidents/scroll-debug-${Date.now()}.png` });
                console.log(`   📸 Scroll-Debug Screenshot gespeichert`);
            }

            // ROBUSTES SCROLLING: Mehrere Strategien
            try {
                // Strategie 1: Finde das scrollbare Element und scrolle es
                const scrolled = await page.evaluate(() => {
                    const dialog = document.querySelector('[role="dialog"]');
                    if (!dialog) return false;

                    // Finde alle scrollbaren Elemente
                    const allDivs = dialog.querySelectorAll('div');
                    for (const el of allDivs) {
                        // Prüfe ob das Element scrollbar ist
                        if (el.scrollHeight > el.clientHeight + 10) {
                            const oldTop = el.scrollTop;
                            el.scrollTop += 600;
                            // Prüfe ob tatsächlich gescrollt wurde
                            if (el.scrollTop !== oldTop) {
                                return true;
                            }
                        }
                    }
                    return false;
                });

                // Log scroll success nur einmal
                if (scroll === 0) {
                    console.log(`   📜 JS-Scroll funktioniert: ${scrolled}`);
                }

                await page.waitForTimeout(300);

                // Strategie 2: Mouse wheel direkt im Dialog-Bereich
                const dialogBox = await page.$('[role="dialog"]');
                if (dialogBox) {
                    const box = await dialogBox.boundingBox();
                    if (box) {
                        // Scroll im Zentrum des Dialogs
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        await page.mouse.wheel(0, 400);
                    }
                }

                await page.waitForTimeout(200);

                // Strategie 3: Keyboard scrolling
                await page.keyboard.press('PageDown');
                await page.waitForTimeout(100);
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('ArrowDown');

            } catch (scrollErr: any) {
                // Fallback: Mouse wheel
                if (scroll === 0) console.log(`   ⚠️ Scroll-Fehler: ${scrollErr.message}`);
                await page.mouse.move(200, 400);
                await page.mouse.wheel(0, 600);
            }

            // Warte auf neue API-Responses
            await humanDelay(2000, 3500);

            // Alle 5 Scrolls: Extra warten für Lazy Loading
            if (scroll % 5 === 4) {
                await page.waitForTimeout(2000);
            }
        }

        // Response Handler entfernen
        page.off('response', responseHandler);

        // Kombiniere beide Quellen
        const combined = new Set([...domFollowing, ...apiFollowing]);
        combined.delete(username);

        console.log(`   ✅ Scraping beendet: DOM=${domFollowing.size} | API=${apiFollowing.size} | KOMBINIERT=${combined.size}`);

        // Wenn API mehr gefunden hat, logge das
        if (apiFollowing.size > domFollowing.size) {
            const additional = apiFollowing.size - domFollowing.size;
            console.log(`   📡 API-Interception fand ${additional} zusätzliche Accounts!`);
        }

        // Dialog schließen
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        return Array.from(combined);
    } catch (err: any) {
        console.log(`   ❌ Scrape-Fehler: ${err.message}`);
        return [];
    }
}

/**
 * Quick-Check: Nur Following-Zahl abrufen (mit mehreren Fallback-Methoden)
 */
async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    try {
        console.log(`      🔍 Suche @${username}...`);

        // Stelle sicher dass wir auf Instagram sind
        const currentUrl = page.url();
        if (!currentUrl.includes('instagram.com') || currentUrl.includes('login')) {
            await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
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
            // Check 1: Body text length
            bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);

            // Check 2: Instagram-spezifische Elemente
            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            const hasHeader = await page.$('header').then(el => !!el).catch(() => false);
            const hasAvatar = await page.$('img[alt*="Profilbild"], img[alt*="profile picture"]').then(el => !!el).catch(() => false);

            if (bodyLen > 150 || hasFollowingLink || (hasHeader && hasAvatar)) {
                pageReady = true;
                break;
            }

            console.log(`      ⏳ Warte auf Content (${i + 1}/5)... [bodyLen=${bodyLen}]`);
            await page.waitForTimeout(2000);
            await dismissPopups(page);
        }

        console.log(`      📄 Body text length: ${bodyLen}, pageReady: ${pageReady}`);

        if (!pageReady) {
            console.log(`      ⚠️ Seite nicht bereit - versuche Reload...`);
            await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(5000);
            await dismissPopups(page);

            // Nochmal checken
            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
            pageReady = bodyLen > 150 || hasFollowingLink;
        }

        // Letzter Versuch: Direkte Navigation falls Suche fehlgeschlagen
        if (!pageReady) {
            console.log(`      🔄 Letzter Versuch mit direkter URL...`);
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(3000);
            await dismissPopups(page);

            const hasFollowingLink = await page.$('a[href*="following"]').then(el => !!el).catch(() => false);
            bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
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
        const pageText = await page.evaluate(() => document.body?.innerText || '');
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
 */
async function postToTwitter(
    browser: Browser,
    text: string,
    imagePath?: string
): Promise<string | null> {
    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
        console.log('   ⚠️ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt');
        return null;
    }

    console.log('\n   🐦 Poste auf Twitter...');

    const context = await browser.newContext({
        storageState: fs.existsSync(TWITTER_SESSION_PATH) ? TWITTER_SESSION_PATH : undefined,
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    try {
        // Prüfe ob eingeloggt
        await page.goto('https://twitter.com/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Login wenn nötig
        if (page.url().includes('login') || await page.$('input[autocomplete="username"]')) {
            console.log('   🔐 Twitter Login...');

            if (!page.url().includes('login')) {
                await page.goto('https://twitter.com/login');
                await page.waitForTimeout(2000);
            }

            await page.fill('input[autocomplete="username"]', TWITTER_USERNAME);

            // Klicke "Weiter" / "Next" Button - mehrere Sprachen unterstützen
            const nextButton = await page.$('text=Weiter') ||
                await page.$('text=Next') ||
                await page.$('[role="button"]:has-text("Next")') ||
                await page.$('[role="button"]:has-text("Weiter")');
            if (nextButton) {
                await nextButton.click();
            } else {
                // Fallback: Drücke Enter
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(2000);

            await page.fill('input[type="password"]', TWITTER_PASSWORD);

            // Klicke "Anmelden" / "Log in" Button
            const loginButton = await page.$('text=Anmelden') ||
                await page.$('text=Log in') ||
                await page.$('[data-testid="LoginForm_Login_Button"]');
            if (loginButton) {
                await loginButton.click();
            } else {
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(5000);

            // Session speichern
            await context.storageState({ path: TWITTER_SESSION_PATH });
        }

        console.log('   ✅ Twitter eingeloggt');

        // Zum Compose-Bereich
        await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Text eingeben
        const textArea = await page.$('[data-testid="tweetTextarea_0"]');
        if (textArea) {
            await textArea.fill(text);
            await page.waitForTimeout(1000);
        }

        // Bild hochladen wenn vorhanden
        if (imagePath && fs.existsSync(imagePath)) {
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.setInputFiles(imagePath);
                await page.waitForTimeout(3000);
            }
        }

        // Tweet absenden
        await page.click('[data-testid="tweetButton"]');
        await page.waitForTimeout(5000);

        // Tweet-URL extrahieren (von der Timeline)
        await page.goto(`https://twitter.com/${TWITTER_USERNAME}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const tweetLink = await page.$('article a[href*="/status/"]');
        let tweetUrl = '';
        if (tweetLink) {
            tweetUrl = await tweetLink.getAttribute('href') || '';
            if (tweetUrl) tweetUrl = `https://twitter.com${tweetUrl}`;
        }

        console.log(`   ✅ Tweet gepostet! ${tweetUrl}`);

        await context.storageState({ path: TWITTER_SESSION_PATH });
        await context.close();

        return tweetUrl;
    } catch (err: any) {
        console.log(`   ❌ Twitter Fehler: ${err.message}`);
        await context.close();
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
 * Formatiert den Tweet-Text im Stil von @takiprazzi
 * Zeigt ALLE Accounts, nicht nur 3!
 */
function formatTweetText(event: 'FOLLOW' | 'UNFOLLOW', profile: ProfileInfo, targets: ProfileInfo[]): string {
    const emoji = event === 'FOLLOW' ? '👉' : '👀';
    const actionEmoji = event === 'FOLLOW' ? '✅' : '❌';
    const action = event === 'FOLLOW'
        ? `folgt jetzt ${targets.length} ${targets.length === 1 ? 'Person' : 'Personen'}`
        : `folgt nicht mehr ${targets.length} ${targets.length === 1 ? 'Person' : 'Personen'}`;

    let text = `${emoji} ${profile.username} (${profile.fullName}) ${action}:\n\n`;

    // ALLE Targets anzeigen - Twitter erlaubt bis zu 280 Zeichen, aber Threads sind möglich
    for (const target of targets) {
        text += `${actionEmoji} ${target.username} (${target.fullName})\n`;
        text += `🔗 instagram.com/${target.username}\n\n`;
    }

    return text.trim();
}

const LOCK_FILE = path.join(process.cwd(), '.monitor.lock');

// === MAIN ===
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING v4 - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });

    const page = await context.newPage();

    let createdLock = false;
    const targetUsername = process.argv[2];

    try {
        // Login Check für Instagram
        console.log('🌐 Prüfe Instagram Login...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        if (page.url().includes('login')) {
            console.log('❌ Nicht eingeloggt! Bitte Session erneuern.');
            await browser.close();
            return;
        }

        // Check for single profile argument
        let query = "SELECT id, username, followingCount, isBaselineComplete, screenshotUrl FROM MonitoredProfile";
        let args: any[] = [];

        if (targetUsername) {
            console.log(`🎯 Modus: Einzel-Profil Check (@${targetUsername})`);
            query += " WHERE username = ?";
            args.push(targetUsername);
        } else {
            // LOCK-System (nur bei Full Run)
            if (fs.existsSync(LOCK_FILE)) {
                const stats = fs.statSync(LOCK_FILE);
                const ageMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
                if (ageMinutes < 60) {
                    console.log(`\n🔒 ABBRUCH: Ein anderer Prozess läuft bereits (Lock: ${ageMinutes.toFixed(1)} Min alt)`);
                    console.log(`   Lock-File: ${LOCK_FILE}\n   Falls dies ein Fehler ist, lösche die Datei manuell.\n`);
                    await browser.close();
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
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;
            const isBaselineComplete = Boolean(row.isBaselineComplete);
            const existingScreenshot = row.screenshotUrl as string | null;

            console.log('─'.repeat(60));
            console.log(`🔍 @${username} (DB: ${lastCount})`);

            const currentCount = await getFollowingCount(page, username);

            if (currentCount === null) {
                console.log('   ⚠️ Konnte Zahl nicht lesen\n');
                continue;
            }

            console.log(`   Aktuell: ${currentCount}`);

            // 📸 Screenshot für Profile OHNE existierenden Screenshot (einmalig)
            if (!existingScreenshot) {
                console.log(`   📸 Erster Screenshot für @${username}...`);
                const newScreenshotUrl = await captureProfileScreenshot(page, username);
                if (newScreenshotUrl) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET screenshotUrl = ? WHERE id = ?`,
                        args: [newScreenshotUrl, profileId]
                    });
                }
            }

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

                await humanDelay(8000, 12000);
                continue;
            }

            if (currentCount !== lastCount) {
                console.log(`   🚨 ÄNDERUNG: ${lastCount} → ${currentCount}`);

                // 📸 Neuer Screenshot bei Änderung (aktualisiert existierenden)
                console.log(`   📸 Screenshot-Update wegen Änderung...`);
                const screenshotUrl = await captureProfileScreenshot(page, username);
                if (screenshotUrl) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET screenshotUrl = ? WHERE id = ?`,
                        args: [screenshotUrl, profileId]
                    });
                }

                // Full Scrape
                const currentFollowing = await getFollowingList(page, username, currentCount);
                console.log(`   📋 ${currentFollowing.length} Following gescrapt`);

                // Diagnose-Logs für Scraping-Quote
                const scrapeQuote = currentCount > 0 ? ((currentFollowing.length / currentCount) * 100).toFixed(1) : '100';
                console.log(`   📈 Scraping-Quote: ${currentFollowing.length}/${currentCount} (${scrapeQuote}%)`);

                if (currentFollowing.length < currentCount * 0.8) {
                    console.log(`   ⚠️ DIAGNOSE: Weniger als 80% gescrapt!`);
                    console.log(`      Mögliche Ursachen:`);
                    console.log(`      1. Instagram Lazy-Loading Limits`);
                    console.log(`      2. Gelöschte/Deaktivierte Accounts in der Zählung`);
                    console.log(`      3. Netzwerk-Latenz auf VPS`);
                }

                // ⚠️ KRITISCH: Wenn weniger als 95% gescrapt, keine Changes verarbeiten!
                const MIN_SCRAPE_QUOTA = 0.95;
                if (currentFollowing.length < currentCount * MIN_SCRAPE_QUOTA) {
                    console.log(`   🚫 ABBRUCH: Nur ${currentFollowing.length}/${currentCount} gescrapt (${scrapeQuote}%)`);
                    console.log(`      Benötigt: mindestens ${Math.ceil(currentCount * 0.95)} (95%)`);
                    console.log(`      ➡️ Keine Changes werden verarbeitet um falsche Unfollows zu vermeiden!`);
                    console.log(`      ➡️ Count wird NICHT aktualisiert - nächster Lauf wird erneut Änderung erkennen!`);
                    console.log(`      ➡️ DB bleibt bei: ${lastCount} (Live: ${currentCount})\n`);

                    // ❌ KEIN COUNT-UPDATE! Nur lastCheckedAt aktualisieren
                    // So wird beim nächsten Lauf die Änderung erneut erkannt
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET lastCheckedAt = datetime('now') WHERE id = ?`,
                        args: [profileId]
                    });

                    await humanDelay(10000, 15000);
                    continue; // Zum nächsten Profil
                }

                if (currentFollowing.length > 0) {
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));

                    const addedUsernames = currentFollowing.filter(u => !oldFollowing.has(u));
                    const removedUsernames = Array.from(oldFollowing).filter(u => !currentFollowing.includes(u));

                    console.log(`   ➕ Neu: ${addedUsernames.length} | ➖ Entfolgt: ${removedUsernames.length}`);

                    // === BASELINE NICHT KOMPLETT: Erst Baseline erstellen ===
                    if (!isBaselineComplete) {
                        console.log(`\n   🆕 BASELINE NICHT KOMPLETT - Erstelle/Aktualisiere Baseline...`);
                        console.log(`      Bisherige Einträge in DB: ${oldFollowing.size}`);
                        console.log(`      Gescrapt: ${currentFollowing.length}`);

                        // Lösche alte Einträge und ersetze mit vollständigem Scrape
                        await db.execute({
                            sql: "DELETE FROM FollowingEntry WHERE profileId = ?",
                            args: [profileId]
                        });

                        // Batch-Insert für bessere Performance
                        const batchSize = 50;
                        for (let batch = 0; batch < Math.ceil(currentFollowing.length / batchSize); batch++) {
                            const start = batch * batchSize;
                            const end = Math.min(start + batchSize, currentFollowing.length);

                            for (let i = start; i < end; i++) {
                                await db.execute({
                                    sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                    args: [`v4_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                                });
                            }
                            console.log(`      💾 Batch ${batch + 1}: ${end}/${currentFollowing.length} gespeichert`);
                        }

                        // Markiere als Baseline-complete + speichere Zeitpunkt
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  lastCheckedAt = datetime('now'),
                                  isBaselineComplete = 1,
                                  lastSuccessfulScrapeAt = datetime('now')
                                  WHERE id = ?`,
                            args: [currentCount, profileId]
                        });

                        console.log(`   ✅ Baseline erstellt (${currentFollowing.length} Einträge) - KEINE Changes gemeldet`);
                        console.log(`   ℹ️ Ab jetzt werden Änderungen erkannt!\n`);
                        await humanDelay(10000, 15000);
                        continue; // Zum nächsten Profil!
                    }

                    // === ECHTER CHANGE: Profilinfos laden und tweeten ===
                    if (addedUsernames.length > 0 || removedUsernames.length > 0) {
                        console.log('\n   📊 Lade Profilinfos mit Screenshots...');

                        const monitoredProfileInfo = await getProfileInfo(page, username, true);
                        if (!monitoredProfileInfo) continue;

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

                                // Screenshot: Bei 1 Target -> Target-Screenshot, sonst Monitor-Screenshot
                                const screenshotToUse = addedProfiles.length === 1 && addedProfiles[0].screenshotPath
                                    ? addedProfiles[0].screenshotPath
                                    : monitoredProfileInfo.screenshotPath;

                                const tweetUrl = await postToTwitter(
                                    browser,
                                    tweetText,
                                    screenshotToUse
                                );

                                await sendWebhook({
                                    event: 'FOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: addedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${addedUsernames.length} neuen Personen`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern
                                for (const target of addedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'FOLLOW', ?, ?, datetime('now'), 1, 0, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, monitoredProfileInfo.screenshotPath || null, profileId]
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

                                const tweetUrl = await postToTwitter(
                                    browser,
                                    tweetText,
                                    removedProfiles[0]?.screenshotPath || monitoredProfileInfo.screenshotPath
                                );

                                await sendWebhook({
                                    event: 'UNFOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: removedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${removedUsernames.length} Personen nicht mehr`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern
                                for (const target of removedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'UNFOLLOW', ?, ?, datetime('now'), 1, 0, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, monitoredProfileInfo.screenshotPath || null, profileId]
                                    });
                                }
                            }
                        }

                        // DB aktualisieren
                        console.log('\n   💾 Aktualisiere Datenbank...');
                        await db.execute({ sql: "DELETE FROM FollowingEntry WHERE profileId = ?", args: [profileId] });

                        for (let i = 0; i < currentFollowing.length; i++) {
                            await db.execute({
                                sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                args: [`v4_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                            });
                        }

                        // Aktualisiere auch Profilinfos
                        const followerNum = parseInt(monitoredProfileInfo.followerCount.replace(/[,.KMB]/g, '') || '0');
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
                }
            } else {
                console.log('   ✅ Keine Änderung');
                await db.execute({
                    sql: "UPDATE MonitoredProfile SET lastCheckedAt = datetime('now') WHERE id = ?",
                    args: [profileId]
                });
            }

            console.log('');
            await humanDelay(10000, 15000);
        }

        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Instagram Session gespeichert');

        // 📤 Screenshots UND Incidents zu Git pushen
        const { exec } = await import('child_process');
        exec(`cd ${process.cwd()} && git add public/screenshots/ .incidents/ && git commit -m "auto: screenshots + incidents" && git push origin main`,
            (err) => {
                if (!err) console.log('📤 Screenshots & Incidents zu Git gepusht');
                else if (!err?.message?.includes('nothing to commit')) console.log('ℹ️ Keine neuen Dateien');
            });

    } catch (err: any) {
        console.error('\n❌ Fehler:', err.message);
    } finally {
        if (createdLock && fs.existsSync(LOCK_FILE)) {
            try { fs.unlinkSync(LOCK_FILE); } catch { }
        }
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Monitoring abgeschlossen');
    console.log('═'.repeat(60) + '\n');
}

main();

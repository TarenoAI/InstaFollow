/**
 * 🎭 Playwright Instagram Client
 * 
 * Ersetzt instagram-private-api durch echte Browser-Automatisierung
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Pfade
const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');

// Singleton Browser-Instanz
let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
let pageInstance: Page | null = null;

// ============ TYPES ============

export interface ScrapedUser {
    username: string;
    fullName: string;
    profilePicUrl: string;
    isVerified: boolean;
}

export interface ProfileInfo {
    username: string;
    fullName: string;
    profilePicUrl: string;
    followerCount: number;
    followingCount: number;
    isPrivate: boolean;
    isVerified: boolean;
}

export interface ScrapeResult {
    success: boolean;
    profile?: ProfileInfo;
    following?: ScrapedUser[];
    error?: string;
}

// ============ HELPERS ============

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function dismissPopups(page: Page): Promise<void> {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not now")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
                await button.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { /* ignore */ }
    }
}

// ============ BROWSER MANAGEMENT ============

export async function initBrowser(headless: boolean = true): Promise<Page> {
    if (pageInstance) {
        return pageInstance;
    }

    console.log(`🎭 [Playwright] Starte Browser (${headless ? 'headless' : 'sichtbar'})...`);

    browserInstance = await chromium.launch({
        headless,
        slowMo: headless ? 0 : 50,
    });

    // Lade gespeicherte Session falls vorhanden
    let storageState = undefined;
    if (fs.existsSync(SESSION_PATH)) {
        console.log('📂 [Playwright] Lade gespeicherte Session...');
        storageState = SESSION_PATH;
    }

    contextInstance = await browserInstance.newContext({
        storageState,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'de-DE',
    });

    pageInstance = await contextInstance.newPage();
    return pageInstance;
}

export async function closeBrowser(): Promise<void> {
    if (contextInstance) {
        // Session speichern
        await contextInstance.storageState({ path: SESSION_PATH });
        console.log('💾 [Playwright] Session gespeichert');
    }

    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
        contextInstance = null;
        pageInstance = null;
    }
}

// ============ LOGIN ============

export async function isLoggedIn(page: Page): Promise<boolean> {
    try {
        const url = page.url();
        if (url.includes('/accounts/login')) return false;

        // Prüfe auf Home-Icon
        const homeIcon = await page.$('svg[aria-label="Startseite"]') ||
            await page.$('svg[aria-label="Home"]') ||
            await page.$('a[href="/"]');
        return !!homeIcon;
    } catch {
        return false;
    }
}

export async function login(username: string, password: string): Promise<boolean> {
    const page = await initBrowser(false); // Sichtbar für Login

    console.log(`🔐 [Playwright] Login als @${username}...`);

    try {
        await page.goto('https://www.instagram.com/accounts/login/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await humanDelay(2000, 3000);
        await dismissPopups(page);

        // Prüfe ob bereits eingeloggt
        if (await isLoggedIn(page)) {
            console.log('✅ [Playwright] Bereits eingeloggt!');
            return true;
        }

        // Username
        const usernameInput = await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await usernameInput.fill('');
        await usernameInput.type(username, { delay: 80 });
        await humanDelay(500, 1000);

        // Password
        const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 5000 });
        await passwordInput.fill('');
        await passwordInput.type(password, { delay: 80 });
        await humanDelay(500, 1000);

        // Submit
        await dismissPopups(page);
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click({ force: true });

        await humanDelay(5000, 7000);

        // Challenge?
        const currentUrl = page.url();
        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor')) {
            console.log('\n⚠️  [Playwright] Verifizierung erforderlich!');
            console.log('    Bitte löse die Challenge im Browser...\n');

            await page.waitForURL(url => {
                const u = url.toString();
                return !u.includes('challenge') && !u.includes('two_factor') && !u.includes('login');
            }, { timeout: 300000 });
        }

        await dismissPopups(page);

        // Session speichern
        if (contextInstance) {
            await contextInstance.storageState({ path: SESSION_PATH });
        }

        console.log('✅ [Playwright] Login erfolgreich!');
        return true;

    } catch (error: any) {
        console.error('❌ [Playwright] Login fehlgeschlagen:', error.message);
        return false;
    }
}

// ============ PROFILE SCRAPING ============

export async function getProfileInfo(username: string): Promise<ProfileInfo | null> {
    const page = await initBrowser(true);

    console.log(`👤 [Playwright] Lade Profil @${username}...`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await humanDelay(2000, 3000);
        await dismissPopups(page);

        const notFound = await page.$('text="Diese Seite ist leider nicht verfügbar"') ||
            await page.$('text="Sorry, this page isn\'t available"');
        if (notFound && await notFound.isVisible()) {
            console.log(`❌ [Playwright] Profil @${username} nicht gefunden`);
            return null;
        }

        const profileData: ProfileInfo = {
            username,
            fullName: '',
            profilePicUrl: '',
            followerCount: 0,
            followingCount: 0,
            isPrivate: false,
            isVerified: false,
        };

        try {
            const h2 = await page.$('header h2');
            if (h2) {
                const metaTitle = await page.title();
                if (metaTitle.includes('(@')) {
                    profileData.fullName = metaTitle.split('(@')[0].trim();
                }
            }
        } catch { /* ignore */ }

        // Profile pic (kept from original as it's not in the new snippet)
        try {
            const img = await page.$('header img');
            if (img) {
                profileData.profilePicUrl = await img.getAttribute('src') || '';
            }
        } catch { /* ignore */ }

        try {
            const links = await page.$$('header a');
            for (const link of links) {
                const href = await link.getAttribute('href') || '';
                const text = await link.textContent() || '';

                if (href.includes('followers') || text.toLowerCase().includes('follower')) {
                    const match = text.match(/[\d,.]+/);
                    if (match) {
                        const titleVal = await link.$eval('span', el => el.getAttribute('title')).catch(() => null);
                        if (titleVal) {
                            profileData.followerCount = parseInt(titleVal.replace(/[,.]/g, ''));
                        } else {
                            profileData.followerCount = parseInt(match[0].replace(/[,.]/g, ''));
                        }
                    }
                }

                if (href.includes('following') || text.toLowerCase().includes('following') || text.toLowerCase().includes('abonniert')) {
                    const match = text.match(/[\d,.]+/);
                    if (match) {
                        const spanText = await link.$eval('span', el => el.textContent).catch(() => null);
                        if (spanText) {
                            profileData.followingCount = parseInt(spanText.replace(/[,.]/g, ''));
                        } else {
                            profileData.followingCount = parseInt(match[0].replace(/[,.]/g, ''));
                        }
                    }
                }
            }
        } catch (e) {
            console.log('Warnung: Stats nicht über Links gefunden');
        }

        try {
            const privateMsg = await page.$('h2:has-text("This account is private")') ||
                await page.$('h2:has-text("Dieses Konto ist privat")');
            profileData.isPrivate = !!privateMsg;
        } catch { /* ignore */ }

        try {
            const verifiedBadge = await page.$('header svg[aria-label="Verifiziert"]') ||
                await page.$('header svg[aria-label="Verified"]');
            profileData.isVerified = !!verifiedBadge;
        } catch { /* ignore */ }

        console.log(`✅ [Playwright] Profil @${username} geladen`);
        return profileData;

    } catch (error: any) {
        console.error(`❌ [Playwright] Fehler bei @${username}:`, error.message);
        return null;
    }
}

// ============ FOLLOWING LIST SCRAPING ============

// ============ FOLLOWING LIST SCRAPING ============

export async function getFollowingList(
    username: string,
    maxCount: number = 100,
    onProgress?: (count: number) => void
): Promise<ScrapedUser[]> {
    const page = await initBrowser(true);
    const following: ScrapedUser[] = [];

    console.log(`📋 [Playwright] Lade Following-Liste von @${username} (max ${maxCount})...`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await humanDelay(2000, 3000);
        await dismissPopups(page);

        // Following Link klicken
        let clicked = false;

        const directLink = await page.$(`a[href*="/following/"]`);
        if (directLink) {
            await directLink.click();
            clicked = true;
        } else {
            const links = await page.$$('header a');
            for (const link of links) {
                const text = await link.textContent() || '';
                if (text.toLowerCase().includes('following') || text.toLowerCase().includes('abonniert')) {
                    await link.click();
                    clicked = true;
                    break;
                }
            }
        }

        if (!clicked) {
            console.log('⚠️ Following-Link nicht gefunden (vielleicht privat?)');
            return [];
        }

        await humanDelay(3000, 4000);

        // Warte auf Dialog
        const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
        if (!dialog) {
            console.log('⚠️ Dialog hat sich nicht geöffnet');
            return [];
        }

        console.log('📜 [Playwright] Dialog offen, beginne Scrolling...');

        // Fokus auf Dialog für Keyboard Scrolling
        await dialog.click();

        let noNewUsersCount = 0;
        let lastCount = 0;

        while (following.length < maxCount && noNewUsersCount < 10) {

            // User Links im Dialog sammeln
            const userParams = await page.$$eval('[role="dialog"] a[href^="/"][role="link"]', (links) => {
                return links.map(link => {
                    const href = link.getAttribute('href') || '';
                    if (href === '/' || !href) return null;

                    // Versuche Bild zu finden
                    const img = link.closest('div')?.querySelector('img');
                    const src = img?.getAttribute('src') || '';

                    return {
                        username: href.replace(/\//g, ''),
                        profilePicUrl: src
                    };
                }).filter(Boolean);
            });

            // In unsere Liste mergen
            for (const u of userParams) {
                if (u && !following.find(exist => exist.username === u.username)) {
                    following.push({
                        username: u.username,
                        fullName: '',
                        profilePicUrl: u.profilePicUrl,
                        isVerified: false
                    });
                }
            }

            // Progress Log
            if (following.length > lastCount) {
                console.log(`   Gefunden: ${following.length}/${maxCount}`);
                if (onProgress) onProgress(following.length);
                noNewUsersCount = 0;
                lastCount = following.length;
            } else {
                noNewUsersCount++;
                // Kleiner "Ruckler" falls feststeckt
                await page.mouse.wheel(0, -100);
                await humanDelay(500, 1000);
            }

            // Scrolling Action (Mausrad + Keyboard)
            // Maus über Dialog bewegen
            const box = await dialog.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.wheel(0, 800); // Srcoll Down
            }

            await page.keyboard.press('PageDown');

            await humanDelay(1500, 3000);
        }

        // Close Dialog
        await page.keyboard.press('Escape');
        await humanDelay(1000, 2000);

        console.log(`✅ [Playwright] Fertig. ${following.length} Accounts geladen.`);
        return following;

    } catch (error: any) {
        console.error('❌ Fehler beim Listen-Scrape:', error.message);
        return following;
    }
}

// ============ COMPLETE SCRAPE ============

export async function scrapeProfile(username: string, maxFollowing: number = 100): Promise<ScrapeResult> {
    try {
        // Get profile info
        const profile = await getProfileInfo(username);
        if (!profile) {
            return { success: false, error: `Profil @${username} nicht gefunden` };
        }

        // Check if private
        if (profile.isPrivate) {
            return {
                success: false,
                profile,
                error: `Profil @${username} ist privat`
            };
        }

        // Get following list
        const following = await getFollowingList(username, maxFollowing);

        return {
            success: true,
            profile,
            following,
        };

    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

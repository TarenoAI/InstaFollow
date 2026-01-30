/**
 * 🔍 DEBUG MOBILE SCRAPING
 * 
 * Kombinierte Diagnose mit:
 * - Screenshots während des Scrapings
 * - DOM-Elemente Logging
 * - Alternative Scroll-Methoden
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const DEBUG_DIR = path.join(process.cwd(), 'debug-screenshots');
const iPhone = devices['iPhone 13 Pro'];

// Debug-Ordner erstellen
if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function dismissPopups(page: any): Promise<void> {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        'button >> text="Abbrechen"',
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
                await button.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { }
    }
}

/**
 * 🔍 Debug: Analysiere die DOM-Struktur der Following-Liste
 */
async function analyzeFollowingDOM(page: any, scrollNum: number): Promise<{
    totalLinks: number;
    userLinks: number;
    viewportHeight: number;
    scrollHeight: number;
    scrollTop: number;
}> {
    const analysis = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        const userLinks = Array.from(allLinks).filter(a => {
            const href = a.getAttribute('href');
            return href && href.match(/^\/[a-zA-Z0-9._-]+\/?$/) &&
                   !['explore', 'reels', 'direct', 'accounts', 'p', 'stories'].some(x => href!.includes(x));
        });
        
        return {
            totalLinks: allLinks.length,
            userLinks: userLinks.length,
            viewportHeight: window.innerHeight,
            scrollHeight: document.body.scrollHeight,
            scrollTop: window.scrollY
        };
    });
    
    console.log(`      📊 DOM Analysis #${scrollNum}:`);
    console.log(`         Total Links: ${analysis.totalLinks}`);
    console.log(`         User Links: ${analysis.userLinks}`);
    console.log(`         Viewport: ${analysis.viewportHeight}px`);
    console.log(`         Scroll: ${analysis.scrollTop}/${analysis.scrollHeight}px`);
    
    return analysis;
}

/**
 * 🔍 Debug: Extrahiere Following mit detailliertem Logging
 */
async function extractFollowingDebug(page: any, scrollNum: number): Promise<string[]> {
    // Methode 1: Alle Links
    const usernamesFromLinks = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        const users: string[] = [];

        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href.match(/^\/[a-zA-Z0-9._-]+\/?$/) && !href.includes('/accounts/') && !href.includes('/explore/')) {
                const username = href.replace(/\//g, '');
                if (username && !users.includes(username) && username.length > 1) {
                    const isNavLink = ['reels', 'explore', 'direct', 'accounts', 'p', 'stories'].includes(username);
                    if (!isNavLink) {
                        users.push(username);
                    }
                }
            }
        });

        return users;
    });
    
    // Methode 2: Suche nach Role="dialog" und darin enthaltene Links
    const usernamesFromDialog = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return [];
        
        const links = dialog.querySelectorAll('a[role="link"]');
        const users: string[] = [];
        
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                const username = href.replace(/\//g, '');
                if (username && !users.includes(username) && username.length > 1) {
                    users.push(username);
                }
            }
        });
        
        return users;
    });
    
    // Methode 3: Suche nach img-Tags mit alt-Attribut (Profilbilder)
    const usernamesFromImages = await page.evaluate(() => {
        const images = document.querySelectorAll('img[alt*="Profilbild"], img[alt*="profile picture"]');
        const users: string[] = [];
        
        images.forEach(img => {
            const alt = img.getAttribute('alt') || '';
            // Format: "Profilbild von username"
            const match = alt.match(/von\s+(.+)/i) || alt.match(/of\s+(.+)/i);
            if (match && match[1]) {
                const username = match[1].trim();
                if (!users.includes(username)) {
                    users.push(username);
                }
            }
        });
        
        return users;
    });
    
    console.log(`      🔍 Extraction Methods #${scrollNum}:`);
    console.log(`         Links Method: ${usernamesFromLinks.length} users`);
    console.log(`         Dialog Method: ${usernamesFromDialog.length} users`);
    console.log(`         Image Method: ${usernamesFromImages.length} users`);
    
    // Kombiniere alle Methoden
    const allUsernames = new Set([...usernamesFromLinks, ...usernamesFromDialog, ...usernamesFromImages]);
    return Array.from(allUsernames);
}

/**
 * 🔍 Debug: Scrolle mit verschiedenen Methoden
 */
async function scrollWithMethod(page: any, method: 'wheel' | 'touch' | 'keyboard' | 'js'): Promise<void> {
    switch (method) {
        case 'wheel':
            await page.mouse.wheel(0, 600);
            break;
        case 'touch':
            // Simuliere Touch-Swipe
            await page.evaluate(() => {
                const element = document.querySelector('[role="dialog"]') || document.body;
                const touchStart = new TouchEvent('touchstart', {
                    touches: [new Touch({ identifier: 1, target: element, clientX: 200, clientY: 400 })]
                });
                const touchMove = new TouchEvent('touchmove', {
                    touches: [new Touch({ identifier: 1, target: element, clientX: 200, clientY: 100 })]
                });
                const touchEnd = new TouchEvent('touchend', {
                    changedTouches: [new Touch({ identifier: 1, target: element, clientX: 200, clientY: 100 })]
                });
                element.dispatchEvent(touchStart);
                element.dispatchEvent(touchMove);
                element.dispatchEvent(touchEnd);
            });
            break;
        case 'keyboard':
            await page.keyboard.press('PageDown');
            break;
        case 'js':
            await page.evaluate(() => window.scrollBy(0, 600));
            break;
    }
}

/**
 * 🔍 Debug: Haupt-Scraping-Funktion
 */
async function debugScrapeFollowing(page: any, username: string): Promise<string[]> {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 DEBUG SCRAPING @${username}`);
    console.log('─'.repeat(60));

    // Gehe zum Profil
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissPopups(page);
    
    // Screenshot vom Profil
    await page.screenshot({ path: path.join(DEBUG_DIR, `01_profile_${username}.png`) });
    console.log('📸 Screenshot: Profilseite');

    // Klicke auf Following
    console.log('👆 Öffne Following-Liste...');
    try {
        await page.click('a[href*="following"]', { timeout: 10000 });
    } catch {
        await page.click('text=/Abonniert|Following/i');
    }
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(DEBUG_DIR, `02_following_dialog_${username}.png`) });
    console.log('📸 Screenshot: Following-Dialog geöffnet');

    const allUsernames = new Set<string>();
    let noNewCount = 0;
    let scrollCount = 0;
    const maxScrolls = 60;
    
    // Teste verschiedene Scroll-Methoden
    const scrollMethods: Array<'wheel' | 'touch' | 'keyboard' | 'js'> = ['wheel', 'js', 'keyboard'];
    let currentMethodIndex = 0;

    while (scrollCount < maxScrolls && noNewCount < 8) {
        const currentMethod = scrollMethods[currentMethodIndex % scrollMethods.length];
        
        console.log(`\n   ── Scroll ${scrollCount + 1} (Method: ${currentMethod}) ──`);
        
        // 1. DOM analysieren VOR dem Scroll
        await analyzeFollowingDOM(page, scrollCount + 1);
        
        // 2. Extrahiere Usernames
        const current = await extractFollowingDebug(page, scrollCount + 1);
        const previousSize = allUsernames.size;
        
        current.forEach(u => allUsernames.add(u));
        
        console.log(`      📈 Total unique: ${allUsernames.size} (+${allUsernames.size - previousSize})`);
        
        if (allUsernames.size === previousSize) {
            noNewCount++;
            console.log(`      ⚠️ No new users (${noNewCount}/8)`);
        } else {
            noNewCount = 0;
        }
        
        // 3. Scrolle
        await scrollWithMethod(page, currentMethod);
        await humanDelay(2000, 3000); // Länger warten für Lazy Loading
        
        // 4. Screenshot alle 10 Scrolls
        if (scrollCount % 10 === 0) {
            await page.screenshot({ 
                path: path.join(DEBUG_DIR, `03_scroll_${scrollCount}_${username}.png`) 
            });
        }
        
        // 5. Wechsle Scroll-Methode wenn keine neuen User
        if (noNewCount > 2) {
            currentMethodIndex++;
            console.log(`      🔄 Switching to method: ${scrollMethods[currentMethodIndex % scrollMethods.length]}`);
        }
        
        scrollCount++;
    }
    
    // Finaler Screenshot
    await page.screenshot({ path: path.join(DEBUG_DIR, `04_final_${username}.png`) });
    console.log('📸 Screenshot: Final state');

    // Entferne das gescrapte Profil selbst
    allUsernames.delete(username);
    
    const result = Array.from(allUsernames);
    console.log(`\n✅ DEBUG COMPLETE: ${result.length} Following gefunden`);
    
    // Speichere Ergebnis
    fs.writeFileSync(
        path.join(DEBUG_DIR, `result_${username}.json`),
        JSON.stringify({
            username,
            totalFound: result.length,
            usernames: result,
            scrollCount,
            timestamp: new Date().toISOString()
        }, null, 2)
    );
    
    return result;
}

/**
 * 🔍 Debug: Hauptfunktion
 */
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🔍 DEBUG MOBILE SCRAPING');
    console.log('═'.repeat(60));
    console.log(`Debug-Ordner: ${DEBUG_DIR}\n`);

    const browser = await chromium.launch({ 
        headless: false, // Sichtbar für Debugging
        slowMo: 100 
    });
    
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });

    const page = await context.newPage();

    try {
        // Login Check
        console.log('🌐 Prüfe Login...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        if (page.url().includes('login')) {
            console.log('🔐 Login erforderlich - bitte manuell einloggen');
            await page.pause(); // Pause für manuelles Login
        } else {
            console.log('✅ Eingeloggt!');
        }

        // Debug Scrape für morewatchez (hat 168 Following)
        await debugScrapeFollowing(page, 'morewatchez');

        // Session speichern
        await context.storageState({ path: SESSION_PATH });
        
    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🔍 DEBUG COMPLETE');
    console.log(`Screenshots gespeichert in: ${DEBUG_DIR}`);
    console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

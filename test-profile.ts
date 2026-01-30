/**
 * 🔍 Test-Skript für beliebige Profile
 * 
 * Prüft warum ein Account 0 oder weniger Following als erwartet hat
 * Usage: npx tsx test-profile.ts <username>
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

const username = process.argv[2] || 'harrykane';

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

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🔍 TEST @${username}`);
    console.log('═'.repeat(60) + '\n');

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Prüfe aktuellen Status in Turso
    const profileResult = await db.execute({
        sql: 'SELECT id, username, followingCount, isVerified FROM MonitoredProfile WHERE username = ?',
        args: [username]
    });

    if (profileResult.rows.length === 0) {
        console.log(`❌ @${username} nicht in MonitoredProfile gefunden!`);
        console.log('   Füge den Account zuerst in der UI hinzu.');
        return;
    }

    const profileId = profileResult.rows[0].id as string;
    const dbFollowingCount = profileResult.rows[0].followingCount as number;
    
    console.log('📊 Aktueller Status in Turso:');
    console.log(`   Profil ID: ${profileId}`);
    console.log(`   Following Count (DB): ${dbFollowingCount || '?'}`);
    console.log(`   Verifiziert: ${profileResult.rows[0].isVerified ? 'Ja' : 'Nein'}`);

    // Zähle FollowingEntries
    const entriesResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM FollowingEntry WHERE profileId = ?',
        args: [profileId]
    });
    console.log(`   Following Entries: ${entriesResult.rows[0].count}\n`);

    // Browser starten
    console.log('🎭 Starte Browser...');
    const browser = await chromium.launch({ 
        headless: false,
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
        console.log('🌐 Prüfe Instagram Login...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        if (page.url().includes('login')) {
            console.log('❌ NICHT EINGELOGGT!');
            console.log('   Bitte zuerst einloggen mit: npx tsx debug-login.ts');
            await browser.close();
            return;
        }
        console.log('✅ Eingeloggt!\n');

        // Gehe zum Profil
        console.log(`👤 Öffne Profil @${username}...`);
        await page.goto(`https://www.instagram.com/${username}/`, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Screenshot vom Profil
        const screenshotName = `test-${username}-profile.png`;
        await page.screenshot({ path: screenshotName });
        console.log(`📸 Screenshot: ${screenshotName}`);

        // Prüfe auf "Diese Seite ist nicht verfügbar"
        const notFound = await page.$('text="Diese Seite ist leider nicht verfügbar"') ||
                        await page.$('text="Sorry, this page isn\'t available"');
        if (notFound) {
            console.log('❌ Profil nicht gefunden (404)');
            await browser.close();
            return;
        }

        // Extrahiere Profil-Info
        const profileInfo = await page.evaluate(() => {
            const result = {
                followerCount: '',
                followingCount: '',
                isPrivate: false,
                fullName: ''
            };

            // Full Name
            const h2 = document.querySelector('header h2');
            if (h2) result.fullName = h2.textContent || '';

            // Stats
            const links = document.querySelectorAll('a');
            links.forEach(link => {
                const text = link.textContent || '';
                if (text.toLowerCase().includes('follower') || link.href.includes('followers')) {
                    result.followerCount = text;
                }
                if (text.toLowerCase().includes('following') || text.toLowerCase().includes('abonniert') || link.href.includes('following')) {
                    result.followingCount = text;
                }
            });

            // Prüfe auf private
            const privateMsg = document.querySelector('h2');
            if (privateMsg) {
                const text = privateMsg.textContent?.toLowerCase() || '';
                if (text.includes('private') || text.includes('privat')) {
                    result.isPrivate = true;
                }
            }

            return result;
        });

        console.log('\n📊 Profil-Info:');
        console.log(`   Name: ${profileInfo.fullName}`);
        console.log(`   Follower: ${profileInfo.followerCount}`);
        console.log(`   Following: ${profileInfo.followingCount}`);
        console.log(`   Privat: ${profileInfo.isPrivate ? 'Ja 🔒' : 'Nein ✅'}`);

        if (profileInfo.isPrivate) {
            console.log('\n⚠️  Account ist PRIVAT!');
            console.log('   Following-Liste kann nicht gescrapt werden.');
            console.log('   Lösung: Account muss öffentlich sein oder du musst ihm folgen.');
        }

        // Versuche Following-Liste zu öffnen (auch wenn privat, um zu testen)
        console.log('\n👆 Versuche Following-Liste zu öffnen...');
        
        try {
            const followingLink = await page.$('a[href*="following"]');
            if (followingLink) {
                await followingLink.click();
                console.log('✅ Following-Link geklickt');
            } else {
                const followingText = await page.$('text=/following|abonniert/i');
                if (followingText) {
                    await followingText.click();
                    console.log('✅ Following-Text geklickt');
                } else {
                    console.log('❌ Following-Link nicht gefunden!');
                }
            }

            await page.waitForTimeout(3000);
            const dialogScreenshot = `test-${username}-following.png`;
            await page.screenshot({ path: dialogScreenshot });
            console.log(`📸 Screenshot: ${dialogScreenshot}`);

            // Prüfe Dialog
            const dialog = await page.$('[role="dialog"]');
            if (dialog) {
                console.log('✅ Following-Dialog geöffnet');
                
                // Extrahiere Usernames
                const usernames = await page.evaluate(() => {
                    const links = document.querySelectorAll('[role="dialog"] a[href^="/"]');
                    const users: string[] = [];
                    links.forEach(link => {
                        const href = link.getAttribute('href');
                        if (href && href.match(/^\/[a-zA-Z0-9._-]+\/?$/)) {
                            const username = href.replace(/\//g, '');
                            if (username && !['reels', 'explore', 'direct', 'accounts', 'p', 'stories'].includes(username)) {
                                users.push(username);
                            }
                        }
                    });
                    return users;
                });

                if (usernames.length > 0) {
                    console.log(`\n📋 ${usernames.length} Following gefunden:`);
                    usernames.slice(0, 10).forEach((u, i) => console.log(`   ${i + 1}. @${u}`));
                    if (usernames.length > 10) {
                        console.log(`   ... und ${usernames.length - 10} weitere`);
                    }
                } else {
                    console.log('\n⚠️  Keine Following in Dialog gefunden');
                    console.log('   Mögliche Ursachen:');
                    console.log('   - Account ist privat');
                    console.log('   - Liste ist leer');
                    console.log('   - Login erforderlich');
                }
            } else {
                console.log('❌ Kein Dialog geöffnet');
            }

        } catch (err: any) {
            console.log(`❌ Fehler: ${err.message}`);
        }

        // Session speichern
        await context.storageState({ path: SESSION_PATH });
        console.log('\n💾 Session gespeichert');

    } catch (error: any) {
        console.error('❌ Fehler:', error.message);
        await page.screenshot({ path: `test-${username}-error.png` });
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('🔍 TEST COMPLETE');
    console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);

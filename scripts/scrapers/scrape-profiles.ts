/**
 * 🎭 Scrape Multiple Profiles
 * 
 * Scrapt die Following-Listen von mehreren Profilen
 * 
 * Ausführen mit: npx tsx scrape-profiles.ts
 */

import 'dotenv/config';
import {
    initBrowser,
    closeBrowser,
    login,
    isLoggedIn,
    scrapeProfile,
    ScrapeResult
} from '../../src/lib/playwright-instagram';

// 🎯 Diese Profile werden gescrapt:
const PROFILES_TO_SCRAPE = [
    'bvb09',
    'fcbayern',
    'lennart_kl10'
];

// Maximale Anzahl Following pro Profil
const MAX_FOLLOWING_PER_PROFILE = 500;

// Pause zwischen Profilen (Sekunden)
const DELAY_BETWEEN_PROFILES = 30;

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🎭 PLAYWRIGHT INSTAGRAM SCRAPER');
    console.log('═'.repeat(60));
    console.log(`\n📋 Profile: ${PROFILES_TO_SCRAPE.join(', ')}`);
    console.log(`📊 Max Following pro Profil: ${MAX_FOLLOWING_PER_PROFILE}`);
    console.log(`⏱️  Pause zwischen Profilen: ${DELAY_BETWEEN_PROFILES}s\n`);

    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;

    if (!username || !password) {
        console.error('❌ INSTAGRAM_USERNAME und INSTAGRAM_PASSWORD müssen gesetzt sein!');
        return;
    }

    try {
        // Browser starten und einloggen (SICHTBAR damit du es siehst!)
        const page = await initBrowser(false);  // false = sichtbar

        // Prüfe ob bereits eingeloggt
        await page.goto('https://www.instagram.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(5000);

        if (!await isLoggedIn(page)) {
            console.log('\n🔐 Login erforderlich...\n');
            const loginSuccess = await login(username, password);
            if (!loginSuccess) {
                console.error('❌ Login fehlgeschlagen. Beende.');
                await closeBrowser();
                return;
            }
        } else {
            console.log('✅ Bereits eingeloggt (Session geladen)\n');
        }

        // Ergebnis-Sammlung
        const results: { profile: string; result: ScrapeResult }[] = [];

        // Durch alle Profile iterieren
        for (let i = 0; i < PROFILES_TO_SCRAPE.length; i++) {
            const profileName = PROFILES_TO_SCRAPE[i];

            console.log('\n' + '─'.repeat(50));
            console.log(`📍 Profil ${i + 1}/${PROFILES_TO_SCRAPE.length}: @${profileName}`);
            console.log('─'.repeat(50) + '\n');

            const result = await scrapeProfile(profileName, MAX_FOLLOWING_PER_PROFILE);
            results.push({ profile: profileName, result });

            if (result.success) {
                console.log(`\n✅ @${profileName}: ${result.following?.length || 0} Following gefunden`);
            } else {
                console.log(`\n⚠️  @${profileName}: ${result.error}`);
            }

            // Pause zwischen Profilen (außer beim letzten)
            if (i < PROFILES_TO_SCRAPE.length - 1) {
                console.log(`\n⏳ Warte ${DELAY_BETWEEN_PROFILES} Sekunden vor dem nächsten Profil...`);
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_PROFILES * 1000));
            }
        }

        // ═══ ZUSAMMENFASSUNG ═══
        console.log('\n\n' + '═'.repeat(60));
        console.log('📊 ZUSAMMENFASSUNG');
        console.log('═'.repeat(60) + '\n');

        for (const { profile, result } of results) {
            if (result.success && result.profile) {
                console.log(`\n@${profile}:`);
                console.log(`   Name: ${result.profile.fullName || '-'}`);
                console.log(`   Follower: ${result.profile.followerCount}`);
                console.log(`   Following: ${result.profile.followingCount}`);
                console.log(`   Gescrapt: ${result.following?.length || 0} Accounts`);
                console.log(`   Privat: ${result.profile.isPrivate ? 'Ja' : 'Nein'}`);
                console.log(`   Verifiziert: ${result.profile.isVerified ? 'Ja' : 'Nein'}`);

                if (result.following && result.following.length > 0) {
                    console.log(`\n   Erste 10 Following:`);
                    for (const user of result.following.slice(0, 10)) {
                        const verified = user.isVerified ? ' ✓' : '';
                        console.log(`     • @${user.username}${verified} ${user.fullName ? `(${user.fullName})` : ''}`);
                    }
                    if (result.following.length > 10) {
                        console.log(`     ... und ${result.following.length - 10} weitere`);
                    }
                }
            } else {
                console.log(`\n@${profile}: ❌ ${result.error}`);
            }
        }

        // Browser schließen
        console.log('\n\n⏳ Browser schließt in 5 Sekunden...');
        await new Promise(r => setTimeout(r, 5000));
        await closeBrowser();

        console.log('\n✅ Scraping abgeschlossen!\n');

    } catch (error) {
        console.error('❌ Fehler:', error);
        await closeBrowser();
    }
}

main();

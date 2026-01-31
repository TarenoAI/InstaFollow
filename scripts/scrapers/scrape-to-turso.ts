/**
 * 🎭 Scrape direkt zu Turso
 * 
 * Scrapt Profile und speichert direkt in Turso Cloud
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import {
    initBrowser,
    closeBrowser,
    login,
    isLoggedIn,
    getProfileInfo,
    getFollowingList
} from '../../src/lib/playwright-instagram';

// Profile zum Testen
const TEST_PROFILES = ['bvb09', 'fcbayern', 'lennart_kl10'];
const SET_NAME = 'Test Set';

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🎭 SCRAPE DIREKT ZU TURSO');
    console.log('═'.repeat(60) + '\n');

    // Connect to Turso
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
        console.error('❌ TURSO_DATABASE_URL und TURSO_AUTH_TOKEN müssen gesetzt sein!');
        return;
    }

    console.log(`🔗 Verbinde mit Turso: ${tursoUrl}\n`);

    const db = createClient({
        url: tursoUrl,
        authToken: tursoToken
    });

    try {
        // ═══ STEP 1: Schema vorbereiten ═══
        console.log('📦 Schritt 1: Schema prüfen...\n');

        // Prüfe ob ProfileSet existiert
        const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('   Tabellen in Turso:', tables.rows.map(r => r.name).join(', '));

        // ═══ STEP 2: ProfileSet erstellen ═══
        console.log('\n📦 Schritt 2: Erstelle ProfileSet...\n');

        // Lösche altes Set falls vorhanden
        await db.execute({ sql: "DELETE FROM FollowingEntry WHERE profileId IN (SELECT id FROM MonitoredProfile WHERE setId IN (SELECT id FROM ProfileSet WHERE name = ?))", args: [SET_NAME] });
        await db.execute({ sql: "DELETE FROM MonitoredProfile WHERE setId IN (SELECT id FROM ProfileSet WHERE name = ?)", args: [SET_NAME] });
        await db.execute({ sql: "DELETE FROM ProfileSet WHERE name = ?", args: [SET_NAME] });

        const setId = `set_${Date.now()}`;
        await db.execute({
            sql: "INSERT INTO ProfileSet (id, name, isActive, createdAt, updatedAt) VALUES (?, ?, 1, datetime('now'), datetime('now'))",
            args: [setId, SET_NAME]
        });
        console.log(`   ✅ ProfileSet "${SET_NAME}" erstellt (ID: ${setId})`);

        // ═══ STEP 3: Profile erstellen ═══
        console.log('\n📦 Schritt 3: Erstelle MonitoredProfiles...\n');

        const profileIds: { [key: string]: string } = {};

        for (const username of TEST_PROFILES) {
            const profileId = `profile_${username}_${Date.now()}`;
            await db.execute({
                sql: "INSERT INTO MonitoredProfile (id, username, setId, createdAt, updatedAt) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                args: [profileId, username, setId]
            });
            profileIds[username] = profileId;
            console.log(`   ✅ @${username} erstellt`);
        }

        // ═══ STEP 4: Browser starten und einloggen ═══
        console.log('\n📦 Schritt 4: Browser starten...\n');

        const page = await initBrowser(false); // sichtbar
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (!await isLoggedIn(page)) {
            const username = process.env.INSTAGRAM_USERNAME;
            const password = process.env.INSTAGRAM_PASSWORD;
            if (username && password) {
                console.log('   🔐 Login erforderlich...');
                await login(username, password);
            }
        } else {
            console.log('   ✅ Bereits eingeloggt');
        }

        // ═══ STEP 5: Scrape und speichere ═══
        console.log('\n📦 Schritt 5: Scrape Profile...\n');

        for (const username of TEST_PROFILES) {
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`📊 @${username}`);
            console.log('─'.repeat(50));

            try {
                // Profil-Info holen
                const profileInfo = await getProfileInfo(username);
                if (profileInfo) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET 
                              fullName = ?, profilePicUrl = ?, followerCount = ?, followingCount = ?, 
                              isPrivate = ?, isVerified = ?, lastCheckedAt = datetime('now'), updatedAt = datetime('now')
                              WHERE id = ?`,
                        args: [
                            profileInfo.fullName || null,
                            profileInfo.profilePicUrl || null,
                            profileInfo.followerCount || 0,
                            profileInfo.followingCount || 0,
                            profileInfo.isPrivate ? 1 : 0,
                            profileInfo.isVerified ? 1 : 0,
                            profileIds[username]
                        ]
                    });
                }

                // Following-Liste scrapen
                const following = await getFollowingList(username, 500);
                console.log(`   Gefunden: ${following.length} Following`);

                // In Turso speichern
                for (let i = 0; i < following.length; i++) {
                    const user = following[i];
                    await db.execute({
                        sql: `INSERT INTO FollowingEntry 
                              (id, username, fullName, profilePicUrl, isVerified, position, lastSeenAt, missedScans, profileId, addedAt) 
                              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 0, ?, datetime('now'))`,
                        args: [
                            `entry_${Date.now()}_${i}`,
                            user.username,
                            user.fullName || null,
                            user.profilePicUrl || null,
                            user.isVerified ? 1 : 0,
                            i,
                            profileIds[username]
                        ]
                    });
                }

                console.log(`   ✅ ${following.length} Following in Turso gespeichert`);

            } catch (error: any) {
                console.log(`   ❌ Fehler: ${error.message}`);
            }

            // Pause zwischen Profilen
            if (TEST_PROFILES.indexOf(username) < TEST_PROFILES.length - 1) {
                console.log('\n   ⏳ Warte 30 Sekunden...');
                await new Promise(r => setTimeout(r, 30000));
            }
        }

        await closeBrowser();

        // ═══ STEP 6: Verify ═══
        console.log('\n\n' + '═'.repeat(60));
        console.log('📊 TURSO ZUSAMMENFASSUNG');
        console.log('═'.repeat(60));

        const profileCount = await db.execute('SELECT COUNT(*) as count FROM MonitoredProfile');
        const entryCount = await db.execute('SELECT COUNT(*) as count FROM FollowingEntry');

        console.log(`\n   Profile in Turso: ${profileCount.rows[0].count}`);
        console.log(`   Following-Einträge: ${entryCount.rows[0].count}`);

        // Details pro Profil
        for (const username of TEST_PROFILES) {
            const count = await db.execute({
                sql: 'SELECT COUNT(*) as count FROM FollowingEntry WHERE profileId = ?',
                args: [profileIds[username]]
            });
            console.log(`   @${username}: ${count.rows[0].count} Following`);
        }

        console.log('\n✅ Fertig! Daten sind jetzt in Turso.\n');

    } catch (error) {
        console.error('\n❌ Fehler:', error);
        await closeBrowser();
    }
}

main();

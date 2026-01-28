/**
 * 🎭 Test Smart Monitoring v2
 * 
 * Testet die neue Playwright-basierte Monitoring-Logik
 * 
 * Ausführen mit: npx tsx test-smart-monitoring.ts
 */

import 'dotenv/config';
import { prisma } from './src/lib/prisma';
import {
    initBrowser,
    closeBrowser,
    login,
    isLoggedIn,
    getProfileInfo,
    getFollowingList
} from './src/lib/playwright-instagram';

// Profile zum Testen
const TEST_PROFILES = ['bvb09', 'fcbayern', 'lennart_kl10'];
const SET_NAME = 'Test Set';

async function setupTestData() {
    console.log('📦 Erstelle Test-Daten...\n');

    // Erstelle oder finde das Profile Set
    let profileSet = await prisma.profileSet.findUnique({
        where: { name: SET_NAME }
    });

    if (!profileSet) {
        profileSet = await prisma.profileSet.create({
            data: { name: SET_NAME, isActive: true }
        });
        console.log(`   ✅ Profile Set "${SET_NAME}" erstellt`);
    } else {
        console.log(`   ℹ️ Profile Set "${SET_NAME}" existiert bereits`);
    }

    // Füge Test-Profile hinzu
    for (const username of TEST_PROFILES) {
        const existing = await prisma.monitoredProfile.findFirst({
            where: { setId: profileSet.id, username }
        });

        if (!existing) {
            await prisma.monitoredProfile.create({
                data: {
                    username,
                    setId: profileSet.id
                }
            });
            console.log(`   ✅ Profil @${username} hinzugefügt`);
        } else {
            console.log(`   ℹ️ Profil @${username} existiert bereits`);
        }
    }

    return profileSet;
}

async function runInitialScans() {
    console.log('\n🔍 Führe Initial Scans durch...\n');

    const profiles = await prisma.monitoredProfile.findMany({
        where: {
            set: { name: SET_NAME }
        },
        include: { followingList: true }
    });

    // Browser vorbereiten und einloggen
    const page = await initBrowser(false); // sichtbar
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    if (!await isLoggedIn(page)) {
        const username = process.env.INSTAGRAM_USERNAME;
        const password = process.env.INSTAGRAM_PASSWORD;
        if (username && password) {
            console.log('🔐 Login erforderlich...\n');
            await login(username, password);
        }
    } else {
        console.log('✅ Bereits eingeloggt\n');
    }

    for (const profile of profiles) {
        // Nur wenn noch keine Following-Einträge vorhanden
        if (profile.followingList.length === 0) {
            console.log(`\n📊 Initial Scan für @${profile.username}...`);

            try {
                // Profil-Info holen
                const profileInfo = await getProfileInfo(profile.username);
                if (profileInfo) {
                    await prisma.monitoredProfile.update({
                        where: { id: profile.id },
                        data: {
                            fullName: profileInfo.fullName || profile.fullName,
                            profilePicUrl: profileInfo.profilePicUrl || profile.profilePicUrl,
                            followerCount: profileInfo.followerCount || profile.followerCount,
                            followingCount: profileInfo.followingCount || profile.followingCount,
                            isPrivate: profileInfo.isPrivate,
                            isVerified: profileInfo.isVerified
                        }
                    });
                }

                // Following-Liste scrapen
                const following = await getFollowingList(profile.username, 500);

                if (following.length === 0) {
                    console.log(`   ⚠️ Keine Following gefunden für @${profile.username}`);
                    continue;
                }

                console.log(`   Gefunden: ${following.length} Following`);

                // Alle in DB speichern
                for (let i = 0; i < following.length; i++) {
                    const user = following[i];

                    await prisma.followingEntry.upsert({
                        where: {
                            profileId_username: {
                                profileId: profile.id,
                                username: user.username
                            }
                        },
                        update: {
                            position: i,
                            lastSeenAt: new Date(),
                            missedScans: 0,
                            fullName: user.fullName || undefined,
                            profilePicUrl: user.profilePicUrl || undefined,
                            isVerified: user.isVerified || false
                        },
                        create: {
                            username: user.username,
                            fullName: user.fullName || null,
                            profilePicUrl: user.profilePicUrl || null,
                            isVerified: user.isVerified || false,
                            position: i,
                            lastSeenAt: new Date(),
                            missedScans: 0,
                            profileId: profile.id
                        }
                    });
                }

                await prisma.monitoredProfile.update({
                    where: { id: profile.id },
                    data: { lastCheckedAt: new Date() }
                });

                console.log(`   ✅ ${following.length} Following gespeichert`);

            } catch (error: any) {
                console.log(`   ❌ Fehler: ${error.message}`);
            }

            // Pause zwischen Profilen
            if (profiles.indexOf(profile) < profiles.length - 1) {
                console.log('   ⏳ Warte 30 Sekunden...');
                await new Promise(r => setTimeout(r, 30000));
            }
        } else {
            console.log(`   ℹ️ @${profile.username} hat bereits ${profile.followingList.length} Einträge`);
        }
    }

    await closeBrowser();
}

async function showSummary() {
    console.log('\n\n' + '═'.repeat(60));
    console.log('📊 DATENBANK ZUSAMMENFASSUNG');
    console.log('═'.repeat(60));

    const profiles = await prisma.monitoredProfile.findMany({
        where: { set: { name: SET_NAME } },
        include: { followingList: true }
    });

    for (const profile of profiles) {
        console.log(`\n@${profile.username}:`);
        console.log(`   Following in DB: ${profile.followingList.length}`);
        console.log(`   Zuletzt gescannt: ${profile.lastCheckedAt?.toLocaleString() || 'Nie'}`);

        if (profile.followingList.length > 0) {
            console.log(`   Erste 5 Einträge:`);
            for (const entry of profile.followingList.slice(0, 5)) {
                console.log(`     • @${entry.username} (Pos: ${entry.position})`);
            }
        }
    }
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🧪 SMART MONITORING TEST v2');
    console.log('═'.repeat(60) + '\n');

    try {
        // 1. Test-Daten erstellen
        await setupTestData();

        // 2. Initial Scans durchführen
        await runInitialScans();

        // 3. Zusammenfassung zeigen
        await showSummary();

        console.log('\n✅ Test abgeschlossen!\n');

    } catch (error) {
        console.error('\n❌ Fehler:', error);
        await closeBrowser();
    } finally {
        await prisma.$disconnect();
    }
}

main();

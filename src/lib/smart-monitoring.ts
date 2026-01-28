/**
 * 🎭 Playwright-basiertes Smart Monitoring
 * 
 * Kombiniert:
 * 1. Positions-basierte Erkennung
 * 2. Sofort-Bestätigung bei verdächtigen Unfollows
 */

import { prisma } from './prisma';
import {
    initBrowser,
    closeBrowser,
    getFollowingList,
    getProfileInfo,
    ScrapedUser,
    login,
    isLoggedIn
} from './playwright-instagram';

// ============ TYPES ============

export interface MonitoringResult {
    profileId: string;
    username: string;
    success: boolean;
    totalScraped: number;
    newFollows: string[];
    confirmedUnfollows: string[];
    pendingUnfollows: string[];
    error?: string;
}

// ============ SMART MONITORING ============

export async function monitorProfile(profileId: string): Promise<MonitoringResult> {
    // Lade Profil aus DB
    const profile = await prisma.monitoredProfile.findUnique({
        where: { id: profileId },
        include: { followingList: true }
    });

    if (!profile) {
        return {
            profileId,
            username: 'unknown',
            success: false,
            totalScraped: 0,
            newFollows: [],
            confirmedUnfollows: [],
            pendingUnfollows: [],
            error: 'Profil nicht gefunden'
        };
    }

    console.log(`\n📊 [Monitor] Starte Monitoring für @${profile.username}...`);

    const result: MonitoringResult = {
        profileId,
        username: profile.username,
        success: false,
        totalScraped: 0,
        newFollows: [],
        confirmedUnfollows: [],
        pendingUnfollows: []
    };

    try {
        // Scrape aktuelle Following-Liste
        const currentFollowing = await getFollowingList(profile.username, 500);
        result.totalScraped = currentFollowing.length;

        if (currentFollowing.length === 0) {
            result.error = 'Keine Following gefunden (Profil privat?)';
            return result;
        }

        console.log(`   Gescrapt: ${currentFollowing.length} Accounts`);

        // Erstelle Sets für schnellen Vergleich
        const currentUsernames = new Set(currentFollowing.map(u => u.username));
        const existingUsernames = new Set(profile.followingList.map(e => e.username));

        // ═══ NEUE FOLLOWS ERKENNEN ═══
        for (let i = 0; i < currentFollowing.length; i++) {
            const user = currentFollowing[i];

            if (!existingUsernames.has(user.username)) {
                // Neuer Follow!
                result.newFollows.push(user.username);

                // In DB speichern
                await prisma.followingEntry.create({
                    data: {
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

                // Change Event erstellen
                await prisma.changeEvent.create({
                    data: {
                        type: 'FOLLOW',
                        targetUsername: user.username,
                        targetFullName: user.fullName || null,
                        targetPicUrl: user.profilePicUrl || null,
                        isConfirmed: true,
                        profileId: profile.id
                    }
                });

                console.log(`   ✅ Neuer Follow: @${user.username}`);
            } else {
                // Existiert bereits - Update Position und lastSeenAt
                await prisma.followingEntry.updateMany({
                    where: { profileId: profile.id, username: user.username },
                    data: {
                        position: i,
                        lastSeenAt: new Date(),
                        missedScans: 0  // Reset missed scans
                    }
                });
            }
        }

        // ═══ UNFOLLOWS ERKENNEN (SMART) ═══
        for (const entry of profile.followingList) {
            if (!currentUsernames.has(entry.username)) {
                // Nicht in aktueller Liste!

                // Prüfe: War die Position erreichbar?
                // Wenn wir z.B. 200 geladen haben und Entry war bei Position 150, sollten wir es gesehen haben
                const wasReachable = entry.position < result.totalScraped * 0.9; // 90% Toleranz

                if (wasReachable) {
                    // Position war erreichbar aber Entry fehlt

                    if (entry.missedScans >= 1) {
                        // Zweites Mal gefehlt -> Bestätigter Unfollow!
                        result.confirmedUnfollows.push(entry.username);

                        // Aus Following-Liste entfernen
                        await prisma.followingEntry.delete({
                            where: { id: entry.id }
                        });

                        // Change Event erstellen
                        await prisma.changeEvent.create({
                            data: {
                                type: 'UNFOLLOW',
                                targetUsername: entry.username,
                                targetFullName: entry.fullName || null,
                                targetPicUrl: entry.profilePicUrl || null,
                                isConfirmed: true,
                                confirmedAt: new Date(),
                                profileId: profile.id
                            }
                        });

                        console.log(`   ❌ Bestätigter Unfollow: @${entry.username}`);
                    } else {
                        // Erstes Mal gefehlt -> Als Pending markieren
                        result.pendingUnfollows.push(entry.username);

                        await prisma.followingEntry.update({
                            where: { id: entry.id },
                            data: { missedScans: entry.missedScans + 1 }
                        });

                        console.log(`   ⚠️ Möglicherweise Unfollow: @${entry.username} (Bestätigung ausstehend)`);
                    }
                } else {
                    // Position war außerhalb des Scan-Bereichs - nicht werten
                    console.log(`   ℹ️ @${entry.username} war außerhalb des Scan-Bereichs (Pos: ${entry.position})`);
                }
            }
        }

        // ═══ SOFORT-BESTÄTIGUNG FÜR PENDING UNFOLLOWS ═══
        if (result.pendingUnfollows.length > 0) {
            console.log(`\n   🔄 Starte Sofort-Bestätigung für ${result.pendingUnfollows.length} verdächtige Unfollows...`);

            // Warte 30 Sekunden
            await new Promise(r => setTimeout(r, 30000));

            // Zweiter Scan
            const confirmationScan = await getFollowingList(profile.username, 500);
            const confirmationUsernames = new Set(confirmationScan.map(u => u.username));

            for (const pendingUsername of [...result.pendingUnfollows]) {
                if (!confirmationUsernames.has(pendingUsername)) {
                    // Immer noch nicht da -> Bestätigter Unfollow!
                    result.confirmedUnfollows.push(pendingUsername);
                    result.pendingUnfollows = result.pendingUnfollows.filter(u => u !== pendingUsername);

                    // Entry löschen und Event erstellen
                    await prisma.followingEntry.deleteMany({
                        where: { profileId: profile.id, username: pendingUsername }
                    });

                    const entry = profile.followingList.find(e => e.username === pendingUsername);
                    await prisma.changeEvent.create({
                        data: {
                            type: 'UNFOLLOW',
                            targetUsername: pendingUsername,
                            targetFullName: entry?.fullName || null,
                            targetPicUrl: entry?.profilePicUrl || null,
                            isConfirmed: true,
                            confirmedAt: new Date(),
                            profileId: profile.id
                        }
                    });

                    console.log(`   ❌ Bestätigt nach 2. Scan: @${pendingUsername}`);
                } else {
                    // Doch gefunden -> War nur nicht geladen
                    result.pendingUnfollows = result.pendingUnfollows.filter(u => u !== pendingUsername);

                    await prisma.followingEntry.updateMany({
                        where: { profileId: profile.id, username: pendingUsername },
                        data: { missedScans: 0, lastSeenAt: new Date() }
                    });

                    console.log(`   ✓ Fehlalarm: @${pendingUsername} ist doch noch da`);
                }
            }
        }

        // Update lastCheckedAt
        await prisma.monitoredProfile.update({
            where: { id: profile.id },
            data: { lastCheckedAt: new Date() }
        });

        result.success = true;

        console.log(`\n   📊 Zusammenfassung @${profile.username}:`);
        console.log(`      Gescrapt: ${result.totalScraped}`);
        console.log(`      Neue Follows: ${result.newFollows.length}`);
        console.log(`      Bestätigte Unfollows: ${result.confirmedUnfollows.length}`);

    } catch (error: any) {
        result.error = error.message;
        console.error(`   ❌ Fehler: ${error.message}`);
    }

    return result;
}

// ═══ BATCH MONITORING ═══

export async function monitorAllActiveProfiles(): Promise<MonitoringResult[]> {
    console.log('\n' + '═'.repeat(60));
    console.log('🎭 PLAYWRIGHT SMART MONITORING');
    console.log('═'.repeat(60));

    const results: MonitoringResult[] = [];

    try {
        // Lade alle aktiven Profile
        const profiles = await prisma.monitoredProfile.findMany({
            where: {
                set: { isActive: true }
            },
            include: { set: true }
        });

        if (profiles.length === 0) {
            console.log('\n⚠️ Keine aktiven Profile zum Monitoren gefunden.');
            return results;
        }

        console.log(`\n📋 ${profiles.length} Profile zu monitoren\n`);

        // Browser initialisieren
        const page = await initBrowser(true); // headless = true für Batch

        // Prüfe Login
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (!await isLoggedIn(page)) {
            const username = process.env.INSTAGRAM_USERNAME;
            const password = process.env.INSTAGRAM_PASSWORD;

            if (!username || !password) {
                throw new Error('Instagram Credentials fehlen');
            }

            const loginSuccess = await login(username, password);
            if (!loginSuccess) {
                throw new Error('Login fehlgeschlagen');
            }
        }

        // Durch alle Profile iterieren
        for (let i = 0; i < profiles.length; i++) {
            const profile = profiles[i];

            console.log(`\n${'─'.repeat(50)}`);
            console.log(`📍 Profil ${i + 1}/${profiles.length}: @${profile.username}`);
            console.log('─'.repeat(50));

            const result = await monitorProfile(profile.id);
            results.push(result);

            // Pause zwischen Profilen (außer beim letzten)
            if (i < profiles.length - 1) {
                const delay = 60 + Math.random() * 60; // 60-120 Sekunden
                console.log(`\n⏳ Warte ${Math.round(delay)} Sekunden...`);
                await new Promise(r => setTimeout(r, delay * 1000));
            }
        }

        await closeBrowser();

    } catch (error: any) {
        console.error('\n❌ Monitoring Fehler:', error.message);
        await closeBrowser();
    }

    // Zusammenfassung
    console.log('\n\n' + '═'.repeat(60));
    console.log('📊 MONITORING ZUSAMMENFASSUNG');
    console.log('═'.repeat(60));

    let totalNewFollows = 0;
    let totalUnfollows = 0;

    for (const r of results) {
        totalNewFollows += r.newFollows.length;
        totalUnfollows += r.confirmedUnfollows.length;

        console.log(`\n@${r.username}:`);
        console.log(`   Status: ${r.success ? '✅' : '❌'}`);
        console.log(`   Neue Follows: ${r.newFollows.length}`);
        console.log(`   Unfollows: ${r.confirmedUnfollows.length}`);
        if (r.error) console.log(`   Fehler: ${r.error}`);
    }

    console.log(`\n📈 GESAMT: ${totalNewFollows} neue Follows, ${totalUnfollows} Unfollows\n`);

    return results;
}

// ═══ INITIAL SCAN ═══
// Für neue Profile: Erstmal alle Following speichern ohne Änderungen zu tracken

export async function initialScan(profileId: string): Promise<{ success: boolean; count: number; error?: string }> {
    const profile = await prisma.monitoredProfile.findUnique({
        where: { id: profileId }
    });

    if (!profile) {
        return { success: false, count: 0, error: 'Profil nicht gefunden' };
    }

    console.log(`\n🔍 [Initial Scan] @${profile.username}...`);

    try {
        // Browser init
        const page = await initBrowser(true);
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (!await isLoggedIn(page)) {
            const username = process.env.INSTAGRAM_USERNAME;
            const password = process.env.INSTAGRAM_PASSWORD;
            if (username && password) {
                await login(username, password);
            }
        }

        // Profil-Info holen
        const profileInfo = await getProfileInfo(profile.username);
        if (profileInfo) {
            await prisma.monitoredProfile.update({
                where: { id: profileId },
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
            await closeBrowser();
            return { success: false, count: 0, error: 'Keine Following gefunden' };
        }

        // Alle in DB speichern (ohne Change Events)
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
            where: { id: profileId },
            data: { lastCheckedAt: new Date() }
        });

        await closeBrowser();

        console.log(`   ✅ Initial Scan abgeschlossen: ${following.length} Following gespeichert`);
        return { success: true, count: following.length };

    } catch (error: any) {
        await closeBrowser();
        return { success: false, count: 0, error: error.message };
    }
}

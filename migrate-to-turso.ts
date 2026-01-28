/**
 * Migrate Local SQLite to Turso
 * 
 * 1. Updates Turso schema with new fields
 * 2. Exports data from local SQLite
 * 3. Imports data to Turso
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import path from 'path';

const LOCAL_DB_PATH = path.join(process.cwd(), 'prisma', 'dev.db');

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🔄 MIGRATION: Local SQLite → Turso');
    console.log('═'.repeat(60) + '\n');

    // Connect to Turso
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoToken = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoToken) {
        console.error('❌ TURSO_DATABASE_URL und TURSO_AUTH_TOKEN müssen gesetzt sein!');
        return;
    }

    console.log(`🔗 Verbinde mit Turso: ${tursoUrl}\n`);

    const turso = createClient({
        url: tursoUrl,
        authToken: tursoToken
    });

    // Connect to local SQLite
    console.log(`📂 Öffne lokale DB: ${LOCAL_DB_PATH}\n`);
    const local = new Database(LOCAL_DB_PATH);

    try {
        // ═══ STEP 1: Update Turso Schema ═══
        console.log('📦 Schritt 1: Aktualisiere Turso-Schema...\n');

        // Add new columns to FollowingEntry (if they don't exist)
        const alterQueries = [
            `ALTER TABLE FollowingEntry ADD COLUMN position INTEGER DEFAULT 0`,
            `ALTER TABLE FollowingEntry ADD COLUMN lastSeenAt TEXT DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE FollowingEntry ADD COLUMN missedScans INTEGER DEFAULT 0`,
            `ALTER TABLE ChangeEvent ADD COLUMN isConfirmed INTEGER DEFAULT 1`,
            `ALTER TABLE ChangeEvent ADD COLUMN confirmedAt TEXT`,
        ];

        for (const sql of alterQueries) {
            try {
                await turso.execute(sql);
                console.log(`   ✅ ${sql.substring(0, 60)}...`);
            } catch (error: any) {
                if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
                    console.log(`   ℹ️ Spalte existiert bereits: ${sql.substring(27, 50)}`);
                } else {
                    console.log(`   ⚠️ ${error.message}`);
                }
            }
        }

        // ═══ STEP 2: Clear existing Turso data ═══
        console.log('\n📦 Schritt 2: Lösche alte Turso-Daten...\n');

        await turso.execute('DELETE FROM ChangeEvent');
        await turso.execute('DELETE FROM FollowingEntry');
        await turso.execute('DELETE FROM MonitoredProfile');
        await turso.execute('DELETE FROM ProfileSet');
        await turso.execute('DELETE FROM AppConfig');
        console.log('   ✅ Alte Daten gelöscht');

        // ═══ STEP 3: Export & Import ProfileSets ═══
        console.log('\n📦 Schritt 3: Migriere ProfileSets...\n');

        const profileSets = local.prepare('SELECT * FROM ProfileSet').all() as any[];
        console.log(`   Gefunden: ${profileSets.length} ProfileSets`);

        for (const set of profileSets) {
            await turso.execute({
                sql: `INSERT INTO ProfileSet (id, name, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
                args: [set.id, set.name, set.isActive, set.createdAt, set.updatedAt]
            });
        }
        console.log(`   ✅ ${profileSets.length} ProfileSets migriert`);

        // ═══ STEP 4: Export & Import MonitoredProfiles ═══
        console.log('\n📦 Schritt 4: Migriere MonitoredProfiles...\n');

        const profiles = local.prepare('SELECT * FROM MonitoredProfile').all() as any[];
        console.log(`   Gefunden: ${profiles.length} Profile`);

        for (const p of profiles) {
            await turso.execute({
                sql: `INSERT INTO MonitoredProfile (id, username, fullName, profilePicUrl, isPrivate, isVerified, followerCount, followingCount, lastCheckedAt, createdAt, updatedAt, setId) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [p.id, p.username, p.fullName, p.profilePicUrl, p.isPrivate, p.isVerified, p.followerCount, p.followingCount, p.lastCheckedAt, p.createdAt, p.updatedAt, p.setId]
            });
        }
        console.log(`   ✅ ${profiles.length} Profile migriert`);

        // ═══ STEP 5: Export & Import FollowingEntries ═══
        console.log('\n📦 Schritt 5: Migriere FollowingEntries...\n');

        const entries = local.prepare('SELECT * FROM FollowingEntry').all() as any[];
        console.log(`   Gefunden: ${entries.length} Einträge`);

        let count = 0;
        for (const e of entries) {
            await turso.execute({
                sql: `INSERT INTO FollowingEntry (id, username, fullName, profilePicUrl, isPrivate, isVerified, addedAt, position, lastSeenAt, missedScans, profileId) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [e.id, e.username, e.fullName, e.profilePicUrl, e.isPrivate, e.isVerified, e.addedAt, e.position || 0, e.lastSeenAt, e.missedScans || 0, e.profileId]
            });
            count++;
            if (count % 50 === 0) {
                console.log(`   ... ${count}/${entries.length} migriert`);
            }
        }
        console.log(`   ✅ ${entries.length} Following-Einträge migriert`);

        // ═══ STEP 6: Verify ═══
        console.log('\n📦 Schritt 6: Verifiziere...\n');

        const tursoProfiles = await turso.execute('SELECT COUNT(*) as count FROM MonitoredProfile');
        const tursoEntries = await turso.execute('SELECT COUNT(*) as count FROM FollowingEntry');

        console.log(`   Turso MonitoredProfiles: ${tursoProfiles.rows[0].count}`);
        console.log(`   Turso FollowingEntries: ${tursoEntries.rows[0].count}`);

        console.log('\n' + '═'.repeat(60));
        console.log('✅ MIGRATION ABGESCHLOSSEN!');
        console.log('═'.repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Fehler:', error);
    } finally {
        local.close();
    }
}

main();

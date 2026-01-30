/**
 * Fix MonitoredProfile table - make setId nullable for M:N migration
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

async function fix() {
    console.log('🔄 Fixing MonitoredProfile table for M:N...\n');

    try {
        // SQLite doesn't support ALTER COLUMN, so we need to recreate the table

        // 1. Create new table without setId
        console.log('1. Creating new table structure...');
        await db.execute(`
            CREATE TABLE IF NOT EXISTS MonitoredProfile_new (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                fullName TEXT,
                profilePicUrl TEXT,
                isPrivate INTEGER DEFAULT 0,
                isVerified INTEGER DEFAULT 0,
                followerCount INTEGER,
                followingCount INTEGER,
                lastCheckedAt TEXT,
                createdAt TEXT DEFAULT (datetime('now')),
                updatedAt TEXT DEFAULT (datetime('now'))
            )
        `);

        // 2. Copy data
        console.log('2. Copying data...');
        await db.execute(`
            INSERT OR IGNORE INTO MonitoredProfile_new 
            SELECT id, username, fullName, profilePicUrl, isPrivate, isVerified, 
                   followerCount, followingCount, lastCheckedAt, createdAt, updatedAt
            FROM MonitoredProfile
        `);

        // 3. Drop old table
        console.log('3. Dropping old table...');
        await db.execute(`DROP TABLE MonitoredProfile`);

        // 4. Rename new table
        console.log('4. Renaming new table...');
        await db.execute(`ALTER TABLE MonitoredProfile_new RENAME TO MonitoredProfile`);

        // 5. Verify
        const count = await db.execute(`SELECT COUNT(*) as c FROM MonitoredProfile`);
        console.log(`\n✅ Done! ${count.rows[0].c} profiles migrated.`);

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

fix();

/**
 * Migration: Add screenshotUrl and TwitterAccount support
 * 
 * Run: npx tsx migrate-add-columns.ts
 */

import { createClient } from '@libsql/client';
import 'dotenv/config';

async function migrate() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    console.log('🔄 Starting migration...\n');

    try {
        // 1. Add screenshotUrl to MonitoredProfile
        console.log('1️⃣ Adding screenshotUrl column to MonitoredProfile...');
        try {
            await db.execute('ALTER TABLE MonitoredProfile ADD COLUMN screenshotUrl TEXT');
            console.log('   ✅ screenshotUrl column added');
        } catch (e: any) {
            if (e.message?.includes('duplicate column')) {
                console.log('   ℹ️  screenshotUrl column already exists');
            } else {
                throw e;
            }
        }

        // 2. Create TwitterAccount table
        console.log('\n2️⃣ Creating TwitterAccount table...');
        try {
            await db.execute(`
                CREATE TABLE IF NOT EXISTS TwitterAccount (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    displayName TEXT,
                    sessionPath TEXT,
                    isActive INTEGER DEFAULT 1,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                )
            `);
            console.log('   ✅ TwitterAccount table created');
        } catch (e: any) {
            if (e.message?.includes('already exists')) {
                console.log('   ℹ️  TwitterAccount table already exists');
            } else {
                throw e;
            }
        }

        // 3. Add twitterAccountId to ProfileSet
        console.log('\n3️⃣ Adding twitterAccountId column to ProfileSet...');
        try {
            await db.execute('ALTER TABLE ProfileSet ADD COLUMN twitterAccountId TEXT');
            console.log('   ✅ twitterAccountId column added');
        } catch (e: any) {
            if (e.message?.includes('duplicate column')) {
                console.log('   ℹ️  twitterAccountId column already exists');
            } else {
                throw e;
            }
        }

        console.log('\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();

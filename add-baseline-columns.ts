/**
 * Migration: Add baseline tracking columns to MonitoredProfile
 */
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function migrate() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    console.log('🔧 Adding baseline tracking columns...\n');

    // Add isBaselineComplete column
    try {
        await db.execute(`ALTER TABLE MonitoredProfile ADD COLUMN isBaselineComplete INTEGER DEFAULT 0`);
        console.log('✅ Added isBaselineComplete column');
    } catch (err: any) {
        if (err.message.includes('duplicate column')) {
            console.log('ℹ️ isBaselineComplete column already exists');
        } else {
            console.log(`⚠️ Error: ${err.message}`);
        }
    }

    // Add lastSuccessfulScrapeAt column
    try {
        await db.execute(`ALTER TABLE MonitoredProfile ADD COLUMN lastSuccessfulScrapeAt TEXT`);
        console.log('✅ Added lastSuccessfulScrapeAt column');
    } catch (err: any) {
        if (err.message.includes('duplicate column')) {
            console.log('ℹ️ lastSuccessfulScrapeAt column already exists');
        } else {
            console.log(`⚠️ Error: ${err.message}`);
        }
    }

    console.log('\n✅ Migration complete!');
    console.log('\nRun the monitoring script to establish baselines.');
}

migrate().catch(console.error);

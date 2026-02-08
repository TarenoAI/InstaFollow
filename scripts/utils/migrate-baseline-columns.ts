/**
 * 🔧 MIGRATION: Add baseline tracking columns
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function migrate() {
    console.log('🔧 Führe Migration aus...\n');

    try {
        await db.execute('ALTER TABLE MonitoredProfile ADD COLUMN baselineCreatedAt TEXT');
        console.log('✅ baselineCreatedAt hinzugefügt');
    } catch (e: any) {
        if (e.message?.includes('duplicate column')) {
            console.log('ℹ️ baselineCreatedAt existiert bereits');
        } else {
            console.log('ℹ️ baselineCreatedAt:', e.message);
        }
    }

    try {
        await db.execute('ALTER TABLE MonitoredProfile ADD COLUMN baselineFollowingCount INTEGER');
        console.log('✅ baselineFollowingCount hinzugefügt');
    } catch (e: any) {
        if (e.message?.includes('duplicate column')) {
            console.log('ℹ️ baselineFollowingCount existiert bereits');
        } else {
            console.log('ℹ️ baselineFollowingCount:', e.message);
        }
    }

    console.log('\n✅ Migration abgeschlossen!');
}

migrate().catch(console.error);

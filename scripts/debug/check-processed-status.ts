
import { createClient } from '@libsql/client';
import 'dotenv/config';

async function checkProcessedStatus() {
    const db = createClient({
        url: process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n🔍 Letzte 10 ChangeEvents Status:');
    const res = await db.execute(`
        SELECT type, targetUsername, detectedAt, processed, processedAt 
        FROM ChangeEvent 
        ORDER BY detectedAt DESC 
        LIMIT 10
    `);

    res.rows.forEach(evt => {
        console.log(`[${evt.detectedAt}] ${evt.type} @${evt.targetUsername} -> Processed: ${evt.processed} (${evt.processedAt || 'nie'})`);
    });
}

checkProcessedStatus().catch(console.error);

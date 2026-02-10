
import { createClient } from '@libsql/client';
import 'dotenv/config';

async function checkLogs() {
    const db = createClient({
        url: process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n📊 Letzte 20 Monitoring-Logs:');
    const res = await db.execute("SELECT profileUsername, status, errorMessage, createdAt FROM MonitoringLog ORDER BY createdAt DESC LIMIT 20");

    res.rows.forEach(log => {
        console.log(`[${log.createdAt}] @${log.profileUsername}: ${log.status} ${log.errorMessage ? '- Fehler: ' + log.errorMessage : ''}`);
    });
}

checkLogs().catch(console.error);


import { loadQueue } from '../lib/twitter-queue';
import 'dotenv/config';

async function checkQueue() {
    try {
        const queue = await loadQueue();
        console.log(`\n📋 Queue-Status: ${queue.length} Posts warten.`);
        queue.forEach((item, index) => {
            console.log(`[${index + 1}] @${item.profile.username} (${item.lastAttempt ? 'Zuletzt: ' + new Date(item.lastAttempt).toLocaleTimeString() : 'Neu'}) - Retries: ${item.retryCount}`);
        });
    } catch (e) {
        console.error('Fehler beim Lesen der Queue:', e);
    }
}

checkQueue();

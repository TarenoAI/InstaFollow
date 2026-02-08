/**
 * 📤 X/Twitter Post Queue System
 * 
 * Speichert fehlgeschlagene Posts in einer Queue-Datei
 * und verarbeitet sie später mit Delay
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'data/twitter-post-queue.json');

export interface QueuedPost {
    id: string;
    text: string;
    imagePath?: string;
    createdAt: string;
    retryCount: number;
    lastError?: string;
    monitoredProfile: string;
    changeType: 'FOLLOW' | 'UNFOLLOW';
    targetUsernames: string[];
}

/**
 * Queue-Datei laden
 */
export function loadQueue(): QueuedPost[] {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.log('⚠️ Queue-Datei konnte nicht geladen werden, starte mit leerer Queue');
    }
    return [];
}

/**
 * Queue-Datei speichern
 */
export function saveQueue(queue: QueuedPost[]): void {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    console.log(`   💾 Queue gespeichert (${queue.length} Posts)`);
}

/**
 * Post zur Queue hinzufügen
 */
export function addToQueue(post: Omit<QueuedPost, 'id' | 'createdAt' | 'retryCount'>): void {
    const queue = loadQueue();

    const newPost: QueuedPost = {
        ...post,
        id: `post_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
        retryCount: 0
    };

    queue.push(newPost);
    saveQueue(queue);

    console.log(`   📥 Post zur Queue hinzugefügt: ${newPost.id}`);
    console.log(`   📋 Queue-Größe: ${queue.length}`);
}

/**
 * Post aus Queue entfernen
 */
export function removeFromQueue(postId: string): void {
    const queue = loadQueue();
    const filtered = queue.filter(p => p.id !== postId);
    saveQueue(filtered);
}

/**
 * Nächsten Post aus Queue holen (ohne zu entfernen)
 */
export function getNextFromQueue(): QueuedPost | null {
    const queue = loadQueue();
    return queue.length > 0 ? queue[0] : null;
}

/**
 * Retry-Count erhöhen
 */
export function incrementRetryCount(postId: string, error: string): void {
    const queue = loadQueue();
    const post = queue.find(p => p.id === postId);
    if (post) {
        post.retryCount++;
        post.lastError = error;
        saveQueue(queue);
    }
}

/**
 * Queue-Status anzeigen
 */
export function getQueueStatus(): { count: number; oldestPost: string | null } {
    const queue = loadQueue();
    return {
        count: queue.length,
        oldestPost: queue.length > 0 ? queue[0].createdAt : null
    };
}

// CLI: Queue-Status anzeigen wenn direkt aufgerufen
if (require.main === module) {
    const queue = loadQueue();
    console.log('\n📤 X/Twitter Post Queue Status');
    console.log('─'.repeat(40));
    console.log(`Anzahl Posts in Queue: ${queue.length}`);

    if (queue.length > 0) {
        console.log('\nPosts:');
        for (const post of queue) {
            console.log(`  - ${post.id}`);
            console.log(`    Text: ${post.text.substring(0, 50)}...`);
            console.log(`    Erstellt: ${post.createdAt}`);
            console.log(`    Retries: ${post.retryCount}`);
            if (post.lastError) {
                console.log(`    Letzter Fehler: ${post.lastError}`);
            }
            console.log('');
        }
    }
}

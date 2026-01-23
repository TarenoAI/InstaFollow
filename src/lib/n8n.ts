'use server';

import { prisma } from './prisma';

interface ChangePayload {
    type: 'FOLLOW' | 'UNFOLLOW';
    sourceUser: {
        username: string;
        fullName: string | null;
        profilePicUrl: string | null;
        followerCount: number | null;
        followingCount: number | null;
    };
    targetUser: {
        username: string;
        fullName: string | null;
        profilePicUrl: string | null;
    };
    timestamp: string;
    changeId: string;
}

// Get the n8n webhook URL from config
export async function getWebhookUrl(): Promise<string | null> {
    const config = await prisma.appConfig.findUnique({ where: { id: 'app_config' } });
    return config?.n8nWebhookUrl ?? null;
}

// Set the n8n webhook URL
export async function setWebhookUrl(url: string): Promise<boolean> {
    try {
        await prisma.appConfig.upsert({
            where: { id: 'app_config' },
            update: { n8nWebhookUrl: url },
            create: {
                id: 'app_config',
                n8nWebhookUrl: url,
            },
        });
        return true;
    } catch (error) {
        console.error('[n8n] Failed to save webhook URL:', error);
        return false;
    }
}

// Send a change event to n8n webhook
export async function sendToN8n(payload: ChangePayload): Promise<boolean> {
    const webhookUrl = await getWebhookUrl();

    if (!webhookUrl) {
        console.warn('[n8n] No webhook URL configured, skipping notification');
        return false;
    }

    try {
        console.log(`[n8n] Sending ${payload.type} event for @${payload.sourceUser.username} -> @${payload.targetUser.username}`);

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`[n8n] Webhook returned status ${response.status}`);
            return false;
        }

        console.log('[n8n] Successfully sent to webhook');
        return true;
    } catch (error) {
        console.error('[n8n] Failed to send to webhook:', error);
        return false;
    }
}

// Process all unprocessed changes and send to n8n
export async function processUnsentChanges(): Promise<{
    processed: number;
    failed: number;
}> {
    const result = { processed: 0, failed: 0 };

    const changes = await prisma.changeEvent.findMany({
        where: { processed: false },
        include: { profile: true },
        orderBy: { detectedAt: 'asc' },
    });

    console.log(`[n8n] Processing ${changes.length} unprocessed changes`);

    for (const change of changes) {
        const payload: ChangePayload = {
            type: change.type as 'FOLLOW' | 'UNFOLLOW',
            sourceUser: {
                username: change.profile.username,
                fullName: change.profile.fullName,
                profilePicUrl: change.profile.profilePicUrl,
                followerCount: change.profile.followerCount,
                followingCount: change.profile.followingCount,
            },
            targetUser: {
                username: change.targetUsername,
                fullName: change.targetFullName,
                profilePicUrl: change.targetPicUrl,
            },
            timestamp: change.detectedAt.toISOString(),
            changeId: change.id,
        };

        const sent = await sendToN8n(payload);

        if (sent) {
            await prisma.changeEvent.update({
                where: { id: change.id },
                data: { processed: true, processedAt: new Date() },
            });
            result.processed++;
        } else {
            result.failed++;
        }

        // Small delay between webhook calls
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[n8n] Finished processing. Sent: ${result.processed}, Failed: ${result.failed}`);
    return result;
}

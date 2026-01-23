import { NextRequest, NextResponse } from 'next/server';
import { runMonitoringBatch } from '@/lib/monitoring';
import { processUnsentChanges } from '@/lib/n8n';

// GET /api/cron/monitor - Trigger the monitoring batch
export async function GET(request: NextRequest) {
    // Optional: Add secret key validation for security
    const authHeader = request.headers.get('authorization');
    const expectedKey = process.env.CRON_SECRET;

    if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron] Starting monitoring batch...');

    try {
        // Run the monitoring batch
        const batchResult = await runMonitoringBatch();

        // Process and send changes to n8n
        const n8nResult = await processUnsentChanges();

        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            monitoring: {
                profilesChecked: batchResult.profilesChecked,
                changesDetected: batchResult.changesDetected.length,
                errors: batchResult.errors,
            },
            n8n: {
                processed: n8nResult.processed,
                failed: n8nResult.failed,
            },
            changes: batchResult.changesDetected.map(c => ({
                type: c.type,
                source: c.sourceProfile.username,
                target: c.targetUser.username,
            })),
        };

        console.log('[Cron] Batch complete:', JSON.stringify(response, null, 2));

        return NextResponse.json(response);
    } catch (error) {
        console.error('[Cron] Error during monitoring batch:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}

// POST /api/cron/monitor - Same as GET but allows POST for compatibility
export async function POST(request: NextRequest) {
    return GET(request);
}

#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Twitter Queue Processor - verarbeitet fehlgeschlagene Posts
# Gruppiert Events pro Account in einen Tweet
# ═══════════════════════════════════════════════════════════════

# Prüfe ob Queue-Processor schon läuft
if pgrep -f "retry-unprocessed-events" > /dev/null; then
    echo "⚠️ Queue-Processor läuft bereits - überspringe"
    exit 0
fi

cd ~/InstaFollow
git fetch --all && git reset --hard origin/main >> /var/log/instafollow-queue.log 2>&1
npx tsx scripts/utils/retry-unprocessed-events.ts >> /var/log/instafollow-queue.log 2>&1

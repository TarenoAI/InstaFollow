#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Twitter Queue Processor - verarbeitet fehlgeschlagene Posts
# ═══════════════════════════════════════════════════════════════

# Prüfe ob Queue-Processor schon läuft
if pgrep -f "process-twitter-queue" > /dev/null; then
    echo "⚠️ Queue-Processor läuft bereits - überspringe"
    exit 0
fi

cd ~/insta-follows
npx tsx scripts/monitors/process-twitter-queue.ts >> /var/log/instafollow-queue.log 2>&1

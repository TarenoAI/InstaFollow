#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# InstaFollow Cron Setup Script
# ═══════════════════════════════════════════════════════════════

# Prüfe ob schon ein Monitor läuft
if pgrep -f "smart-monitor-v4" > /dev/null; then
    echo "⚠️ Monitor läuft bereits - überspringe"
    exit 0
fi

# Starte den Monitor
cd ~/insta-follows
npx tsx scripts/monitors/smart-monitor-v4.ts >> /var/log/instafollow-monitor.log 2>&1

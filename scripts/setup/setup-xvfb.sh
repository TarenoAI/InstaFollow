#!/bin/bash
# 🖥️ XVFB SETUP FÜR AUTOMATISIERUNG
# 
# Dieses Script richtet einen virtuellen Display ein,
# damit Playwright mit headless: false funktioniert
# OHNE dass VNC geöffnet sein muss.

set -e

echo "════════════════════════════════════════════════════════"
echo "🖥️ XVFB SETUP"
echo "════════════════════════════════════════════════════════"

# 1. Installiere xvfb wenn nicht vorhanden
if ! command -v Xvfb &> /dev/null; then
    echo "📦 Installiere xvfb..."
    apt-get update && apt-get install -y xvfb
else
    echo "✅ xvfb bereits installiert"
fi

# 2. Prüfe ob xvfb bereits läuft
if pgrep -x "Xvfb" > /dev/null; then
    echo "✅ Xvfb läuft bereits"
else
    echo "🚀 Starte Xvfb auf Display :99..."
    Xvfb :99 -screen 0 1280x800x24 &
    sleep 2
    echo "✅ Xvfb gestartet"
fi

# 3. Setze DISPLAY Variable
export DISPLAY=:99
echo "📺 DISPLAY gesetzt auf :99"

# 4. Erstelle systemd service für Auto-Start (optional)
if [ ! -f /etc/systemd/system/xvfb.service ]; then
    echo "📝 Erstelle xvfb systemd service..."
    cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x800x24
Restart=always
RestartSec=10
Environment=DISPLAY=:99

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable xvfb
    systemctl start xvfb
    echo "✅ xvfb Service erstellt und gestartet"
else
    echo "✅ xvfb Service existiert bereits"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ SETUP ABGESCHLOSSEN"
echo ""
echo "Jetzt kannst du den Monitor starten mit:"
echo "  export DISPLAY=:99"
echo "  npx tsx scripts/monitors/smart-monitor-v4.ts"
echo ""
echo "ODER mit xvfb-run:"
echo "  xvfb-run npx tsx scripts/monitors/smart-monitor-v4.ts"
echo "════════════════════════════════════════════════════════"

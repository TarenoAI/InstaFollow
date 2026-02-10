# Lade die User-Umgebung (damit npx/node gefunden werden)
export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
source $HOME/.bashrc 2>/dev/null
source $HOME/.nvm/nvm.sh 2>/dev/null

# Prüfe Pfade
NPX_PATH=$(which npx)
GIT_PATH=$(which git)

echo "--- Run started at $(date) ---" >> /var/log/instafollow-monitor.log

# Prüfe ob schon ein Monitor läuft
if pgrep -f "smart-monitor-v4" > /dev/null; then
    echo "⚠️ Monitor läuft bereits - überspringe" >> /var/log/instafollow-monitor.log
    exit 0
fi

# Starte den Monitor
cd $HOME/InstaFollow
$GIT_PATH fetch --all && $GIT_PATH reset --hard origin/main >> /var/log/instafollow-monitor.log 2>&1
$NPX_PATH tsx scripts/monitors/smart-monitor-v4.ts >> /var/log/instafollow-monitor.log 2>&1

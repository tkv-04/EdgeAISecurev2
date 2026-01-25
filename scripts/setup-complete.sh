#!/bin/bash
#
# EdgeAI Secure - Complete Setup Script
# ======================================
# This script sets up everything from scratch on a fresh Raspberry Pi
#
# Hardware Requirements:
# - Raspberry Pi 4/5 (4GB+ RAM recommended)
# - USB WiFi adapter (TP-Link AX300 Nano or similar) for IoT hotspot
# - SD Card 32GB+
# - Ethernet connection to main router
#
# Run with: sudo bash setup-complete.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration - MODIFY THESE AS NEEDED
HOTSPOT_SSID="IoT-Secure"
HOTSPOT_PASSWORD="ipldlx3dd7h"
HOTSPOT_IP="192.168.50.1"
HOTSPOT_DHCP_START="192.168.50.10"
HOTSPOT_DHCP_END="192.168.50.100"
DB_NAME="edgeaisecure"
DB_USER="pi"
DB_PASSWORD="edgeai"
PROJECT_DIR="/home/pi/Documents/v2/EdgeAISecurev2"

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║             EdgeAI Secure - Complete Setup                   ║"
echo "║                                                              ║"
echo "║  AI-Powered IoT Behavioral Anomaly Detection System          ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root: sudo bash $0${NC}"
    exit 1
fi

# Get the actual user (not root)
ACTUAL_USER=${SUDO_USER:-pi}
ACTUAL_HOME=$(eval echo ~$ACTUAL_USER)

echo -e "${YELLOW}Running as: $ACTUAL_USER${NC}"
echo -e "${YELLOW}Home directory: $ACTUAL_HOME${NC}"
echo ""

# ============================================================
# PHASE 1: System Updates and Dependencies
# ============================================================
echo -e "${GREEN}[1/10] Updating system packages...${NC}"
apt update
apt upgrade -y

echo -e "${GREEN}[2/10] Installing system dependencies...${NC}"
apt install -y \
    build-essential \
    git \
    curl \
    wget \
    hostapd \
    dnsmasq \
    iptables \
    nftables \
    net-tools \
    wireless-tools \
    iw \
    postgresql \
    postgresql-contrib \
    suricata \
    python3 \
    python3-pip \
    arping \
    bridge-utils \
    ufw

# ============================================================
# PHASE 2: Node.js Installation
# ============================================================
echo -e "${GREEN}[3/10] Installing Node.js 20 LTS...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

node --version
npm --version

# ============================================================
# PHASE 3: PostgreSQL Setup
# ============================================================
echo -e "${GREEN}[4/10] Setting up PostgreSQL database...${NC}"
systemctl start postgresql
systemctl enable postgresql

# Create database user and database
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true

echo "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME" > /tmp/db_url
echo -e "${YELLOW}Database URL: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME${NC}"

# ============================================================
# PHASE 4: WiFi Adapter Driver (TP-Link AX300 / AIC8800)
# ============================================================
echo -e "${GREEN}[5/10] Setting up WiFi adapter driver...${NC}"

# Check for common USB WiFi adapters
lsusb | grep -i "realtek\|ralink\|atheros\|mediatek\|aic" || echo "USB WiFi adapter may need manual driver setup"

# Load AIC8800 driver if present (for TP-Link AX300 Nano)
modprobe aic_load_fw 2>/dev/null || true
modprobe aic8800_fdrv 2>/dev/null || true

# Check if wlan1 exists
if ! ip link show wlan1 &>/dev/null; then
    echo -e "${YELLOW}Note: wlan1 not found. Please ensure USB WiFi adapter is plugged in.${NC}"
    echo -e "${YELLOW}You may need to install specific drivers for your adapter.${NC}"
fi

# ============================================================
# PHASE 5: Hostapd Configuration
# ============================================================
echo -e "${GREEN}[6/10] Configuring IoT-Secure Hotspot...${NC}"

# Stop services temporarily
systemctl stop hostapd 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true

# Create hostapd configuration
cat > /etc/hostapd/iot-secure.conf << EOF
# IoT-Secure Hotspot Configuration
interface=wlan1
driver=nl80211
ssid=$HOTSPOT_SSID
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=$HOTSPOT_PASSWORD
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP

# Country code (change for your region)
country_code=IN

# Logging
logger_syslog=-1
logger_syslog_level=2
logger_stdout=-1
logger_stdout_level=2
EOF

# Unmask hostapd
systemctl unmask hostapd

# ============================================================
# PHASE 6: DNSMASQ Configuration (DHCP for IoT hotspot)
# ============================================================
echo -e "${GREEN}[7/10] Configuring DHCP server...${NC}"

cat > /etc/dnsmasq.d/iot-secure.conf << EOF
# IoT-Secure DHCP Configuration
interface=wlan1
bind-interfaces

# DHCP range
dhcp-range=$HOTSPOT_DHCP_START,$HOTSPOT_DHCP_END,255.255.255.0,24h

# Gateway and DNS
dhcp-option=3,$HOTSPOT_IP
dhcp-option=6,$HOTSPOT_IP

# Lease file
dhcp-leasefile=/var/lib/misc/dnsmasq.wlan1.leases

# DNS (forward to Pi-hole or upstream)
no-resolv
server=8.8.8.8
server=8.8.4.4

# Logging
log-queries
log-dhcp
EOF

# Create lease file directory
mkdir -p /var/lib/misc
touch /var/lib/misc/dnsmasq.wlan1.leases

# ============================================================
# PHASE 7: Network Configuration
# ============================================================
echo -e "${GREEN}[8/10] Configuring network and IP forwarding...${NC}"

# Enable IP forwarding permanently
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-ip-forward.conf
sysctl -p /etc/sysctl.d/99-ip-forward.conf

# Create IoT hotspot startup script
cat > /usr/local/bin/start-iot-hotspot.sh << 'SCRIPT'
#!/bin/bash
# IoT-Secure Hotspot Startup Script

set -e

echo "Starting IoT-Secure Hotspot..."

# Kill existing processes
killall hostapd dnsmasq 2>/dev/null || true
sleep 1

# Load WiFi drivers
modprobe aic_load_fw 2>/dev/null || true
modprobe aic8800_fdrv 2>/dev/null || true
sleep 2

# Check if wlan1 exists
if ! ip link show wlan1 &>/dev/null; then
    echo "ERROR: wlan1 interface not found!"
    exit 1
fi

# Configure wlan1
ip link set wlan1 down 2>/dev/null || true
ip addr flush dev wlan1
ip link set wlan1 up
ip addr add 192.168.50.1/24 dev wlan1

# Start hostapd
hostapd -B /etc/hostapd/iot-secure.conf
sleep 2

# Start dnsmasq
dnsmasq -C /etc/dnsmasq.d/iot-secure.conf &
sleep 1

# Enable NAT
echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# Bidirectional forwarding (IoT <-> Router network)
iptables -C FORWARD -i wlan1 -o eth0 -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i wlan1 -o eth0 -j ACCEPT
iptables -C FORWARD -i eth0 -o wlan1 -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i eth0 -o wlan1 -j ACCEPT

echo ""
echo "IoT-Secure Hotspot Started!"
echo "  SSID: IoT-Secure"
echo "  Password: ipldlx3dd7h"
echo "  Gateway: 192.168.50.1"
SCRIPT

chmod +x /usr/local/bin/start-iot-hotspot.sh

# ============================================================
# PHASE 7b: OpenWRT Static Route Configuration
# ============================================================
echo -e "${GREEN}[8b/10] Configuring OpenWRT router for bidirectional routing...${NC}"

# Get Pi's eth0 IP address
PI_ETH0_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
ROUTER_IP=$(ip route | grep default | awk '{print $3}')

echo -e "${YELLOW}Pi eth0 IP: $PI_ETH0_IP${NC}"
echo -e "${YELLOW}Router IP: $ROUTER_IP${NC}"

# Create OpenWRT configuration script
cat > /usr/local/bin/configure-openwrt-route.sh << 'OPENWRT_SCRIPT'
#!/bin/bash
# Configure OpenWRT static route for IoT network
# Run this script with: ./configure-openwrt-route.sh <router_ip> <router_user> <router_password>

ROUTER_IP=${1:-192.168.31.1}
ROUTER_USER=${2:-root}
ROUTER_PASS=${3:-}
PI_IP=${4:-$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)}

echo "Configuring OpenWRT router at $ROUTER_IP..."
echo "Adding static route: 192.168.50.0/24 via $PI_IP"

# Method 1: SSH (if password-less SSH is set up)
if [ -z "$ROUTER_PASS" ]; then
    ssh $ROUTER_USER@$ROUTER_IP "
        uci set network.iot_static=route
        uci set network.iot_static.interface='lan'
        uci set network.iot_static.target='192.168.50.0'
        uci set network.iot_static.netmask='255.255.255.0'
        uci set network.iot_static.gateway='$PI_IP'
        uci commit network
        /etc/init.d/network reload
    " 2>/dev/null && echo "✓ Route configured via SSH" && exit 0
fi

# Method 2: Using sshpass (if installed and password provided)
if command -v sshpass &>/dev/null && [ -n "$ROUTER_PASS" ]; then
    sshpass -p "$ROUTER_PASS" ssh -o StrictHostKeyChecking=no $ROUTER_USER@$ROUTER_IP "
        uci set network.iot_static=route
        uci set network.iot_static.interface='lan'
        uci set network.iot_static.target='192.168.50.0'
        uci set network.iot_static.netmask='255.255.255.0'
        uci set network.iot_static.gateway='$PI_IP'
        uci commit network
        /etc/init.d/network reload
    " 2>/dev/null && echo "✓ Route configured via sshpass" && exit 0
fi

# Method 3: Print manual instructions
echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║  Manual OpenWRT Configuration Required                           ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo "SSH to your OpenWRT router and run:"
echo ""
echo "  uci set network.iot_static=route"
echo "  uci set network.iot_static.interface='lan'"
echo "  uci set network.iot_static.target='192.168.50.0'"
echo "  uci set network.iot_static.netmask='255.255.255.0'"
echo "  uci set network.iot_static.gateway='$PI_IP'"
echo "  uci commit network"
echo "  /etc/init.d/network reload"
echo ""
echo "Or via LuCI Web UI:"
echo "  Network → Routing → Static IPv4 Routes → Add"
echo "  Interface: lan"
echo "  Target: 192.168.50.0/24"
echo "  Gateway: $PI_IP"
echo ""
OPENWRT_SCRIPT

chmod +x /usr/local/bin/configure-openwrt-route.sh

echo -e "${YELLOW}OpenWRT configuration script created: /usr/local/bin/configure-openwrt-route.sh${NC}"

# ============================================================
# PHASE 8: Suricata Configuration
# ============================================================
echo -e "${GREEN}[9/10] Configuring Suricata IDS...${NC}"

# Create Suricata directory for EdgeAI
mkdir -p /var/log/suricata
chown $ACTUAL_USER:$ACTUAL_USER /var/log/suricata

# Create Suricata config for EdgeAI
cat > /etc/suricata/edgeai.yaml << 'SURICATA_CONF'
%YAML 1.1
---
vars:
  address-groups:
    HOME_NET: "[192.168.0.0/16,10.0.0.0/8]"
    EXTERNAL_NET: "!$HOME_NET"
  port-groups:
    HTTP_PORTS: "80"
    SSH_PORTS: "22"

default-log-dir: /var/log/suricata/

outputs:
  - eve-log:
      enabled: yes
      filetype: regular
      filename: eve.json
      types:
        - alert
        - dns
        - http
        - tls
        - flow

af-packet:
  - interface: eth0
    threads: auto
    cluster-type: cluster_flow
    defrag: yes
  - interface: wlan1
    threads: auto
    cluster-type: cluster_flow
    defrag: yes

app-layer:
  protocols:
    dns:
      enabled: yes
    http:
      enabled: yes
    tls:
      enabled: yes
    mqtt:
      enabled: yes
SURICATA_CONF

# ============================================================
# PHASE 9: Systemd Services
# ============================================================
echo -e "${GREEN}[10/10] Creating systemd services...${NC}"

# IoT Hotspot Service
cat > /etc/systemd/system/iot-hotspot.service << EOF
[Unit]
Description=IoT-Secure Hotspot
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/start-iot-hotspot.sh
ExecStop=/usr/bin/killall hostapd dnsmasq

[Install]
WantedBy=multi-user.target
EOF

# Suricata Service for EdgeAI
cat > /etc/systemd/system/suricata-edgeai.service << EOF
[Unit]
Description=Suricata for EdgeAI
After=network.target iot-hotspot.service

[Service]
Type=simple
ExecStart=/usr/bin/suricata -c /etc/suricata/edgeai.yaml --af-packet -D
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# EdgeAI Secure Service
cat > /etc/systemd/system/edgeaisecure.service << EOF
[Unit]
Description=EdgeAI Secure Server
After=network.target postgresql.service iot-hotspot.service

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

# Enable services
systemctl enable iot-hotspot.service
systemctl enable suricata-edgeai.service

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║               Setup Complete!                                ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Install project dependencies:"
echo "   cd $PROJECT_DIR"
echo "   npm install"
echo ""
echo "2. Initialize database:"
echo "   npm run db:push"
echo ""
echo "3. Start the IoT hotspot:"
echo "   sudo systemctl start iot-hotspot"
echo ""
echo "4. Start Suricata:"
echo "   sudo systemctl start suricata-edgeai"
echo ""
echo "5. Start the application:"
echo "   npm run dev"
echo ""
echo "6. Access dashboard:"
echo "   http://localhost:5000"
echo ""
echo -e "${YELLOW}7. Configure OpenWRT router (REQUIRED for HA integration):${NC}"
echo "   sudo /usr/local/bin/configure-openwrt-route.sh"
echo ""
echo "   This adds a static route so devices on 192.168.31.x can"
echo "   communicate with IoT devices on 192.168.50.x"
echo ""
echo -e "${BLUE}Hotspot Credentials:${NC}"
echo "   SSID:     $HOTSPOT_SSID"
echo "   Password: $HOTSPOT_PASSWORD"
echo "   Gateway:  $HOTSPOT_IP"
echo ""
echo -e "${BLUE}Database:${NC}"
echo "   URL: postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo ""
echo -e "${BLUE}Network Topology:${NC}"
echo "   [OpenWRT Router 192.168.31.1]"
echo "           │"
echo "           │ eth0 (192.168.31.x)"
echo "           ▼"
echo "   [Raspberry Pi]"
echo "           │"
echo "           │ wlan1 (192.168.50.1)"
echo "           ▼"
echo "   [IoT Devices 192.168.50.x]"
echo ""
echo -e "${RED}Important:${NC}"
echo "   - Plug in USB WiFi adapter before starting hotspot"
echo "   - Connect Pi to router via Ethernet (eth0)"
echo "   - IoT devices connect to 'IoT-Secure' hotspot"
echo "   - Run configure-openwrt-route.sh for HA ↔ IoT communication"
echo ""

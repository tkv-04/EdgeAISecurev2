#!/bin/bash
# fix-iot-ap.sh - Re-enable IoT-Secure AP if it is disabled
# Usage: sudo bash fix-iot-ap.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "   IoT-Secure AP Recovery Script"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root: sudo bash $0${NC}"
    exit 1
fi

# Step 1: Check current wlan1 status
echo ""
echo -e "${YELLOW}[1/7] Checking wlan1 status...${NC}"
if iw dev wlan1 info 2>/dev/null | grep -q "ssid IoT-Secure"; then
    echo -e "${GREEN}✅ IoT-Secure AP is already running!${NC}"
    echo ""
    echo "  SSID:    $(iw dev wlan1 info | grep ssid | awk '{print $2}')"
    echo "  Mode:    $(iw dev wlan1 info | grep type | awk '{print $2}')"
    echo "  Channel: $(iw dev wlan1 info | grep channel | awk '{print $2}')"
    echo ""
    echo "  hostapd:  $(pgrep hostapd > /dev/null && echo '✅ Running' || echo '❌ Not running')"
    echo "  dnsmasq:  $(pgrep -f 'dnsmasq.*iot-secure' > /dev/null && echo '✅ Running' || echo '❌ Not running')"
    
    # Even if AP is up, check if dnsmasq needs restart
    if ! pgrep -f "dnsmasq.*iot-secure" > /dev/null; then
        echo ""
        echo -e "${YELLOW}Restarting dnsmasq...${NC}"
        dnsmasq -C /etc/dnsmasq.d/iot-secure.conf 2>/dev/null && echo -e "${GREEN}✅ dnsmasq started${NC}" || echo -e "${RED}❌ dnsmasq failed${NC}"
    fi
    exit 0
fi

echo -e "${RED}IoT-Secure AP is NOT running. Fixing...${NC}"

# Step 2: Remove wlan1 from NetworkManager
echo -e "${YELLOW}[2/7] Removing wlan1 from NetworkManager...${NC}"
nmcli dev disconnect wlan1 2>/dev/null || true
nmcli dev set wlan1 managed no 2>/dev/null || true
sleep 1

# Step 3: Kill existing processes
echo -e "${YELLOW}[3/7] Stopping existing services on wlan1...${NC}"
pkill -f "hostapd.*iot-secure" 2>/dev/null || true
pkill -f "dnsmasq.*iot-secure" 2>/dev/null || true
sleep 1

# Step 4: Reload USB WiFi driver
echo -e "${YELLOW}[4/7] Reloading AIC8800 USB WiFi driver...${NC}"
rmmod aic8800_fdrv 2>/dev/null || true
sleep 2
modprobe aic8800_fdrv
sleep 3

# Verify wlan1 came back
if ! ip link show wlan1 &>/dev/null; then
    echo -e "${RED}ERROR: wlan1 did not come back after driver reload!${NC}"
    echo "       Make sure the USB WiFi adapter is plugged in."
    exit 1
fi
echo -e "${GREEN}✅ wlan1 interface detected${NC}"

# Step 5: Configure interface
echo -e "${YELLOW}[5/7] Configuring wlan1 interface...${NC}"
ip link set wlan1 down 2>/dev/null || true
ip addr flush dev wlan1
ip link set wlan1 up
ip addr add 192.168.50.1/24 dev wlan1

# Prevent NetworkManager from grabbing it again
nmcli dev set wlan1 managed no 2>/dev/null || true

# Step 6: Start hostapd
echo -e "${YELLOW}[6/7] Starting hostapd (Access Point)...${NC}"
hostapd -B /etc/hostapd/iot-secure.conf 2>&1
sleep 2

if ! pgrep hostapd > /dev/null; then
    echo -e "${RED}ERROR: hostapd failed to start!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ hostapd started${NC}"

# Step 7: Start dnsmasq
echo -e "${YELLOW}[7/7] Starting dnsmasq (DHCP server)...${NC}"
dnsmasq -C /etc/dnsmasq.d/iot-secure.conf 2>/dev/null
sleep 1
echo -e "${GREEN}✅ dnsmasq started${NC}"

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1 > /dev/null

# NAT routing
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -C FORWARD -i wlan1 -o eth0 -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i wlan1 -o eth0 -j ACCEPT
iptables -C FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Final verification
echo ""
echo "=========================================="
echo -e "   ${GREEN}IoT-Secure AP Recovered!${NC}"
echo "=========================================="
echo ""
echo "  SSID:       IoT-Secure"
echo "  Password:   ipldlx3dd7h"
echo "  Gateway:    192.168.50.1"
echo "  DHCP Range: 192.168.50.10 - 192.168.50.100"
echo "  Channel:    7 (2.4GHz)"
echo ""
echo "  hostapd:  $(pgrep hostapd > /dev/null && echo '✅ Running' || echo '❌ Not running')"
echo "  dnsmasq:  $(pgrep -f 'dnsmasq' > /dev/null && echo '✅ Running' || echo '❌ Not running')"
echo ""
echo "=========================================="

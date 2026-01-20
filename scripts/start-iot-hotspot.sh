#!/bin/bash
# IoT-Secure Hotspot Startup Script
# This script starts the IoT monitoring hotspot on wlan1
# Updated: Works with Pi-hole (dnsmasq for DHCP only, Pi-hole for DNS)

set -e

echo "=========================================="
echo "   Starting IoT-Secure Hotspot"
echo "=========================================="

# Kill any existing services
echo "[1/7] Stopping any existing services..."
killall hostapd dnsmasq 2>/dev/null || true
sleep 1

# Load the AIC8800 driver (TP-Link AX300 Nano)
echo "[2/7] Loading WiFi driver..."
modprobe aic_load_fw 2>/dev/null || true
modprobe aic8800_fdrv 2>/dev/null || true
sleep 3

# Check if wlan1 exists
if ! ip link show wlan1 &>/dev/null; then
    echo "ERROR: wlan1 interface not found!"
    echo "       Make sure the TP-Link AX300 adapter is plugged in."
    exit 1
fi

# Configure wlan1 with static IP
echo "[3/7] Configuring wlan1 interface..."
ip link set wlan1 down 2>/dev/null || true
ip addr flush dev wlan1
ip link set wlan1 up
ip addr add 192.168.50.1/24 dev wlan1

# Start hostapd for AP
echo "[4/7] Starting hostapd (Access Point)..."
hostapd -B /etc/hostapd/iot-secure.conf
if ! pgrep hostapd > /dev/null; then
    echo "ERROR: hostapd failed to start!"
    exit 1
fi
sleep 2

# Start dnsmasq for DHCP only (Pi-hole handles DNS)
echo "[5/7] Starting dnsmasq (DHCP server)..."
# Note: dnsmasq config should have port=0 to disable DNS (Pi-hole handles it)
dnsmasq -C /etc/dnsmasq.d/iot-secure.conf -d &
sleep 1
if ! pgrep dnsmasq > /dev/null; then
    echo "WARNING: dnsmasq may have failed to start"
fi

# Enable IP forwarding
echo "[6/7] Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Set up NAT routing (only add if not already present)
echo "[7/7] Configuring NAT routing..."
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || \
    iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -C FORWARD -i wlan1 -o eth0 -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i wlan1 -o eth0 -j ACCEPT  
iptables -C FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Verify
echo ""
echo "=========================================="
echo "   IoT-Secure Hotspot Started!"
echo "=========================================="
echo ""
echo "  SSID:       IoT-Secure"
echo "  Password:   ipldlx3dd7h"
echo "  Gateway:    192.168.50.1"
echo "  DHCP Range: 192.168.50.10 - 192.168.50.100"
echo "  Channel:    7 (2.4GHz)"
echo ""
echo "  Services:"
echo "    hostapd:  $(pgrep hostapd > /dev/null && echo '✅ Running' || echo '❌ Not running')"
echo "    dnsmasq:  $(pgrep dnsmasq > /dev/null && echo '✅ Running' || echo '❌ Not running')"
echo "    Pi-hole:  $(pgrep pihole-FTL > /dev/null && echo '✅ Running (DNS)' || echo '⚠️ Not detected')"
echo ""
echo "  Traffic monitoring: Suricata + AI Anomaly Detection"
echo "=========================================="

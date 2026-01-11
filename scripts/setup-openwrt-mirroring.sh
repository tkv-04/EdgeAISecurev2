#!/bin/sh
#
# EdgeAISecure - OpenWrt Port Mirroring Setup Script
# 
# This script configures port mirroring on OpenWrt routers to send
# a copy of all LAN traffic to a monitoring device (e.g., Raspberry Pi
# running EdgeAISecure with Suricata).
#
# Usage:
#   1. Copy this script to your OpenWrt router
#   2. chmod +x setup-port-mirroring.sh
#   3. ./setup-port-mirroring.sh <PI_IP_ADDRESS>
#
# Example:
#   ./setup-port-mirroring.sh 192.168.1.100
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running on OpenWrt
if [ ! -f /etc/openwrt_release ]; then
    echo_error "This script must be run on OpenWrt!"
    exit 1
fi

# Check for required argument
if [ -z "$1" ]; then
    echo_error "Usage: $0 <PI_IP_ADDRESS>"
    echo "       Example: $0 192.168.31.217"
    exit 1
fi

PI_IP="$1"
LAN_INTERFACE="${2:-br-lan}"

echo ""
echo "=============================================="
echo "  EdgeAISecure - OpenWrt Port Mirroring"
echo "=============================================="
echo ""
echo_info "Target monitoring device: $PI_IP"
echo_info "LAN interface: $LAN_INTERFACE"
echo ""

# Validate IP address format
if ! echo "$PI_IP" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
    echo_error "Invalid IP address format: $PI_IP"
    exit 1
fi

# Check if interface exists
if ! ip link show "$LAN_INTERFACE" >/dev/null 2>&1; then
    echo_warn "Interface $LAN_INTERFACE not found. Available interfaces:"
    ip link show | grep -E "^[0-9]+:" | cut -d: -f2
    exit 1
fi

# Step 1: Update package lists
echo_info "Updating package lists..."
opkg update >/dev/null 2>&1 || {
    echo_warn "Could not update package lists (offline?). Continuing..."
}

# Step 2: Install required packages
echo_info "Installing iptables-mod-tee and dependencies..."
opkg install iptables-mod-tee kmod-ipt-tee 2>/dev/null || {
    # Try alternative package names
    opkg install iptables-nft kmod-ipt-tee 2>/dev/null || {
        echo_error "Failed to install required packages!"
        echo "       Try manually: opkg install iptables-mod-tee kmod-ipt-tee"
        exit 1
    }
}
echo_info "Packages installed successfully!"

# Step 2b: Install bridge netfilter (required for WiFi/bridged traffic)
echo_info "Installing bridge netfilter module..."
opkg install kmod-br-netfilter 2>/dev/null || {
    echo_warn "Could not install kmod-br-netfilter (may already be present)"
}

# Enable bridge-nf-call-iptables so bridged traffic passes through iptables
modprobe br_netfilter 2>/dev/null || true
if [ -f /proc/sys/net/bridge/bridge-nf-call-iptables ]; then
    echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables
    echo_info "Bridge netfilter enabled (required for WiFi traffic)"
else
    echo_warn "bridge-nf-call-iptables not available - WiFi traffic may not be mirrored"
fi

# Step 3: Add iptables rules (checking if they already exist)
echo_info "Configuring port mirroring rules..."

# Remove existing rules first (if any)
iptables -t mangle -D PREROUTING -i "$LAN_INTERFACE" -j TEE --gateway "$PI_IP" 2>/dev/null || true
iptables -t mangle -D POSTROUTING -o "$LAN_INTERFACE" -j TEE --gateway "$PI_IP" 2>/dev/null || true

# Add new rules
iptables -t mangle -A PREROUTING -i "$LAN_INTERFACE" -j TEE --gateway "$PI_IP"
iptables -t mangle -A POSTROUTING -o "$LAN_INTERFACE" -j TEE --gateway "$PI_IP"

echo_info "Port mirroring rules added!"

# Step 4: Make rules persistent
echo_info "Making rules persistent..."

# Create or update /etc/firewall.user
FIREWALL_USER="/etc/firewall.user"
MARKER="# EdgeAISecure Port Mirroring"

# Remove old EdgeAISecure rules if present
if [ -f "$FIREWALL_USER" ]; then
    sed -i "/${MARKER}/,/# End EdgeAISecure/d" "$FIREWALL_USER" 2>/dev/null || true
fi

# Add new rules
cat >> "$FIREWALL_USER" << EOF

$MARKER
# Mirror all LAN traffic to EdgeAISecure monitoring device
PI_IP='$PI_IP'
LAN_IF='$LAN_INTERFACE'

# Enable bridge netfilter for WiFi/bridged traffic
modprobe br_netfilter 2>/dev/null || true
[ -f /proc/sys/net/bridge/bridge-nf-call-iptables ] && echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables

# Add TEE rules if not present
iptables -t mangle -C PREROUTING -i \$LAN_IF -j TEE --gateway \$PI_IP 2>/dev/null || \\
    iptables -t mangle -A PREROUTING -i \$LAN_IF -j TEE --gateway \$PI_IP
iptables -t mangle -C POSTROUTING -o \$LAN_IF -j TEE --gateway \$PI_IP 2>/dev/null || \\
    iptables -t mangle -A POSTROUTING -o \$LAN_IF -j TEE --gateway \$PI_IP
# End EdgeAISecure
EOF

echo_info "Rules saved to $FIREWALL_USER"

# Step 5: Verify
echo ""
echo_info "Verifying configuration..."
echo ""
echo "Active TEE rules:"
iptables -t mangle -L -n | grep TEE || echo "  (none found - check configuration)"

echo ""
echo "=============================================="
echo_info "Port mirroring setup complete!"
echo "=============================================="
echo ""
echo "All traffic on $LAN_INTERFACE will now be mirrored to $PI_IP"
echo ""
echo "To verify on the Pi, run:"
echo "  sudo tcpdump -i eth0 -n | head -50"
echo ""
echo "To remove port mirroring later, run:"
echo "  iptables -t mangle -D PREROUTING -i $LAN_INTERFACE -j TEE --gateway $PI_IP"
echo "  iptables -t mangle -D POSTROUTING -o $LAN_INTERFACE -j TEE --gateway $PI_IP"
echo "  And remove the rules from $FIREWALL_USER"
echo ""

#!/bin/bash
# EdgeAISecure Network Security Setup Script
# Run this on a fresh Raspberry Pi to set up all network security features

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== EdgeAISecure Network Security Setup ===${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo)${NC}"
    exit 1
fi

echo "This script will set up:"
echo "  1. IP forwarding (gateway mode)"
echo "  2. NAT (masquerade) rules"
echo "  3. Device access control (default-deny)"
echo "  4. Persistent rules across reboot"
echo ""

# Get network config
read -p "Enter router IP (default: 192.168.31.1): " ROUTER_IP
ROUTER_IP=${ROUTER_IP:-192.168.31.1}

read -p "Enter Pi's static IP (default: 192.168.31.217): " PI_IP
PI_IP=${PI_IP:-192.168.31.217}

echo ""
echo -e "${YELLOW}=== Step 1: Installing Dependencies ===${NC}"
apt-get update
apt-get install -y iptables-persistent conntrack

echo ""
echo -e "${YELLOW}=== Step 2: Enabling IP Forwarding ===${NC}"
sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-ip-forward.conf
echo -e "${GREEN}✓ IP forwarding enabled${NC}"

echo ""
echo -e "${YELLOW}=== Step 3: Configuring eth0 Static IP ===${NC}"
if nmcli con show "Wired connection 1" &>/dev/null; then
    nmcli con mod "Wired connection 1" ipv4.method manual \
        ipv4.addresses "${PI_IP}/24" \
        ipv4.gateway "${ROUTER_IP}" \
        ipv4.dns "8.8.8.8,8.8.4.4" \
        ipv4.route-metric 50
    nmcli con up "Wired connection 1" || true
    echo -e "${GREEN}✓ Static IP configured: ${PI_IP}${NC}"
else
    echo -e "${YELLOW}! NetworkManager connection not found, skipping${NC}"
fi

echo ""
echo -e "${YELLOW}=== Step 4: Setting Up NAT (MASQUERADE) ===${NC}"
# Clear existing NAT rules
iptables -t nat -F POSTROUTING
# Add masquerade for outbound traffic
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
echo -e "${GREEN}✓ NAT configured${NC}"

echo ""
echo -e "${YELLOW}=== Step 5: Setting Up Device Access Control ===${NC}"

# Create DEVICE_ACCESS chain
iptables -N DEVICE_ACCESS 2>/dev/null || true
iptables -F DEVICE_ACCESS

# Remove existing jump and add at top of FORWARD
iptables -D FORWARD -j DEVICE_ACCESS 2>/dev/null || true
iptables -I FORWARD 1 -j DEVICE_ACCESS

# Add base rules
# 1. Allow established connections
iptables -A DEVICE_ACCESS -m state --state ESTABLISHED,RELATED -j RETURN

# 2. Allow Pi's own traffic
iptables -A DEVICE_ACCESS -s ${PI_IP} -j RETURN
iptables -A DEVICE_ACCESS -d ${PI_IP} -j RETURN

# 3. Allow DHCP
iptables -A DEVICE_ACCESS -p udp --dport 67:68 -j RETURN

# 4. Allow ICMP (for device identification)
iptables -A DEVICE_ACCESS -p icmp -j RETURN

# 5. DROP everything else (default deny)
iptables -A DEVICE_ACCESS -j DROP

echo -e "${GREEN}✓ Device access control configured (default-deny)${NC}"

echo ""
echo -e "${YELLOW}=== Step 6: Saving Rules for Persistence ===${NC}"
netfilter-persistent save
echo -e "${GREEN}✓ Rules saved${NC}"

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo "Network Configuration:"
echo "  Pi IP: ${PI_IP}"
echo "  Router/Gateway: ${ROUTER_IP}"
echo ""
echo "Access Control:"
echo "  - All new devices are BLOCKED by default"
echo "  - Devices must be approved in the dashboard to get internet"
echo "  - Pi gateway traffic is always allowed"
echo ""
echo "Next Steps:"
echo "  1. Start the EdgeAISecure app: npm run dev"
echo "  2. Access dashboard: http://${PI_IP}:5000"
echo "  3. Approve devices from the dashboard"
echo ""
echo "To add/remove devices manually:"
echo "  # Allow a MAC: sudo iptables -I DEVICE_ACCESS <N> -m mac --mac-source AA:BB:CC:DD:EE:FF -j RETURN"
echo "  # Block a MAC: sudo iptables -D DEVICE_ACCESS -m mac --mac-source AA:BB:CC:DD:EE:FF -j RETURN"
echo "  # View rules: sudo iptables -L DEVICE_ACCESS -n --line-numbers"

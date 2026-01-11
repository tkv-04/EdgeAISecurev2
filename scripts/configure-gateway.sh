#!/bin/bash
# Gateway Configuration Script for EdgeAISecure
# Usage: sudo ./configure-gateway.sh <router_ip> <pi_ip>
# Example: sudo ./configure-gateway.sh 192.168.31.1 192.168.31.217

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo)${NC}"
    exit 1
fi

# Default values
ROUTER_IP=${1:-"192.168.31.1"}
PI_IP=${2:-"192.168.31.217"}
INTERFACE="eth0"
CONNECTION_NAME="Wired connection 1"

echo -e "${YELLOW}=== EdgeAISecure Gateway Configuration ===${NC}"
echo "Router IP (gateway): $ROUTER_IP"
echo "Pi IP: $PI_IP"
echo "Interface: $INTERFACE"
echo ""

# Function to show current config
show_status() {
    echo -e "${YELLOW}=== Current Configuration ===${NC}"
    echo "IP Addresses:"
    ip addr show $INTERFACE | grep "inet " || echo "  No IP on $INTERFACE"
    echo ""
    echo "Routes:"
    ip route | grep default || echo "  No default route"
    echo ""
    echo "NAT Rules:"
    iptables -t nat -L POSTROUTING -n | grep MASQUERADE || echo "  No MASQUERADE rule"
    echo ""
    echo "IP Forwarding:"
    sysctl net.ipv4.ip_forward
}

# Function to configure gateway
configure_gateway() {
    echo -e "${YELLOW}=== Configuring Gateway ===${NC}"
    
    # Enable IP forwarding
    echo "1. Enabling IP forwarding..."
    sysctl -w net.ipv4.ip_forward=1
    echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-ip-forward.conf
    
    # Configure eth0 with static IP
    echo "2. Configuring $INTERFACE with static IP..."
    nmcli con mod "$CONNECTION_NAME" ipv4.method manual \
        ipv4.addresses "$PI_IP/24" \
        ipv4.gateway "$ROUTER_IP" \
        ipv4.dns "8.8.8.8,8.8.4.4" \
        ipv4.route-metric 50
    
    # Restart connection
    echo "3. Restarting network connection..."
    nmcli con up "$CONNECTION_NAME" || true
    sleep 2
    
    # Configure NAT (MASQUERADE on eth0)
    echo "4. Configuring NAT..."
    # Remove any existing MASQUERADE rules
    iptables -t nat -F POSTROUTING 2>/dev/null || true
    # Add MASQUERADE on eth0
    iptables -t nat -A POSTROUTING -o $INTERFACE -j MASQUERADE
    
    # Save iptables rules
    echo "5. Saving iptables rules..."
    netfilter-persistent save
    
    echo -e "${GREEN}=== Configuration Complete! ===${NC}"
}

# Function to test connectivity
test_connectivity() {
    echo -e "${YELLOW}=== Testing Connectivity ===${NC}"
    
    echo "Pinging router ($ROUTER_IP)..."
    if ping -c 2 $ROUTER_IP > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Router reachable${NC}"
    else
        echo -e "  ${RED}✗ Router not reachable${NC}"
    fi
    
    echo "Pinging internet (8.8.8.8)..."
    if ping -c 2 8.8.8.8 > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Internet working${NC}"
    else
        echo -e "  ${RED}✗ No internet${NC}"
    fi
}

# Function to reset to DHCP
reset_to_dhcp() {
    echo -e "${YELLOW}=== Resetting to DHCP ===${NC}"
    nmcli con mod "$CONNECTION_NAME" ipv4.method auto \
        ipv4.addresses "" \
        ipv4.gateway "" \
        ipv4.dns ""
    nmcli con up "$CONNECTION_NAME" || true
    echo -e "${GREEN}Reset to DHCP complete${NC}"
}

# Main menu
case "${3:-configure}" in
    status)
        show_status
        ;;
    configure)
        configure_gateway
        test_connectivity
        ;;
    test)
        test_connectivity
        ;;
    reset)
        reset_to_dhcp
        ;;
    *)
        echo "Usage: $0 <router_ip> <pi_ip> [status|configure|test|reset]"
        echo ""
        echo "Commands:"
        echo "  configure - Configure gateway with specified IPs (default)"
        echo "  status    - Show current configuration"
        echo "  test      - Test connectivity"
        echo "  reset     - Reset eth0 to DHCP"
        echo ""
        echo "Examples:"
        echo "  sudo $0 192.168.31.1 192.168.31.217           # Configure with OpenWRT"
        echo "  sudo $0 192.168.1.1 192.168.1.100             # Configure with different router"
        echo "  sudo $0 192.168.31.1 192.168.31.217 status    # Show status"
        echo "  sudo $0 192.168.31.1 192.168.31.217 reset     # Reset to DHCP"
        ;;
esac

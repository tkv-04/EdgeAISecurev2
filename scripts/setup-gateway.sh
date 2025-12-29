#!/bin/bash
# EdgeAI IoT Security Center - Pi Gateway Setup Script
# This configures the Pi as a network gateway so Suricata can monitor all traffic

set -e

echo "=========================================="
echo "  EdgeAI Pi Gateway Setup"
echo "=========================================="

# Get network info
PI_IP=$(hostname -I | awk '{print $1}')
INTERFACE="wlan0"
ROUTER_IP="192.168.0.1"

echo ""
echo "Configuration:"
echo "  Pi IP: $PI_IP"
echo "  Interface: $INTERFACE"
echo "  Router IP: $ROUTER_IP"
echo ""

# Step 1: Enable IP forwarding permanently
echo "[1/4] Enabling IP forwarding..."
sudo sysctl -w net.ipv4.ip_forward=1
if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf; then
    echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
    echo "  Added to /etc/sysctl.conf for persistence"
else
    echo "  Already in /etc/sysctl.conf"
fi

# Step 2: Set up NAT (MASQUERADE)
echo "[2/4] Setting up NAT rules..."
# Clear existing NAT rules
sudo iptables -t nat -F POSTROUTING 2>/dev/null || true

# Add MASQUERADE rule - this allows Pi to forward traffic to the internet
sudo iptables -t nat -A POSTROUTING -o $INTERFACE -j MASQUERADE

# Allow forwarding of established connections
sudo iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A FORWARD -j ACCEPT

echo "  NAT MASQUERADE configured"

# Step 3: Save iptables rules for persistence
echo "[3/4] Saving iptables rules..."
sudo mkdir -p /etc/iptables
sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null
echo "  Rules saved to /etc/iptables/rules.v4"

# Create systemd service to restore rules on boot
cat << 'EOF' | sudo tee /etc/systemd/system/iptables-restore.service > /dev/null
[Unit]
Description=Restore iptables rules
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/sbin/iptables-restore /etc/iptables/rules.v4
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable iptables-restore.service
echo "  Systemd service created for boot persistence"

# Step 4: Instructions for router
echo ""
echo "[4/4] IMPORTANT: Router Configuration Required!"
echo ""
echo "=========================================="
echo "  MANUAL STEP REQUIRED ON YOUR ROUTER"
echo "=========================================="
echo ""
echo "Option A: Change DHCP Gateway (Recommended)"
echo "  1. Log into your router at http://$ROUTER_IP"
echo "  2. Go to DHCP settings"
echo "  3. Set 'Default Gateway' to: $PI_IP"
echo "  4. Devices will route through Pi after DHCP renewal"
echo ""
echo "Option B: Static Route on Router"
echo "  1. Add static route for 0.0.0.0/0 via $PI_IP"
echo ""
echo "Option C: Per-Device Static IP"
echo "  1. Set device gateway to $PI_IP manually"
echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "After router config, verify with:"
echo "  sudo tcpdump -i $INTERFACE -n | head -20"
echo ""
echo "Check Suricata is seeing traffic:"
echo "  sudo tail -f /var/log/suricata/eve.json | grep flow"

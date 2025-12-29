#!/bin/bash
# EdgeAI IoT Security Center - Ethernet Gateway Setup
# Configures eth0 as a gateway for IoT devices with DHCP

set -e

echo "=========================================="
echo "  EdgeAI Ethernet Gateway Setup"
echo "=========================================="
echo ""
echo "This will configure:"
echo "  - eth0 with static IP 10.0.0.1"
echo "  - DHCP server for 10.0.0.100-200"
echo "  - NAT routing from eth0 → wlan0 (internet)"
echo "  - Suricata will monitor eth0 traffic"
echo ""

# Step 1: Configure static IP for eth0
echo "[1/5] Configuring eth0 with static IP..."
sudo ip addr flush dev eth0 2>/dev/null || true
sudo ip addr add 10.0.0.1/24 dev eth0
sudo ip link set eth0 up
echo "  eth0: 10.0.0.1/24"

# Step 2: Install dnsmasq for DHCP
echo "[2/5] Setting up DHCP server..."
if ! command -v dnsmasq &> /dev/null; then
    sudo apt install dnsmasq -y
fi

# Configure dnsmasq for eth0 only
cat << 'EOF' | sudo tee /etc/dnsmasq.d/iot-gateway.conf > /dev/null
# EdgeAI IoT Gateway DHCP config
interface=eth0
bind-interfaces
dhcp-range=10.0.0.100,10.0.0.200,255.255.255.0,24h
dhcp-option=option:router,10.0.0.1
dhcp-option=option:dns-server,10.0.0.1
EOF

# Restart dnsmasq
sudo systemctl restart dnsmasq
echo "  DHCP range: 10.0.0.100-200"

# Step 3: Enable IP forwarding
echo "[3/5] Enabling IP forwarding..."
sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Step 4: Configure NAT from eth0 to wlan0
echo "[4/5] Configuring NAT..."
sudo iptables -t nat -A POSTROUTING -o wlan0 -j MASQUERADE
sudo iptables -A FORWARD -i eth0 -o wlan0 -j ACCEPT
sudo iptables -A FORWARD -i wlan0 -o eth0 -m state --state RELATED,ESTABLISHED -j ACCEPT
echo "  eth0 → wlan0 NAT configured"

# Step 5: Update Suricata to monitor eth0
echo "[5/5] Configuring Suricata for eth0..."
if grep -q "interface: wlan0" /etc/suricata/suricata.yaml; then
    sudo sed -i 's/interface: wlan0/interface: eth0/' /etc/suricata/suricata.yaml
    sudo systemctl restart suricata
    echo "  Suricata now monitoring eth0"
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Network topology:"
echo "  Internet ← [Router] ← WiFi (wlan0) ← [Pi] ← Ethernet (eth0) ← [IoT Devices]"
echo ""
echo "Connect your IoT devices:"
echo "  1. Plug ethernet cable from Pi to a switch"
echo "  2. Connect IoT devices to the switch"
echo "  3. Devices will get IP: 10.0.0.100-200"
echo "  4. Gateway: 10.0.0.1 (Pi)"
echo ""
echo "All IoT traffic will now flow through Pi!"
echo "Suricata monitoring: eth0"

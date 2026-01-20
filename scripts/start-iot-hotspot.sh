#!/bin/bash
# IoT-Secure Hotspot Startup Script
# This script starts the IoT monitoring hotspot on wlan1

echo "Starting IoT-Secure hotspot..."

# Load the AIC8800 driver
modprobe aic_load_fw
modprobe aic8800_fdrv
sleep 3

# Configure wlan1 with static IP
ip link set wlan1 up
ip addr flush dev wlan1
ip addr add 192.168.50.1/24 dev wlan1

# Start hostapd for AP
hostapd -B /etc/hostapd/iot-secure.conf
sleep 2

# Start dnsmasq for DHCP
dnsmasq --conf-file=/etc/dnsmasq.d/iot-secure.conf

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1

# Set up NAT routing
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
iptables -C FORWARD -i wlan1 -o eth0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wlan1 -o eth0 -j ACCEPT  
iptables -C FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -A FORWARD -i eth0 -o wlan1 -m state --state RELATED,ESTABLISHED -j ACCEPT

echo "IoT-Secure hotspot started!"
echo "SSID: IoT-Secure"
echo "IP Range: 192.168.50.10 - 192.168.50.100"
echo "Gateway: 192.168.50.1"

# OpenWrt Port Mirroring Setup Guide

This guide explains how to set up port mirroring on OpenWrt routers to enable EdgeAISecure to capture all LAN traffic, including WiFi device-to-device communication.

## Why Port Mirroring?

By default, traffic between devices on the same LAN (e.g., HomeAssistant ↔ ESP32) doesn't pass through the monitoring Pi. Port mirroring sends a copy of all LAN traffic to the Pi, enabling:

- Complete traffic visibility
- Baseline learning for all devices  
- Anomaly detection for device-to-device communication

## Quick Setup

### 1. Copy script to router
```bash
scp scripts/setup-openwrt-mirroring.sh root@<ROUTER_IP>:/tmp/
```

### 2. Run on router
```bash
ssh root@<ROUTER_IP>
chmod +x /tmp/setup-openwrt-mirroring.sh
/tmp/setup-openwrt-mirroring.sh <PI_IP>
```

### Example
```bash
scp scripts/setup-openwrt-mirroring.sh root@192.168.31.1:/tmp/
ssh root@192.168.31.1
/tmp/setup-openwrt-mirroring.sh 192.168.31.217
```

## What the Script Installs

| Package | Purpose |
|---------|---------|
| `iptables-mod-tee` | Port mirroring support |
| `kmod-ipt-tee` | Kernel TEE target module |
| `kmod-br-netfilter` | **Required for WiFi traffic** |

## Manual Setup

If you prefer manual configuration:

### 1. Install packages
```bash
opkg update
opkg install iptables-mod-tee kmod-ipt-tee kmod-br-netfilter
```

### 2. Enable bridge netfilter (critical for WiFi)
```bash
modprobe br_netfilter
echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables
```

> **Important:** Without bridge-nf-call-iptables, WiFi-to-WiFi traffic (like HomeAssistant ↔ ESP32) will NOT be mirrored!

### 3. Add TEE rules
```bash
PI_IP="192.168.31.217"
iptables -t mangle -A PREROUTING -i br-lan -j TEE --gateway $PI_IP
iptables -t mangle -A POSTROUTING -o br-lan -j TEE --gateway $PI_IP
```

### 4. Make persistent
Add to `/etc/firewall.user`:
```bash
# Enable bridge netfilter for WiFi traffic
modprobe br_netfilter 2>/dev/null || true
[ -f /proc/sys/net/bridge/bridge-nf-call-iptables ] && echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables

# Port mirroring
PI_IP='192.168.31.217'
iptables -t mangle -A PREROUTING -i br-lan -j TEE --gateway $PI_IP
iptables -t mangle -A POSTROUTING -o br-lan -j TEE --gateway $PI_IP
```

## Verification

On the Pi:
```bash
# Check if traffic is visible
sudo tcpdump -i eth0 -n | head -50

# Check specific device traffic
sudo tcpdump -i eth0 host 192.168.31.5 and host 192.168.31.221 -n
```

On the router:
```bash
# Check TEE rules
iptables -t mangle -L -n | grep TEE

# Check bridge-nf is enabled
cat /proc/sys/net/bridge/bridge-nf-call-iptables  # Should show 1
```

## Troubleshooting

### WiFi traffic not being mirrored
```bash
# Ensure bridge-nf is enabled
cat /proc/sys/net/bridge/bridge-nf-call-iptables
# If shows 0 or file not found:
opkg install kmod-br-netfilter
modprobe br_netfilter
echo 1 > /proc/sys/net/bridge/bridge-nf-call-iptables
```

### No traffic at all
```bash
# Check if rules exist
iptables -t mangle -L -n | grep TEE

# Check Pi is reachable from router
ping <PI_IP>
```

## Removal

```bash
iptables -t mangle -D PREROUTING -i br-lan -j TEE --gateway <PI_IP>
iptables -t mangle -D POSTROUTING -o br-lan -j TEE --gateway <PI_IP>
```

Remove from `/etc/firewall.user` as well.

## Requirements

- OpenWrt 19.07 or later
- ~200KB storage for packages
- Network reachability between router and Pi

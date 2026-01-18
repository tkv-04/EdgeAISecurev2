#!/bin/bash
# Full Network Traffic Interception for EdgeAISecure
# Routes all device traffic through Pi for monitoring

ROUTER="192.168.31.1"
INTERFACE="eth0"

# Device IPs to intercept (add/remove as needed)
DEVICES=(
    "192.168.31.5"     # HomeAssistant
    "192.168.31.221"   # ESP32
    "192.168.31.123"   # POCO
    "192.168.31.172"   # Other device
)

# Kill existing arpspoof processes
pkill -f arpspoof 2>/dev/null
sleep 1

echo "[EdgeAISecure] Starting full traffic interception..."

# For each device, intercept traffic between it and the router
for DEVICE in "${DEVICES[@]}"; do
    echo "  → Intercepting $DEVICE <-> $ROUTER"
    arpspoof -i $INTERFACE -t $ROUTER -r $DEVICE > /dev/null 2>&1 &
    sleep 0.5
done

echo "[EdgeAISecure] Traffic interception active for ${#DEVICES[@]} devices"
pgrep -c arpspoof

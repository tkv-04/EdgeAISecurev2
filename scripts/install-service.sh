#!/bin/bash
# Install EdgeAISecure as a systemd service for 24/7 operation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/edgeaisecure.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "=== EdgeAISecure Service Installer ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)"
    exit 1
fi

# Copy service file
echo "Installing service file..."
cp "$SERVICE_FILE" "$SYSTEMD_DIR/edgeaisecure.service"

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable service (auto-start on boot)
echo "Enabling auto-start..."
systemctl enable edgeaisecure.service

echo ""
echo "=== Installation Complete! ==="
echo ""
echo "Commands:"
echo "  sudo systemctl start edgeaisecure    # Start now"
echo "  sudo systemctl stop edgeaisecure     # Stop"
echo "  sudo systemctl restart edgeaisecure  # Restart"
echo "  sudo systemctl status edgeaisecure   # Check status"
echo "  sudo journalctl -u edgeaisecure -f   # View logs"
echo ""
echo "The service will auto-start on boot."

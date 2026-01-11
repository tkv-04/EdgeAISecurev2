# 🛡️ Edge AI IoT Security Center

A Raspberry Pi-based network security system that monitors, detects, and blocks suspicious IoT devices on your home network.

## What It Does

**Turn your Raspberry Pi into a network security shield:**

- 🔍 **Scans your network** for IoT devices (cameras, sensors, smart bulbs, etc.)
- 🤖 **Identifies devices** automatically using MAC vendor lookup and port scanning
- 🔔 **Alerts you** when new or suspicious devices appear
- 🚫 **Blocks threats** at the DNS/DHCP level via Pi-hole integration
- 📊 **Monitors traffic** in real-time with visual dashboards

## How It Works

```
Your Network
     │
     ▼
┌─────────────────────────────────────────┐
│           Raspberry Pi                  │
│  ┌───────────────────────────────────┐  │
│  │   Edge AI IoT Security Center     │  │
│  │  • Scans for devices              │  │
│  │  • Detects IoT types              │  │
│  │  • Monitors behavior              │  │
│  │  • Blocks suspicious devices      │  │
│  └───────────────────────────────────┘  │
│                  │                      │
│                  ▼                      │
│  ┌───────────────────────────────────┐  │
│  │          Pi-hole DNS              │  │
│  │  • Blocks ads network-wide        │  │
│  │  • Blocks malicious devices       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Features

### Device Discovery
- Real network scanning using ARP and ping
- Automatic MAC vendor identification (RaspberryPi, ESP, Apple, Xiaomi, etc.)
- IoT device type detection (sensors, cameras, smart devices)
- Background scheduled scanning

### Threat Response
| Action | What Happens | Use Case |
|--------|--------------|----------|
| **Approve** | Device is trusted and monitored | Known devices |
| **Quarantine** | Device gets IP but traffic is blocked | Investigate suspicious device |
| **Block** | Device is denied network access | Known threat |

### Pi-hole Integration
- Blocks devices at DNS level (can't access internet)
- Optional DHCP blocking (device gets no IP at all)
- Works with Pi-hole v6 API

### Notifications
- 🔔 In-app notification bell
- 📲 Webhook support (Discord, Slack, Home Assistant)
- Alerts for: new devices, offline devices, auto-blocks

## Quick Start


### 1. Clone and install
```
git clone https://github.com/tkv-04/EdgeAISecurev2.git
cd EdgeAISecurev2
npm install
```

### 2. Create .env file
```
cp .env.example .env
```
### Or create manually with:
```
cat > .env << EOF
DATABASE_URL=postgresql://postgres:password@localhost:5432/edgeaisecure
PORT=5000
NODE_ENV=development
EOF
```
### 3. Install Pi-hole (optional but recommended)
```
curl -sSL https://install.pi-hole.net | sudo bash
sudo pihole setpassword 'your-password'
```
### 4. Start the app
```
npm run dev
```
### 5. Open in browser
```
http://localhost:5000
```

**Login:** `admin@iot.local` / `admin123`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required for DB mode |
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment (`development` / `production`) | `development` |


## Configuration

### Settings Page
1. Go to **Settings**
2. Under **Network Blocking**, select method:
   - **Local** - Blocks only at Pi level
   - **Pi-hole** - DNS-level blocking (recommended)
   - **OpenWRT** - Push rules to router (if you have one)
3. Enter Pi-hole credentials if using that method
4. Save

### For Full Network Protection
1. Set your router to use Pi's IP as DNS server
2. Or enable Pi-hole DHCP and disable router DHCP
3. All devices will then go through the Pi for DNS

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Recharts
- **Backend:** Express.js + TypeScript + Drizzle ORM
- **Database:** PostgreSQL (flow data, traffic stats, device info)
- **IDS:** Suricata (network intrusion detection)
- **Blocking:** Pi-hole API, iptables, ARP
- **Scanning:** ARP, ping, port scanning
- **Hardware:** Raspberry Pi (tested on Pi 5)

## Gateway Configuration

The Pi can act as a network gateway to monitor all IoT traffic.

### Network Architecture
```
Internet Source
      │
      ▼
┌─────────────┐
│  OpenWRT    │◄──── IoT Devices
│   Router    │
└──────┬──────┘
       │ LAN
       ▼
┌─────────────┐
│ Raspberry Pi│ ◄── Gateway (192.168.31.217)
│  (Suricata) │     Monitors all traffic
└─────────────┘
```

### Configure Gateway
Use the included script to configure the Pi as a gateway:

```bash
# Configure for your router
sudo ./scripts/configure-gateway.sh <router_ip> <pi_ip>

# Example: OpenWRT at 192.168.31.1, Pi at 192.168.31.217
sudo ./scripts/configure-gateway.sh 192.168.31.1 192.168.31.217

# Check status
sudo ./scripts/configure-gateway.sh 192.168.31.1 192.168.31.217 status

# Reset to DHCP
sudo ./scripts/configure-gateway.sh 192.168.31.1 192.168.31.217 reset
```

### OpenWRT DHCP Configuration
Set Pi's IP as the gateway for IoT devices in OpenWRT:
1. Go to OpenWRT → Network → DHCP
2. Set Gateway to Pi's IP (e.g., 192.168.31.217)
3. IoT devices will route through Pi for monitoring

## Suricata IDS Integration

Real-time network intrusion detection with Suricata:

### Features
- **Flow Monitoring:** Track all network flows (source, dest, protocol, bytes)
- **Traffic Analysis:** KB/sec graphs per device on dashboard
- **Alert Detection:** Security alerts from Suricata rules
- **Data Persistence:** 3-day retention in PostgreSQL

### API Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/suricata/status` | Suricata running status |
| `GET /api/suricata/stats` | Traffic statistics |
| `GET /api/suricata/alerts` | Security alerts |
| `GET /api/suricata/traffic` | Per-device traffic data |
| `GET /api/flows` | Historical flow events |
| `GET /api/flows/:ip` | Flows for specific IP |

## Project Structure

```
├── server/
│   ├── network-scanner.ts    # Device discovery
│   ├── network-block.ts      # Blocking logic
│   ├── suricata-service.ts   # Suricata EVE reader
│   ├── notification-service.ts
│   ├── storage.ts            # Database operations
│   └── routes.ts             # API endpoints
├── client/
│   └── src/pages/
│       ├── dashboard.tsx     # Traffic graphs
│       ├── devices.tsx       # Device management
│       ├── monitoring.tsx    # Live monitoring
│       └── settings.tsx      # Configuration
├── scripts/
│   └── configure-gateway.sh  # Gateway setup script
├── shared/
│   └── schema.ts             # Database schema
└── README.md
```

## Database Tables

| Table | Purpose | Retention |
|-------|---------|-----------|
| `devices` | Discovered network devices | Permanent |
| `flow_events` | Suricata flow data | 3 days |
| `traffic_data` | KB/sec per device | Permanent |
| `alerts` | Security alerts | Permanent |
| `logs` | System event logs | Permanent |

## Requirements

- Raspberry Pi (tested on Pi 5)
- Node.js 18+
- PostgreSQL
- Suricata (for IDS features)
- Pi-hole (optional, for DNS blocking)

## Roadmap

- [x] Real device discovery
- [x] Notification system
- [x] Pi-hole integration
- [x] Zone-based blocking (quarantine vs block)
- [x] Suricata IDS integration
- [x] Flow data persistence (3-day retention)
- [x] Gateway configuration script
- [x] Traffic graphs (KB/sec per device)
- [ ] Edge AI anomaly detection model
- [ ] Mobile app

## License

MIT

---

*Built for securing home IoT networks with a Raspberry Pi.*


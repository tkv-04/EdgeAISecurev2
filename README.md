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

- **Frontend:** React + TypeScript + Vite
- **Backend:** Express.js + TypeScript
- **Blocking:** Pi-hole API, iptables
- **Scanning:** ARP, ping, port scanning
- **Hardware:** Raspberry Pi (any model with network)

## Project Structure

```
├── server/
│   ├── network-scanner.ts    # Device discovery
│   ├── network-block.ts      # Blocking logic
│   ├── notification-service.ts
│   └── routes.ts             # API endpoints
├── client/
│   └── src/pages/
│       ├── dashboard.tsx     # Main dashboard
│       ├── devices.tsx       # Device management
│       └── settings.tsx      # Configuration
└── README.md
```

## Requirements

- Raspberry Pi (tested on Pi 5)
- Node.js 18+
- Pi-hole (optional, for DNS blocking)

## Roadmap

- [x] Real device discovery
- [x] Notification system
- [x] Pi-hole integration
- [x] Zone-based blocking (quarantine vs block)
- [ ] OpenWRT router integration
- [ ] Edge AI anomaly detection model
- [ ] Mobile app

## License

MIT

---

*Built for securing home IoT networks with a Raspberry Pi.*

# EdgeAISecure – IoT Monitoring & Control Implementation Plan

This document outlines how to evolve EdgeAISecure into a real IoT monitoring and control appliance using Suricata (IDS), Pi-hole (DNS/DHCP), behavioral ML, and pluggable network enforcement (OpenWRT or generic DNS-only).

## Architecture Overview
- **Detection:** Suricata on the Pi watches mirrored IoT traffic; emits EVE JSON (alerts/flows/DNS/HTTP). Behavioral ML scores per-device traffic patterns.
- **Control/Enforcement:** Pluggable provider:
  - **OpenWRT provider (strong):** firewall/ipset (and optional quarantine VLAN/SSID) to block/quarantine by IP/MAC.
  - **Generic provider (soft):** Pi-hole DNS deny-all group (+ optional Pi-hole DHCP ignore). Suitable when router has no API.
  - Config: `ENFORCEMENT_PROVIDER=openwrt | generic | none`.
- **DNS/DHCP:** Pi-hole for filtering and device discovery; optionally DHCP for lease-based discovery and DNS grouping.
- **Orchestrator:** EdgeAISecure backend/UI + Postgres. Background jobs for ingestion, scoring, and enforcement.

## Database Additions
- `device_flow_stats` (per device per time window): `device_id`, window timestamps, bytes/packets in/out, unique dst IPs/ports, protocol ratios, dns_qpm, etc.
- Optional: `alerts.source` (suricata | ml | admin) if not already present; optional `enforcement_state`.

## Phased Plan

### Phase 1 — Base Stack on Pi
- Install Node 20+, Postgres, Python 3.10+, Suricata, Pi-hole.
- Decide DHCP owner (Pi-hole vs router). Run app with Postgres (`DATABASE_URL`), migrations/seed for dev only. Verify API/UI.

### Phase 2 — Enforcement Provider Abstraction
- Add interface: `block({ ip, mac })`, `unblock`, `quarantine`, `release`, `health`.
- Env switch: `ENFORCEMENT_PROVIDER=openwrt|generic|none`.
- Update device block/unblock/quarantine routes to call the selected provider.

### Phase 3 — Generic Provider (DNS-first)
- Implement Pi-hole service (env: `PIHOLE_API_URL`, `PIHOLE_API_TOKEN`).
- DNS block: move client (IP/MAC/hostname) into a deny-all group (regex `.*`); remove on unblock.
- If Pi-hole DHCP: support `dhcp-host=MAC,ignore` + `pihole restartdns reload` (note static-IP bypass risk).
- UI: warn when in DNS-only mode (soft block).

### Phase 4 — OpenWRT Provider (strong)
- Control via SSH or ubus/HTTP.
- Add/remove IP/MAC to firewall/ipset drop set; optional quarantine VLAN/SSID.
- Health check (can list/manipulate sets).
- UI: show provider status and last apply/remove result.

### Phase 5 — Pi-hole Discovery Sync
- Background job: pull Pi-hole clients/leases; map/create devices (IP, MAC, hostname).
- Optionally record DNS query counts per device for features.

### Phase 6 — Suricata Ingestion
- Configure Suricata to listen on mirrored interface; enable EVE JSON (`alert`, `flow`, `dns`, `http`).
- Ingestor service (Python/Node) tails `eve.json`:
  - Alerts → map to device → insert into `alerts` with `source=suricata`, severity from priority, description from signature. Optional auto-quarantine on critical signatures via internal API (reuse provider + Pi-hole).
  - Flows → aggregate per device per window into `device_flow_stats`.

### Phase 7 — Behavioral ML
- Features per device from `device_flow_stats` + DNS counts + Suricata alert counts.
- Model: start with Isolation Forest / One-Class SVM (Python, joblib).
- ML service: `/ml/score` returns `anomaly_score` + label.
- Scheduler (Node): periodically build features, call ML, create `alerts` with `source=ml`; optional auto-quarantine when score exceeds policy.

### Phase 8 — UI/Policy Wiring
- Show alert source (Suricata/ML/Admin) and enforcement status: provider (OpenWRT/generic/none), DNS block state, firewall/ipset/VLAN state.
- Policy toggles: auto-quarantine on Suricata critical signatures; auto-quarantine on high ML scores.
- Health badges: Suricata ingest, Pi-hole API, enforcement provider, ML service.

### Phase 9 — Hardening & Ops
- Secrets/env, TLS/HTTPS, rate limiting, CSRF (if cookies), strict Zod validation.
- Structured logging and basic metrics (Prometheus/OpenTelemetry optional).
- Service management: systemd or Docker for backend, ingestor, ML service.
- CI/CD: lint/test/build; migrations on deploy.

## Recommended Initial Tasks (order)
1) Add provider interface + env switch; stub providers.
2) Implement Pi-hole service + generic provider; wire block/unblock/quarantine routes to it.
3) Implement OpenWRT provider (SSH/ipset or ubus/nftables) + health check.
4) Configure Suricata EVE; build minimal ingestor to write Suricata alerts to `alerts` (`source=suricata`).
5) Add `device_flow_stats`; ingest flow aggregates.
6) Build ML scorer + scheduler; create ML-sourced alerts (no auto-quarantine initially).
7) Enable auto-quarantine policies; dual enforcement (provider + Pi-hole DNS).
8) UI: surface enforcement state and alert sources; warnings for DNS-only mode.


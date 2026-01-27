/*
 * ESP8266 IoT Security Test Device
 * 
 * Normal Mode: Relay controller for Home Assistant (via REST API)
 * Test Mode: Physical button triggers network anomalies for testing EdgeAI detection
 * 
 * Hardware:
 * - NodeMCU ESP8266 or equivalent
 * - Relay module on D1 (GPIO5)
 * - Physical button on D2 (GPIO4) - ANOMALY TRIGGER
 * - LED on D4 (built-in LED for status)
 * 
 * Configure your WiFi and Home Assistant settings below.
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <WiFiClient.h>
#include <WiFiUdp.h>

// ==================== CONFIGURATION ====================
// WiFi Settings (IoT-Secure Hotspot)
const char* WIFI_SSID = "IoT-Secure";
const char* WIFI_PASSWORD = "ipldlx3dd7h";

// Home Assistant Settings (optional - for HA integration)
const char* HA_HOST = "192.168.50.1";  // Change to your HA IP
const int HA_PORT = 8123;
const char* HA_TOKEN = "YOUR_LONG_LIVED_ACCESS_TOKEN";  // Get from HA profile

// Device Settings
const char* DEVICE_NAME = "ESP8266-Relay";
const int RELAY_PIN = D1;      // GPIO5 - Relay control
const int BUTTON_PIN = D2;     // GPIO4 - Anomaly trigger button
const int LED_PIN = LED_BUILTIN;  // Built-in LED

// Anomaly test targets (common suspicious destinations)
const char* SUSPICIOUS_HOSTS[] = {
  "185.220.101.42",   // Known Tor exit node
  "192.168.50.254",   // Non-existent internal IP
  "10.0.0.1",         // Different network
  "8.8.4.4",          // External DNS
  "1.1.1.1",          // Cloudflare DNS
};
const int SUSPICIOUS_PORTS[] = { 22, 23, 445, 3389, 4444, 9001, 31337 };

// ==================== GLOBALS ====================
ESP8266WebServer server(80);
WiFiClient wifiClient;
bool relayState = false;
bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50;
bool anomalyMode = false;
int anomalyPhase = 0;

// Automatic traffic generation intervals (milliseconds)
// HIGH FREQUENCY for algorithm training - will generate ~20+ flows/min
const unsigned long HEARTBEAT_INTERVAL = 5000;   // Traffic burst every 5 seconds
const unsigned long NTP_INTERVAL = 60000;        // NTP every 1 minute
unsigned long lastHeartbeat = 0;
unsigned long lastNtpSync = 0;
unsigned long trafficCount = 0;

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n\n=== ESP8266 IoT Security Test Device ===");
  
  // Initialize pins
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT);  // No pullup - HIGH triggers anomaly
  pinMode(LED_PIN, OUTPUT);
  
  digitalWrite(RELAY_PIN, HIGH);  // HIGH = OFF for active-LOW relay
  digitalWrite(LED_PIN, HIGH);  // LED off (inverted)
  
  // Connect to WiFi
  connectWiFi();
  
  // Setup web server for Home Assistant
  setupWebServer();
  
  Serial.println("\n=== Device Ready ===");
  Serial.println("Web Interface: http://" + WiFi.localIP().toString());
  Serial.println("Press the button on D2 to trigger anomaly test");
}

// ==================== MAIN LOOP ====================
void loop() {
  server.handleClient();
  
  // Check button
  checkButton();
  
  // Generate normal traffic for behavior learning (always runs)
  generateNormalTraffic();
  
  // If in anomaly mode, continue anomaly sequence
  if (anomalyMode) {
    runAnomalySequence();
  }
  
  // Blink LED if anomaly mode active
  if (anomalyMode) {
    digitalWrite(LED_PIN, (millis() / 100) % 2);
  }
}

// ==================== WIFI ====================
void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("MAC Address: ");
    Serial.println(WiFi.macAddress());
    digitalWrite(LED_PIN, HIGH);  // LED off
  } else {
    Serial.println("\nWiFi Connection Failed!");
  }
}

// ==================== AUTOMATIC TRAFFIC GENERATION ====================
// This generates normal IoT traffic patterns for EdgeAI to learn baseline behavior
// HIGH FREQUENCY VERSION - generates ~20+ flows per minute for algorithm training

void generateNormalTraffic() {
  unsigned long currentMillis = millis();
  
  // Traffic burst every 5 seconds (12 bursts/min = lots of flows)
  if (currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = currentMillis;
    trafficCount++;
    
    // Rotate through different traffic types for variety
    int trafficType = trafficCount % 6;
    
    switch (trafficType) {
      case 0:
        // DNS Query #1 - NTP server
        { 
          IPAddress result;
          WiFi.hostByName("pool.ntp.org", result);
        }
        break;
        
      case 1:
        // DNS Query #2 - Google
        {
          IPAddress result;
          WiFi.hostByName("www.google.com", result);
        }
        break;
        
      case 2:
        // HTTP to gateway (like checking for updates)
        {
          WiFiClient client;
          client.setTimeout(500);
          if (client.connect(WiFi.gatewayIP(), 80)) {
            client.print("GET /status HTTP/1.1\r\n");
            client.print("Host: ");
            client.print(WiFi.gatewayIP().toString());
            client.print("\r\nUser-Agent: ESP8266-IoT/1.0\r\n");
            client.print("Connection: close\r\n\r\n");
            delay(20);
            client.stop();
          }
        }
        break;
        
      case 3:
        // HTTP to internal IP (like talking to another IoT device)
        {
          WiFiClient client;
          client.setTimeout(200);
          IPAddress target(192, 168, 50, 1);  // Gateway
          if (client.connect(target, 80)) {
            client.print("GET /api/health HTTP/1.1\r\n");
            client.print("Host: iot-device\r\nConnection: close\r\n\r\n");
            delay(10);
            client.stop();
          }
        }
        break;
        
      case 4:
        // DNS Query #3 - time server
        {
          IPAddress result;
          WiFi.hostByName("time.google.com", result);
        }
        break;
        
      case 5:
        // TCP connection to common IoT port (like MQTT broker check)
        {
          WiFiClient client;
          client.setTimeout(200);
          if (client.connect(WiFi.gatewayIP(), 1883)) {
            // Send MQTT PINGREQ-like packet
            byte pingReq[] = {0xC0, 0x00};
            client.write(pingReq, 2);
            delay(10);
            client.stop();
          }
        }
        break;
    }
    
    // Also do a secondary HTTP request every burst for more flows
    {
      WiFiClient client;
      client.setTimeout(300);
      if (client.connect(WiFi.gatewayIP(), 80)) {
        client.print("GET /heartbeat?id=");
        client.print(trafficCount);
        client.print(" HTTP/1.1\r\nHost: ");
        client.print(WiFi.gatewayIP().toString());
        client.print("\r\nConnection: close\r\n\r\n");
        delay(15);
        client.stop();
      }
    }
    
    // Log every 20 heartbeats (~100 seconds)
    if (trafficCount % 20 == 0) {
      Serial.print("[Traffic] Count: ");
      Serial.print(trafficCount);
      Serial.print(" | Flows: ~");
      Serial.print(trafficCount * 3);  // Estimate 3 flows per burst
      Serial.print(" | RSSI: ");
      Serial.print(WiFi.RSSI());
      Serial.println(" dBm");
    }
  }
  
  // NTP Sync every minute (generates UDP flow)
  if (currentMillis - lastNtpSync >= NTP_INTERVAL) {
    lastNtpSync = currentMillis;
    
    WiFiUDP udp;
    const int NTP_PACKET_SIZE = 48;
    byte packetBuffer[NTP_PACKET_SIZE];
    
    memset(packetBuffer, 0, NTP_PACKET_SIZE);
    packetBuffer[0] = 0b11100011;
    packetBuffer[1] = 0;
    packetBuffer[2] = 6;
    packetBuffer[3] = 0xEC;
    
    IPAddress ntpIP;
    if (WiFi.hostByName("pool.ntp.org", ntpIP)) {
      udp.begin(random(1024, 65535));  // Random source port
      udp.beginPacket(ntpIP, 123);
      udp.write(packetBuffer, NTP_PACKET_SIZE);
      udp.endPacket();
      delay(10);
      udp.stop();
    }
  }
}

// ==================== WEB SERVER ====================
void setupWebServer() {
  // Root page - device status
  server.on("/", HTTP_GET, []() {
    String html = "<html><head><title>" + String(DEVICE_NAME) + "</title>";
    html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
    html += "<style>body{font-family:Arial;margin:20px;} .btn{padding:15px 30px;margin:10px;font-size:18px;cursor:pointer;}</style></head>";
    html += "<body><h1>" + String(DEVICE_NAME) + "</h1>";
    html += "<p>Relay: <strong>" + String(relayState ? "ON" : "OFF") + "</strong></p>";
    html += "<p>WiFi: " + String(WiFi.RSSI()) + " dBm</p>";
    html += "<p>IP: " + WiFi.localIP().toString() + "</p>";
    html += "<p>MAC: " + WiFi.macAddress() + "</p>";
    html += "<hr><h2>Relay Control</h2>";
    html += "<button class='btn' onclick=\"fetch('/relay/on').then(()=>location.reload())\">Turn ON</button>";
    html += "<button class='btn' onclick=\"fetch('/relay/off').then(()=>location.reload())\">Turn OFF</button>";
    html += "<button class='btn' onclick=\"fetch('/relay/toggle').then(()=>location.reload())\">Toggle</button>";
    html += "<hr><h2>Anomaly Test (Hidden)</h2>";
    html += "<p><small>Press physical button on D2 to trigger</small></p>";
    html += "<p>Anomaly Mode: " + String(anomalyMode ? "ACTIVE" : "Inactive") + "</p>";
    html += "</body></html>";
    server.send(200, "text/html", html);
  });
  
  // Relay control endpoints
  server.on("/relay/on", HTTP_GET, []() {
    relayState = true;
    digitalWrite(RELAY_PIN, LOW);  // LOW = ON for active-LOW relay
    Serial.println("[Relay] ON");
    server.send(200, "application/json", "{\"state\":\"on\"}");
    notifyHA();
  });
  
  server.on("/relay/off", HTTP_GET, []() {
    relayState = false;
    digitalWrite(RELAY_PIN, HIGH);  // HIGH = OFF for active-LOW relay
    Serial.println("[Relay] OFF");
    server.send(200, "application/json", "{\"state\":\"off\"}");
    notifyHA();
  });
  
  server.on("/relay/toggle", HTTP_GET, []() {
    relayState = !relayState;
    digitalWrite(RELAY_PIN, relayState ? LOW : HIGH);  // Inverted for active-LOW relay
    Serial.println("[Relay] " + String(relayState ? "ON" : "OFF"));
    server.send(200, "application/json", "{\"state\":\"" + String(relayState ? "on" : "off") + "\"}");
    notifyHA();
  });
  
  // Status endpoint (for Home Assistant REST sensor)
  server.on("/status", HTTP_GET, []() {
    String json = "{";
    json += "\"device\":\"" + String(DEVICE_NAME) + "\",";
    json += "\"relay\":" + String(relayState ? "true" : "false") + ",";
    json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
    json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
    json += "\"mac\":\"" + WiFi.macAddress() + "\",";
    json += "\"uptime\":" + String(millis() / 1000);
    json += "}";
    server.send(200, "application/json", json);
  });
  
  server.begin();
  Serial.println("Web server started on port 80");
}

// ==================== BUTTON HANDLER ====================
void checkButton() {
  static unsigned long lastDebugPrint = 0;
  int reading = digitalRead(BUTTON_PIN);
  
  // Debug output every 2 seconds - shows current D2 state
  if (millis() - lastDebugPrint > 2000) {
    lastDebugPrint = millis();
    Serial.print("[D2 Status] Pin = ");
    Serial.print(reading == HIGH ? "HIGH" : "LOW");
    Serial.print(" | Anomaly Mode = ");
    Serial.println(anomalyMode ? "ACTIVE" : "inactive");
  }
  
  // Simple logic: If D2 is HIGH, start anomaly (if not already running)
  if (reading == HIGH && !anomalyMode) {
    Serial.println("\n!!! D2 DETECTED HIGH !!!");
    startAnomalySequence();
  }
  
  // If D2 goes LOW while anomaly is running, stop it
  if (reading == LOW && anomalyMode) {
    Serial.println("\n!!! D2 DETECTED LOW - STOPPING !!!");
    stopAnomalySequence();
  }
}

// ==================== ANOMALY SEQUENCE ====================
void startAnomalySequence() {
  Serial.println("\n");
  Serial.println("****************************************");
  Serial.println("*    D2 = HIGH - ANOMALY TRIGGERED!    *");
  Serial.println("****************************************");
  Serial.println("Starting suspicious network activity...");
  Serial.println("Watch EdgeAI dashboard for alerts!");
  Serial.println("");
  anomalyMode = true;
  anomalyPhase = 0;
}

void stopAnomalySequence() {
  Serial.println("=== STOPPING ANOMALY SEQUENCE ===");
  anomalyMode = false;
  anomalyPhase = 0;
  digitalWrite(LED_PIN, HIGH);
}

void runAnomalySequence() {
  static unsigned long lastAnomalyTime = 0;
  
  // Run each phase every 2 seconds
  if (millis() - lastAnomalyTime < 2000) {
    return;
  }
  lastAnomalyTime = millis();
  
  switch (anomalyPhase) {
    case 0:
      Serial.println("\n[Anomaly Phase 1/5] Port Scanning...");
      performPortScan();
      break;
    case 1:
      Serial.println("\n[Anomaly Phase 2/5] Connecting to Tor exit node...");
      connectToSuspiciousHost(0);
      break;
    case 2:
      Serial.println("\n[Anomaly Phase 3/5] Scanning internal network...");
      scanInternalNetwork();
      break;
    case 3:
      Serial.println("\n[Anomaly Phase 4/5] High-frequency connections...");
      burstConnections();
      break;
    case 4:
      Serial.println("\n[Anomaly Phase 5/5] Suspicious port connections...");
      connectToSuspiciousPorts();
      break;
    default:
      Serial.println("\n=== ANOMALY SEQUENCE COMPLETE ===");
      Serial.println("Check EdgeAI dashboard for alerts!");
      stopAnomalySequence();
      return;
  }
  
  anomalyPhase++;
}

// ==================== ANOMALY FUNCTIONS ====================

// Phase 1: Port scan on gateway
void performPortScan() {
  IPAddress gateway = WiFi.gatewayIP();
  Serial.print("Scanning gateway: ");
  Serial.println(gateway);
  
  int portsToScan[] = {21, 22, 23, 25, 53, 80, 443, 445, 3306, 3389, 8080};
  
  for (int i = 0; i < 11; i++) {
    WiFiClient client;
    client.setTimeout(100);  // Fast timeout
    
    Serial.print("  Port ");
    Serial.print(portsToScan[i]);
    
    if (client.connect(gateway, portsToScan[i])) {
      Serial.println(" - OPEN");
      client.stop();
    } else {
      Serial.println(" - closed");
    }
    yield();  // Let ESP handle background tasks
  }
}

// Phase 2: Connect to suspicious external host
void connectToSuspiciousHost(int index) {
  const char* host = SUSPICIOUS_HOSTS[index % 5];
  Serial.print("Connecting to: ");
  Serial.println(host);
  
  WiFiClient client;
  client.setTimeout(500);
  
  if (client.connect(host, 80)) {
    Serial.println("  Connected!");
    client.print("GET / HTTP/1.1\r\nHost: ");
    client.print(host);
    client.print("\r\n\r\n");
    delay(100);
    client.stop();
  } else {
    Serial.println("  Connection failed (expected)");
  }
}

// Phase 3: Scan internal network
void scanInternalNetwork() {
  Serial.println("Scanning 192.168.50.0/24 for hosts...");
  
  for (int i = 1; i <= 20; i++) {
    IPAddress target(192, 168, 50, i);
    
    WiFiClient client;
    client.setTimeout(50);
    
    if (client.connect(target, 80)) {
      Serial.print("  Host found: ");
      Serial.println(target);
      client.stop();
    }
    yield();
  }
}

// Phase 4: Burst of rapid connections (unusual for IoT)
void burstConnections() {
  Serial.println("Making 50 rapid connections...");
  
  for (int i = 0; i < 50; i++) {
    WiFiClient client;
    client.setTimeout(50);
    
    // Connect to random ports on gateway
    client.connect(WiFi.gatewayIP(), random(1024, 65535));
    client.stop();
    yield();
  }
  Serial.println("  Burst complete");
}

// Phase 5: Connect to suspicious ports
void connectToSuspiciousPorts() {
  Serial.println("Connecting to suspicious ports...");
  
  for (int i = 0; i < 7; i++) {
    WiFiClient client;
    client.setTimeout(100);
    
    int port = SUSPICIOUS_PORTS[i];
    Serial.print("  Trying port ");
    Serial.print(port);
    
    // Try on gateway
    if (client.connect(WiFi.gatewayIP(), port)) {
      Serial.println(" - connected");
      client.stop();
    } else {
      Serial.println(" - failed");
    }
    yield();
  }
}

// ==================== HOME ASSISTANT INTEGRATION ====================
void notifyHA() {
  // Optional: Send state update to Home Assistant
  if (strlen(HA_TOKEN) < 10) {
    return;  // No token configured
  }
  
  HTTPClient http;
  WiFiClient client;
  
  String url = "http://" + String(HA_HOST) + ":" + String(HA_PORT) + "/api/states/switch.esp8266_relay";
  
  http.begin(client, url);
  http.addHeader("Authorization", "Bearer " + String(HA_TOKEN));
  http.addHeader("Content-Type", "application/json");
  
  String payload = "{\"state\":\"" + String(relayState ? "on" : "off") + "\",\"attributes\":{\"friendly_name\":\"ESP8266 Relay\"}}";
  
  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.print("[HA] Update sent, response: ");
    Serial.println(httpCode);
  }
  http.end();
}

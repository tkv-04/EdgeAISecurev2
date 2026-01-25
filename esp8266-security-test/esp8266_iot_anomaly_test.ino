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

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n\n=== ESP8266 IoT Security Test Device ===");
  
  // Initialize pins
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  
  digitalWrite(RELAY_PIN, LOW);
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
    digitalWrite(RELAY_PIN, HIGH);
    Serial.println("[Relay] ON");
    server.send(200, "application/json", "{\"state\":\"on\"}");
    notifyHA();
  });
  
  server.on("/relay/off", HTTP_GET, []() {
    relayState = false;
    digitalWrite(RELAY_PIN, LOW);
    Serial.println("[Relay] OFF");
    server.send(200, "application/json", "{\"state\":\"off\"}");
    notifyHA();
  });
  
  server.on("/relay/toggle", HTTP_GET, []() {
    relayState = !relayState;
    digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
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
  int reading = digitalRead(BUTTON_PIN);
  
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading == LOW && lastButtonState == HIGH) {
      // Button pressed!
      Serial.println("\n!!! ANOMALY BUTTON PRESSED !!!");
      if (!anomalyMode) {
        startAnomalySequence();
      } else {
        stopAnomalySequence();
      }
    }
  }
  
  lastButtonState = reading;
}

// ==================== ANOMALY SEQUENCE ====================
void startAnomalySequence() {
  Serial.println("=== STARTING ANOMALY SEQUENCE ===");
  Serial.println("This will trigger suspicious network activity to test detection.");
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

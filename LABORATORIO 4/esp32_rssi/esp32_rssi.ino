#include <WiFi.h>
#include <WebSocketsClient.h>

const char* WIFI_SSID = "LabTel-3";
const char* WIFI_PASS = "Campus03";
const char* SERVER_IP = "10.30.40.126";

const uint16_t SERVER_PORT = 8080;
const char* SERVER_PATH = "/ws/rssi";
const unsigned long INTERVALO_MS = 100;

WebSocketsClient webSocket;
unsigned long ultimoEnvio = 0;
bool conectadoWS = false;

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WebSocket conectado");
      conectadoWS = true;
      break;
    case WStype_DISCONNECTED:
      Serial.println("WebSocket desconectado");
      conectadoWS = false;
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Conectando a WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi conectado, IP: ");
  Serial.println(WiFi.localIP());

  webSocket.begin(SERVER_IP, SERVER_PORT, SERVER_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();

  if (conectadoWS && millis() - ultimoEnvio >= INTERVALO_MS) {
    ultimoEnvio = millis();
    String mensaje = String(WiFi.RSSI());
    webSocket.sendTXT(mensaje);
  }
}

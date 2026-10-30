process.loadEnvFile();

const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { WebSocketServer, WebSocket } = require('ws');

for (const nombre of ['THINGSPEAK_WRITE_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
  if (!process.env[nombre]) {
    console.error(`Falta ${nombre} en el archivo .env`);
    process.exit(1);
  }
}

const PORT = 8080;
const THINGSPEAK_KEY = process.env.THINGSPEAK_WRITE_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const INTERVALO_THINGSPEAK_MS = 20000;
const UMBRAL_ALERTA = -80;
const UMBRAL_RECUPERACION = -75;
const MIN_ENTRE_AVISOS_MS = 30000;
const TIMEOUT_ESP32_MS = 2000;

let ultimoRssi = null;
let hayMuestraNueva = false;
let senalBaja = false;
let ultimoAvisoMs = 0;
let ultimaMuestraMs = 0;
let esp32Caido = false;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = createServer(app);

const espWss = new WebSocketServer({ noServer: true });
const webWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const wss = pathname === '/ws/rssi' ? espWss : pathname === '/ws/web' ? webWss : null;
  if (!wss) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function broadcast(texto) {
  for (const client of webWss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(texto);
  }
}

async function enviarTelegram(texto) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: texto })
    });
    if (!res.ok) console.error('Telegram:', res.status, await res.text());
  } catch (err) {
    console.error('Error al enviar a Telegram:', err.message);
  }
}

function comprobarSenal(rssi) {
  if (!senalBaja && rssi < UMBRAL_ALERTA) {
    senalBaja = true;
    if (Date.now() - ultimoAvisoMs >= MIN_ENTRE_AVISOS_MS) {
      ultimoAvisoMs = Date.now();
      enviarTelegram(`Alerta: señal WiFi baja (${rssi} dBm, umbral ${UMBRAL_ALERTA} dBm)`);
    }
  } else if (senalBaja && rssi > UMBRAL_RECUPERACION) {
    senalBaja = false;
  }
}

espWss.on('connection', (ws) => {
  console.log('ESP32 conectado');

  ws.on('message', (data) => {
    const texto = data.toString();
    const v = Number(texto);
    if (!Number.isNaN(v)) {
      ultimoRssi = v;
      hayMuestraNueva = true;
      ultimaMuestraMs = Date.now();
      if (esp32Caido) {
        esp32Caido = false;
        enviarTelegram('ESP32 de nuevo en línea');
      }
      comprobarSenal(v);
    }
    broadcast(texto);
  });

  ws.on('close', () => console.log('ESP32 desconectado'));
});

webWss.on('connection', () => console.log('Navegador conectado'));

async function subirAThingSpeak() {
  if (!hayMuestraNueva) return;
  hayMuestraNueva = false;

  try {
    const res = await fetch('https://api.thingspeak.com/update.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: THINGSPEAK_KEY, field1: ultimoRssi })
    });
    console.log('ThingSpeak:', res.status, await res.text());
  } catch (err) {
    console.error('Error al subir a ThingSpeak:', err.message);
  }
}

setInterval(subirAThingSpeak, INTERVALO_THINGSPEAK_MS);

setInterval(() => {
  if (ultimaMuestraMs && !esp32Caido && Date.now() - ultimaMuestraMs > TIMEOUT_ESP32_MS) {
    esp32Caido = true;
    enviarTelegram('Alerta: ESP32 sin conexión (sin datos desde hace más de 2 s)');
  }
}, 500);

server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
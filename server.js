const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json());

const token = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new TelegramBot(token, { polling: true });

let streamStatus = false;

// Start Stream
bot.onText(/\/start_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;

    streamStatus = true;
    bot.sendMessage(msg.chat.id, "✅ Stream Started");
});

// Stop Stream
bot.onText(/\/stop_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;

    streamStatus = false;
    bot.sendMessage(msg.chat.id, "🛑 Stream Stopped");
});

// Status API for Android
app.get("/status", (req, res) => {
    res.json({ stream: streamStatus });
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server Running...");
});
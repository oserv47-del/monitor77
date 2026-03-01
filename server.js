const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = process.env.ADMIN_ID;

let androidClient = null;

wss.on("connection", (ws) => {
    androidClient = ws;
    console.log("Android connected");
});

// Generate Agora Token
function generateToken(channel) {
    const uid = 0;
    const role = RtcRole.PUBLISHER;
    const expireTime = 3600;

    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;

    return RtcTokenBuilder.buildTokenWithUid(
        process.env.AGORA_APP_ID,
        process.env.AGORA_CERT,
        channel,
        uid,
        role,
        privilegeExpireTime
    );
}

bot.onText(/\/start_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;

    const channel = "educationLive";
    const token = generateToken(channel);

    if (androidClient) {
        androidClient.send(JSON.stringify({
            action: "start",
            channel,
            token
        }));
    }

    bot.sendMessage(msg.chat.id, "✅ Stream Started");
});

bot.onText(/\/stop_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;

    if (androidClient) {
        androidClient.send(JSON.stringify({
            action: "stop"
        }));
    }

    bot.sendMessage(msg.chat.id, "🛑 Stream Stopped");
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server Running...");
});
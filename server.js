const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const WebSocket = require("ws");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = process.env.ADMIN_ID;

let androidSocket = null;

wss.on("connection", (ws) => {
    androidSocket = ws;
});

// Generate Agora Token
function generateToken(channel) {
    const appID = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_CERT;

    const uid = 0;
    const role = RtcRole.PUBLISHER;
    const expireTime = 3600;
    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;

    return RtcTokenBuilder.buildTokenWithUid(
        appID,
        appCertificate,
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

    if (androidSocket) {
        androidSocket.send(JSON.stringify({
            action: "start",
            channel,
            token
        }));
    }

    const streamLink = `https://viewer.yoursite.com/?channel=${channel}`;
    bot.sendMessage(msg.chat.id, `✅ Stream Started\n${streamLink}`);
});

bot.onText(/\/stop_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) return;

    if (androidSocket) {
        androidSocket.send(JSON.stringify({
            action: "stop"
        }));
    }

    bot.sendMessage(msg.chat.id, "🛑 Stream Stopped");
});

server.listen(process.env.PORT || 3000);
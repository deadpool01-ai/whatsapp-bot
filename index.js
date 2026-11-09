const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot 7/24 aktif çalışıyor!'));
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('--- QR KODU (Logs Ekranından Tara) ---');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
});

client.on('message', async (msg) => {
  try {
    const chat = model.startChat();
    const result = await chat.sendMessage(msg.body);
    const response = await result.response;
    await msg.reply(response.text());
  } catch (error) {
    console.error('Mesaj hatası:', error);
  }
});

// Sessiz kapanmaları önlemek için hata yakalayıcılar
process.on('unhandledRejection', (reason) => {
  console.error('Yakalanamayan Hata:', reason);
});

client.initialize().catch(err => {
  console.error('Client baslatma hatasi:', err);
});

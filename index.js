const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';

// Ana sayfa
app.get('/', (req, res) => res.send('Bot aktif çalışıyor! QR kod için /qr adresine gidin.'));

// QR Kodu Web Sayfası Olarak Gösteren Rota
app.get('/qr', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>QR kod hazırlanıyor veya zaten giriş yapıldı!</h2>
        <p>Lütfen 10-15 saniye bekleyip sayfayı yenileyin (F5).</p>
      </div>
    `);
  }
  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:90vh; font-family:sans-serif;">
        <h1 style="color:#25D366;">WhatsApp Koçluk Botu Eşleştirme</h1>
        <img src="${qrImage}" style="width:280px; height:280px; border:3px solid #25D366; padding:15px; border-radius:12px;"/>
        <p style="margin-top:20px; font-size:18px;">Telefonundan <b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla</b> kısmından tara.</p>
      </div>
    `);
  } catch (err) {
    res.send('QR kod resme dönüştürülürken hata oluştu.');
  }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

// Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

// WhatsApp İstemci
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
  console.log('✅ YENİ QR KODU ALINDI! /qr adresinden görebilirsin.');
  latestQR = qr;
});

client.on('ready', () => {
  console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
  latestQR = ''; // Giriş yapıldıktan sonra QR'ı temizle
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

client.initialize().catch(err => {
  console.error('Client başlatma hatası:', err);
});
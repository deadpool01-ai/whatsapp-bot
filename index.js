const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let isReady = false;
let activeSock = null;

// --- WEB ARAYÜZÜ ---
app.get('/', (req, res) => res.send('Bot aktif! Bağlanmak için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  if (isReady) return res.send('<h1 style="color:green;text-align:center;margin-top:50px;">✅ Koçun Aktif! WhatsApp "Siz" sohbetinden yazabilirsin.</h1>');
  let qrHtml = '<p>QR hazırlanıyor...</p>';
  if (latestQR) {
    try { qrHtml = `<img src="${await QRCode.toDataURL(latestQR)}" style="width:220px; border:2px solid #ccc; padding:10px; border-radius:10px;"/>`; } catch (e) {}
  }
  res.send(`
    <div style="text-align:center; padding:20px; font-family:sans-serif;">
      <h1 style="color:#25D366;">WhatsApp Bot Bağlantısı</h1>
      <div style="background:#f4f4f4; padding:20px; border-radius:12px; display:inline-block; margin-bottom:20px;">
        <h3>Telefon Numarası ile (Önerilen)</h3>
        <form action="/pair" method="GET">
          <input type="text" name="number" placeholder="905XXXXXXXXX" required style="padding:10px; font-size:16px;"/>
          <button type="submit" style="padding:10px; background:#25D366; color:white; border:none; cursor:pointer;">Kod Al</button>
        </form>
      </div>
      <div><h4>veya QR ile</h4>${qrHtml}</div>
    </div>
  `);
});

app.get('/pair', async (req, res) => {
  if (!activeSock) return res.send('Soket hazır değil, yenile.');
  const num = (req.query.number || '').replace(/\D/g, '');
  if (num.length < 11) return res.send('Hatalı numara. <a href="/qr">Geri</a>');
  try {
    const code = await activeSock.requestPairingCode(num);
    res.send(`<h2 style="text-align:center; margin-top:50px;">Eşleştirme Kodun: <br><br><span style="color:#25D366; font-size:40px; letter-spacing:5px;">${code}</span></h2>`);
  } catch (err) { res.send(`Hata: ${err.message}`); }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

// --- GEMINI YAPAY ZEKA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

// --- WHATSAPP BOT ÇEKİRDEĞİ ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }), // Çöp logları tamamen kapattık
    browser: Browsers.macOS('Desktop'), // WhatsApp'ın engellememesi için Mac cihaz gibi davranıyoruz
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) latestQR = qr;

    if (connection === 'open') {
      console.log('🚀 DİKKAT: WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
      isReady = true;
      latestQR = '';
      
      // İlk mesajı atarak şifrelemeyi kırıyoruz
      const myJid = state.creds.me?.id?.split(':')[0] + '@s.whatsapp.net';
      if (myJid && !myJid.startsWith('undefined')) {
         sock.sendMessage(myJid, { text: '💪 Koçun 7/24 aktif! Bana buradan hedeflerini yazabilirsin.\u200B' }).catch(()=>{});
      }
    }

    if (connection === 'close') {
      isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 515) {
        console.log('🔄 WhatsApp senkronizasyon istedi (515). Toparlanıyor...');
      } else {
        console.log(`⚠️ Bağlantı koptu (Kod: ${code}). Yeniden bağlanıyor...`);
      }
      setTimeout(connectToWhatsApp, 2000); // Kopsa bile 2 saniyeye ayağa kalkar
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      if (!msg.message) continue;

      // 1. Gelen mesaj zarfını her ihtimale karşı soy
      let raw = msg.message;
      if (raw.deviceSentMessage) raw = raw.deviceSentMessage.message;
      if (raw.ephemeralMessage) raw = raw.ephemeralMessage.message;
      if (raw.viewOnceMessage) raw = raw.viewOnceMessage.message;
      if (raw.viewOnceMessageV2) raw = raw.viewOnceMessageV2.message;

      const text = raw?.conversation || raw?.extendedTextMessage?.text;
      if (!text) continue;

      // 2. Kendi mesajımızı "Görünmez İmza" (\u200B) ile tanıyıp yoksay (Sonsuz döngüyü engeller)
      if (text.includes('\u200B')) continue;

      // 3. Geçmişten gelen (1 dakikadan eski) offline mesajları yanıtlama
      const msgTime = msg.messageTimestamp;
      const now = Math.floor(Date.now() / 1000);
      if (now - msgTime > 60) continue;

      // 4. JID Kontrolü: Sadece "Siz" sohbetine veya doğrudan sana atılanları dinle
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

      // Kimliği bağlantı anını beklemeden doğrudan oturum diskinden okuyoruz (515 hatasında kaybolmaz)
      const myJid = state.creds.me?.id?.split(':')[0]; 
      const senderJid = remoteJid.split('@')[0];

      const isSelfChat = myJid && senderJid.includes(myJid);
      const isIncoming = !msg.key.fromMe;

      // Eğer mesaj senden sana (Siz sohbeti) veya dışarıdan geliyorsa
      if (isSelfChat || isIncoming) {
        console.log(`📩 YAKALANDI: "${text}"`);

        try {
          const chat = model.startChat();
          const result = await chat.sendMessage(text);
          // Yanıta gözle görülmeyen imzamızı atıyoruz ki bot kendi yazdığını okumasın
          const replyText = result.response.text() + '\u200B'; 

          await sock.sendMessage(remoteJid, { text: replyText });
          console.log('✅ YANIT İLETİLDİ!');
        } catch (error) {
          console.error('❌ Gemini Hatası:', error);
        }
      }
    }
  });
}

connectToWhatsApp();
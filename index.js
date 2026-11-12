const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let activeSock = null;

app.get('/', (req, res) => res.send('X-Ray Modu Aktif. QR için /qr adresine git.'));

app.get('/qr', async (req, res) => {
  let qrHtml = '<p>QR kod bekleniyor, lütfen log ekranını takip et...</p>';
  if (latestQR) {
    try {
      const qrImage = await QRCode.toDataURL(latestQR);
      qrHtml = `<img src="${qrImage}" style="width:250px; height:250px; border:3px solid #25D366; padding:10px; border-radius:10px;"/>`;
    } catch (e) {}
  }

  res.send(`
    <div style="text-align:center; padding-top:50px; font-family:sans-serif;">
      <h1 style="color:#25D366;">WhatsApp X-Ray QR Bağlantısı</h1>
      <p style="color:#555;">Aşağıdaki QR kodu WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla ile okut:</p>
      <div style="margin-top:20px;">
        ${qrHtml}
      </div>
      <p style="margin-top:20px; font-size:12px; color:#888;">Sayfa her 5 saniyede bir otomatik yenilenir.</p>
      <script>setTimeout(() => window.location.reload(), 5000);</script>
    </div>
  `);
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

async function xRayBaslat() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'trace' }), 
    // Tarayıcı imzasını gerçek bir Windows Chrome masaüstü uygulaması olarak değiştiriyoruz (Geçersiz hatasını keser)
    browser: ['Windows', 'Chrome', '120.0.0.0'],
    syncFullHistory: false
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
      latestQR = qr;
      console.log('\n📌 YENİ QR KODU ÜRETİLDİ! Lütfen /qr adresine git veya terminalden linki kontrol et.');
    }

    if (connection === 'open') {
      console.log('\n\n🚀 X-RAY BAĞLANTISI BAŞARIYLA AÇILDI! ŞİMDİ GURUBA MESAJ AT...\n\n');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Bağlantı kapandı (Kod: ${code}). Yeniden başlatılıyor...`);
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(xRayBaslat, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    console.log('\n\n🚨🚨🚨 WHATSAPP\'TAN BİR SİNYAL / MESAJ GELDİ 🚨🚨🚨');
    console.log(JSON.stringify(m, null, 2));
    console.log('\n\n');
  });
}

xRayBaslat();
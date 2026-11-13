// oliam.eat - server pencatat transaksi dari WhatsApp
// Tanpa dependensi: cukup Node.js 18+ (`node server.js`)
//
// Variabel lingkungan (opsional tapi disarankan):
//   PORT                 port server (default 3000)
//   WEBHOOK_SECRET       kata rahasia; webhook dipanggil dengan ?secret=KATA_RAHASIA
//   OWNER_NUMBERS        nomor WA yang boleh mencatat, pisah koma. Contoh: 6281234567890,6285...
//   DASHBOARD_PASSWORD   password dashboard (user: admin). Kosong = tanpa password
//   FONNTE_TOKEN         token Fonnte, kalau mau bot membalas konfirmasi ke WhatsApp
//   META_TOKEN + META_PHONE_ID   alternatif: WhatsApp Cloud API resmi dari Meta

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseMessage, rupiah } = require('./parser');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const OWNERS = (process.env.OWNER_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean);
const DASH_PASS = process.env.DASHBOARD_PASSWORD || '';
const DATA_FILE = path.join(__dirname, 'data.json');
const MENU_FILE = path.join(__dirname, 'menu.json');

const load = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const save = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

let transactions = load(DATA_FILE, []);

// zona waktu WIB (UTC+7) untuk "hari ini"
const wibDate = ts => new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);

function rekapHariIni() {
  const today = wibDate(Date.now());
  const list = transactions.filter(t => wibDate(t.ts) === today);
  const total = list.reduce((s, t) => s + t.total, 0);
  const count = {};
  list.forEach(t => t.items.forEach(i => { count[i.name] = (count[i.name] || 0) + i.qty; }));
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, q]) => `- ${n}: ${q}`).join('\n');
  return `Rekap hari ini (${today})\nTransaksi: ${list.length}\nOmzet: ${rupiah(total)}` + (top ? `\n\nTerlaris:\n${top}` : '');
}

function handleMessage(sender, text) {
  const menu = load(MENU_FILE, {});
  const p = parseMessage(text, menu);

  if (p.type === 'rekap') return rekapHariIni();
  if (p.type === 'batal') {
    const last = transactions.pop();
    if (!last) return 'Belum ada transaksi untuk dibatalkan.';
    save(DATA_FILE, transactions);
    return `Transaksi #${last.id} (${rupiah(last.total)}) dibatalkan.`;
  }
  if (p.type === 'kosong') return 'Pesan kosong.';
  if (p.type === 'gagal') {
    return `Tidak bisa dibaca / harga tidak ditemukan: ${p.unknown.join(', ')}\nTulis harga dengan @, contoh: 2 nasi goreng @15000\nAtau tambahkan ke menu.json.`;
  }

  const id = (transactions.at(-1)?.id || 0) + 1;
  const trx = { id, ts: Date.now(), sender, customer: p.customer, items: p.items, total: p.total, raw: text };
  transactions.push(trx);
  save(DATA_FILE, transactions);

  const lines = p.items.map(i => `- ${i.qty} ${i.name} = ${rupiah(i.subtotal)}`).join('\n');
  let reply = `Tercatat #${id}${p.customer ? ' (' + p.customer + ')' : ''}\n${lines}\nTotal: ${rupiah(p.total)}`;
  if (p.unknown.length) reply += `\n\nTidak tercatat (harga tidak ada): ${p.unknown.join(', ')}`;
  return reply;
}

// ---- kirim balasan ke WhatsApp (opsional) ----
async function sendReply(to, text) {
  try {
    if (process.env.FONNTE_TOKEN) {
      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { Authorization: process.env.FONNTE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: to, message: text }),
      });
    } else if (process.env.META_TOKEN && process.env.META_PHONE_ID) {
      await fetch(`https://graph.facebook.com/v20.0/${process.env.META_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.META_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, text: { body: text } }),
      });
    }
  } catch (e) { console.error('Gagal kirim balasan:', e.message); }
}

// ---- ekstrak pesan dari berbagai penyedia ----
function extractIncoming(body) {
  // Meta WhatsApp Cloud API
  const m = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (m) return { sender: m.from, text: m.text?.body || '' };
  // Fonnte / generik: {sender, message}
  if (body?.sender && (body.message || body.text)) return { sender: String(body.sender), text: body.message || body.text };
  // Twilio-style form: From=whatsapp:+62..., Body=...
  if (body?.From && body?.Body) return { sender: String(body.From).replace(/\D/g, ''), text: body.Body };
  return null;
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve(Object.fromEntries(new URLSearchParams(data))); }
    });
  });
}

function authorized(req) {
  if (!DASH_PASS) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [, pass] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s);
  return pass === DASH_PASS;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // --- webhook WhatsApp ---
  if (url.pathname === '/webhook') {
    // verifikasi webhook Meta (GET)
    if (req.method === 'GET') {
      if (url.searchParams.get('hub.verify_token') === SECRET && SECRET) {
        return send(res, 200, url.searchParams.get('hub.challenge') || '', 'text/plain');
      }
      return send(res, 403, { error: 'forbidden' });
    }
    if (req.method === 'POST') {
      if (SECRET && url.searchParams.get('secret') !== SECRET) return send(res, 403, { error: 'secret salah' });
      const body = await readBody(req);
      const msg = extractIncoming(body);
      if (!msg) return send(res, 200, { ok: true, ignored: true });
      if (OWNERS.length && !OWNERS.includes(msg.sender.replace(/\D/g, ''))) {
        return send(res, 200, { ok: true, ignored: 'nomor tidak diizinkan' });
      }
      const reply = handleMessage(msg.sender, msg.text);
      sendReply(msg.sender, reply);
      return send(res, 200, { ok: true, reply });
    }
  }

  // --- dashboard & API (pakai password) ---
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="oliam.eat"' });
    return res.end('Login diperlukan');
  }

  if (url.pathname === '/api/transactions' && req.method === 'GET') return send(res, 200, transactions);
  if (url.pathname === '/api/menu' && req.method === 'GET') return send(res, 200, load(MENU_FILE, {}));

  if (url.pathname === '/api/simulate' && req.method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, { reply: handleMessage('dashboard', body.text || '') });
  }

  const del = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
  if (del && req.method === 'DELETE') {
    transactions = transactions.filter(t => t.id !== Number(del[1]));
    save(DATA_FILE, transactions);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html');
  }

  send(res, 404, { error: 'tidak ditemukan' });
}).listen(PORT, () => console.log(`oliam.eat jalan di http://localhost:${PORT}`));

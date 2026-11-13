// Parser pesan WhatsApp -> transaksi oliam.eat
//
// Format pesan yang didukung (satu pesan = satu transaksi):
//   Budi: 2 nasi goreng, 1 es teh
//   2 nasi goreng, 1 es teh            (tanpa nama pelanggan)
//   2 nasi goreng @15000, 1 es teh @5000   (harga ditulis langsung)
//   1 paket hemat @25rb                (rb / k = ribu)
// Perintah:
//   rekap      -> ringkasan hari ini
//   batal      -> batalkan transaksi terakhir
//
// Harga diambil dari menu.json kalau tidak ditulis langsung.

function parseRupiah(txt) {
  const s = String(txt).toLowerCase().replace(/rp\.?\s*/g, '').replace(/\./g, '').replace(/,/g, '.').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(rb|ribu|k|jt|juta)?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'rb' || m[2] === 'ribu' || m[2] === 'k') n *= 1000;
  if (m[2] === 'jt' || m[2] === 'juta') n *= 1000000;
  return Math.round(n);
}

function normalize(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseMessage(text, menu = {}) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();

  if (/^(rekap|laporan|hari ini)$/.test(lower)) return { type: 'rekap' };
  if (/^(batal|hapus|undo)$/.test(lower)) return { type: 'batal' };
  if (!raw) return { type: 'kosong' };

  // nama pelanggan: "Budi: ..."
  let customer = '';
  let body = raw;
  const c = raw.match(/^([^:\d\n,@][^:\n]{0,40}):\s*([\s\S]+)$/);
  if (c) { customer = c[1].trim(); body = c[2]; }

  const menuNorm = {};
  for (const [k, v] of Object.entries(menu)) menuNorm[normalize(k)] = v;

  const parts = body.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  const items = [];
  const unknown = [];

  for (const part of parts) {
    // [qty] nama [@harga]
    const m = part.match(/^(?:(\d+)\s*x?\s+)?(.+?)(?:\s*@\s*(\S+))?$/i);
    if (!m) { unknown.push(part); continue; }
    const qty = m[1] ? parseInt(m[1], 10) : 1;
    const name = normalize(m[2]);
    let price = m[3] ? parseRupiah(m[3]) : null;
    if (price == null) price = menuNorm[name] ?? null;
    if (price == null || !name) { unknown.push(part); continue; }
    items.push({ name, qty, price, subtotal: qty * price });
  }

  if (!items.length && unknown.length) return { type: 'gagal', unknown };
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { type: 'transaksi', customer, items, total, unknown };
}

const rupiah = n => 'Rp' + Number(n).toLocaleString('id-ID');

module.exports = { parseMessage, parseRupiah, rupiah };

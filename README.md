# oliam.eat - Pencatat Transaksi via WhatsApp

Kirim pesan WhatsApp -> otomatis jadi transaksi di dashboard.

## Jalankan
1. Install Node.js 18+ (nodejs.org)
2. Taruh semua file (server.js, parser.js, index.html, menu.json) dalam satu folder
3. Jalankan: `node server.js`
4. Buka http://localhost:3000

## Format pesan WhatsApp
| Pesan | Hasil |
|---|---|
| `Budi: 2 nasi goreng, 1 es teh` | 2 transaksi item, pelanggan Budi, harga dari menu.json |
| `2 nasi goreng, 1 es teh` | sama, tanpa nama pelanggan |
| `1 paket hemat @25rb` | harga ditulis langsung (rb/k = ribu) |
| `rekap` | ringkasan omzet hari ini |
| `batal` | batalkan transaksi terakhir |

Ubah daftar harga di `menu.json`.

## Sambungkan ke WhatsApp
Server harus bisa diakses internet (deploy ke VPS / Railway / Render, atau tes dengan ngrok).
Alamat webhook: `https://DOMAIN-ANDA/webhook?secret=KATA_RAHASIA`

Pilihan penyedia:
- **Fonnte** (paling mudah, nomor WA biasa/bisnis lewat scan QR): daftar di fonnte.com, isi URL webhook di pengaturan device, set `FONNTE_TOKEN` supaya bot membalas konfirmasi.
- **WhatsApp Cloud API (Meta)**: resmi dan gratis untuk percakapan awal, setup lebih panjang. Set `META_TOKEN` dan `META_PHONE_ID`; saat verifikasi webhook, Verify Token = nilai `WEBHOOK_SECRET`.

## Pengaturan keamanan (environment variable)
```
WEBHOOK_SECRET=kata-rahasia-panjang
OWNER_NUMBERS=6281234567890        # hanya nomor ini yang bisa mencatat
DASHBOARD_PASSWORD=passwordkuat    # login dashboard: user admin
```
Contoh: `WEBHOOK_SECRET=abc OWNER_NUMBERS=62812... DASHBOARD_PASSWORD=xyz node server.js`

## Data
Tersimpan di `data.json` (dibuat otomatis). Backup file ini secara berkala.

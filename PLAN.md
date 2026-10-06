# Quattestor — Rencana Eksekusi

> Ditulis 6 Okt 2026, ~14:12 WIB — hackathon mulai jam 12:00 (hour 0), jadi kita di **hour ~2 dari 36**. Masih di window baseline ETH Sepolia (jam 0–20) sesuai jadwal di dokumen arsitektur (`11 - DOKUMEN FINAL`). Dokumen ini pelengkap, bukan pengganti — rujukan detail teknis tetap dokumen arsitektur di Obsidian.

## 1. Status: sudah dibangun & tervalidasi

| Komponen | Status | Bukti |
|---|---|---|
| `contracts/evm/src/Vault.sol` + `Verifier.sol` | Selesai, compile bersih | `forge build` sukses |
| Foundry test suite | Selesai | `forge test -vv` → **6/6 pass** (happy path + 4 negative case: tanpa atestasi, signer tidak sah, replay nonce, double-attestation) |
| `script/Deploy.s.sol` | Selesai, belum dijalankan ke chain nyata | Compile sukses, butuh `.env` diisi |
| `packages/core` — `actionIntent.ts`, `pq.ts`, `chainAdapter.ts` | Selesai, smoke test pass | Round-trip ML-DSA-87 sign/verify sukses, ukuran pubkey (2.592 byte) & signature (4.627 byte) **cocok persis** dengan angka yang dikutip di dokumen arsitektur §9.2 |
| `packages/adapters/src/evm.ts` | Selesai (compile clean, belum diuji ke RPC nyata) | Tinggal isi `.env` + jalankan smoke test lawan Sepolia |
| `packages/adapters/src/solana.ts`, `osmosis.ts` | Stub — interface terpenuhi, body `throw not implemented` | Siap diisi sesuai jadwal jam 21:30+ dan 29:30+ |
| `services/verifier-service` | Selesai (HTTP API `/attest` + `/health`, WSS listener) | Compile clean, belum dites lawan RPC nyata |
| `services/signer-script` | Selesai (CLI: compute → dual-sign → attest → withdraw) | Compile clean, belum dites lawan RPC nyata |

**Yang belum tersentuh sama sekali:** Solana, Osmosis, deploy ke chain manapun, deck, screen recording.

## 2. Penyesuaian teknis dari dokumen arsitektur — dan alasannya

Tiga keputusan di bawah menyimpang dari detail implementasi di dokumen, tapi **tidak menyimpang dari arsitekturnya** — semua masih dalam batas yang dokumen sendiri anggap setara/sah:

1. **pq-sidecar jadi modul TypeScript (`@noble/post-quantum`), bukan servis Python terpisah dengan `liboqs-python`.**
   Alasan: `liboqs-python` belum terinstall di environment ini dan butuh build native C (resiko waktu tinggi di tengah jam ke-2 dari 36). Dokumen arsitektur sendiri (§9.2) menyebut `@noble/post-quantum` sejajar dengan `liboqs`/`PQClean` sebagai "standar industri" — jadi ini bukan downgrade kualitas, cuma pilihan library yang sudah disebut valid. Konsekuensi baik: pq-sidecar jadi *library* yang di-import langsung oleh `verifier-service` dan `signer-script`, bukan proses HTTP terpisah — menghilangkan satu lapisan IPC yang tidak perlu, dan klaim "reuse 100%, 0 perubahan" jadi lebih literal (import yang sama, bukan cuma endpoint HTTP yang sama).

2. **`verifier-service` pakai `ethers.JsonRpcProvider` + `FetchRequest` (header `api-key` otomatis), bukan helper `fetch` manual seperti pola `_rpc.ts` di starter kit NOWNodes.**
   Alasan: tetap memanggil NOWNodes JSON-RPC langsung dengan header `api-key` yang sama (syarat wajib doc07 §1 tetap terpenuhi) — cuma transport HTTP-nya lewat helper ethers, bukan `fetch` manual. Ini menghemat waktu tulis ABI encode/decode manual, sekaligus dapat signing/nonce-handling ethers yang sudah teruji. Kalau juri tanya "built dari mana", jawabannya tetap akurat: NOWNodes RPC langsung, header `api-key` eksplisit, bukan SDK pihak ketiga yang menyembunyikan request.

3. **Adapter chain (`evm.ts`, `solana.ts`, `osmosis.ts`) ditaruh di package `packages/adapters` tersendiri, bukan di dalam folder `verifier-service/adapters/`.**
   Alasan murni teknis: `signer-script` juga butuh adapter yang sama (untuk baca nonce & broadcast withdraw), jadi adapter harus jadi dependency yang dipakai dua servis, bukan terkubur di satu servis.

## 3. Gap yang perlu diputuskan user (tidak ada di dokumen arsitektur)

Dokumen arsitektur **tidak pernah menentukan** bagaimana identitas klasik (address) diikat ke public key ML-DSA yang dipercaya. Saat ini `verifier-service` menerima `claimedPqPublicKey` langsung dari request (self-asserted oleh `signer-script`) — cukup untuk demo happy-path, tapi secara jujur ini lubang kepercayaan kalau ditanya juri teknis ("siapa saja bisa klaim pubkey ML-DSA apa saja atas nama address manapun").

Pilihan yang perlu diputuskan (bisa dijawab cepat, bukan blocker untuk lanjut coding):
- **Opsi A (tercepat, cukup untuk 36 jam):** registry in-memory sederhana di `verifier-service` — mapping `address → pqPublicKey` diisi lewat endpoint `/register` sekali di awal demo, disebut eksplisit di deck sebagai "MVP: binding manual, roadmap: on-chain registry / ZK-proof of key possession".
- **Opsi B:** simpan pq public key di storage kontrak (`Verifier.sol` tambah `mapping(address => bytes) pqPublicKeys` + fungsi `registerPqKey`) — lebih "on-chain truth", tapi nambah 1 fungsi kontrak + gas, dan kontrak sudah lolos test sekarang (resiko regresi, sama logika dengan §9.3a di dokumen soal "jangan ubah kontrak yang sudah terkunci").

**Rekomendasi: Opsi A.** Lebih cepat, resiko kontrak nol, dan konsisten dengan pengakuan jujur dokumen sendiri soal MVP yang sentralisasi di satu Verifier Service (§9.3). Kalau user setuju, saya implementasikan endpoint `/register` di `verifier-service` begitu diminta.

## 4. Checklist aksi — apa yang perlu ANDA kerjakan sekarang

Urutan mengikuti jadwal §8 dokumen arsitektur. Item bertanda **(saya/Claude bisa bantu)** artinya tinggal minta, saya lanjutkan coding-nya begitu prasyaratnya (biasanya kunci/akun) sudah ada.

### Segera (blocking semua langkah berikutnya)
- [ ] **Isi `.env`** dari `.env.example` — minimal `NOWNODES_API_KEY` (daftar di nownodes.io kalau belum punya).
- [ ] **Buat wallet demo terpisah** (bukan wallet utama) untuk 3 peran: `DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY` (+`TRUSTED_OPERATOR_ADDRESS` turunannya), `USER_PRIVATE_KEY`. Isi dengan ETH Sepolia dari faucet (mis. `sepoliafaucet.com` / Alchemy faucet).
- [ ] **Cek jawaban panitia/NOWNodes** soal testnet tersembunyi Base/Arbitrum (item pending di dokumen §11/§12) — kalau positif, Base/Arbitrum turun ke testnet dan `PLAN.md` + `.env.example` ini direvisi.

### Fase ETH Sepolia (baseline, lantai minimum — harus selalu siap submit)
- [ ] Deploy: `forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY`
- [ ] Catat `Vault`/`Verifier` address ke `.env`
- [ ] **(saya bisa bantu)** Tulis script `eth_getCode` sanity-check (doc07 §4) untuk konfirmasi bytecode benar-benar ada di address sebelum lanjut
- [ ] Jalankan `verifier-service` (`pnpm --filter @quattestor/verifier-service dev`) lalu `signer-script` (`pnpm --filter @quattestor/signer-script start`) — ini uji e2e pertama yang menyentuh RPC nyata
- [ ] Putuskan gap §3 di atas (Opsi A/B) — blocker kecil untuk smoke test e2e penuh karena `claimedPqPublicKey` baru self-asserted

### Fase Base + Arbitrum mainnet (jam 20–21 di jadwal, dana asli — checklist keamanan WAJIB)
- [ ] Wallet terpisah lagi (bukan wallet Sepolia di atas), isi dana **seminim mungkin**
- [ ] Deploy dulu → `eth_getCode` lolos → **baru** isi dana ke Vault (urutan ini wajib, jangan dibalik)
- [ ] Simpan private key wallet mainnet ini terpisah dari `.env` development harian

### Fase Solana devnet (jam 21:30–29)
- [ ] Install Anchor CLI (`anchor` belum ada di environment ini — `cargo install --git https://github.com/coral-xyz/anchor avm` lalu `avm install latest`)
- [ ] GO/NO-GO #1 (jam 21:30): `anchor build` project kosong
- [ ] **(saya bisa bantu)** Tulis program `quattestor_solana` (§5.2) begitu toolchain siap — minta saya mulai begitu checkpoint #1 lolos

### Fase Osmosis testnet (jam 29:30–32:30)
- [ ] `cargo install cargo-generate`, target `wasm32-unknown-unknown`, `cosmwasm-check` — belum ada
- [ ] **Cek dashboard NOWNodes langsung** untuk host RPC/gRPC Osmosis testnet — jangan asumsikan (ini persis kesalahan yang terjadi dengan Base Sepolia, lihat doc §11)
- [ ] Wallet testnet Osmosis + faucet
- [ ] **(saya bisa bantu)** Tulis kontrak CosmWasm (§5.3) begitu 2 item di atas siap

### Lintas-fase / stretch goals (murah, boleh diselipkan kapan saja setelah happy path ETH hijau)
- [ ] **(saya bisa bantu)** Script `debug_traceTransaction` — bukti forensik klaim gas konstan (doc07 §8b, prioritas tertinggi karena effort kecil, dampak besar)
- [ ] **(saya bisa bantu)** Script `eth_getLogs` untuk `AttestationSubmitted` (event sudah ada di `Verifier.sol`, tinggal bikin reader)
- [ ] **(saya bisa bantu)** Script `eth_getTransactionReceipt`/`eth_gasPrice` → isi angka gas **nyata** (ganti tabel ilustratif di dokumen §7.2)
- [ ] First Exposure Finder (doc07 §8a) — prioritas terakhir kalau waktu sempit

### Sebelum submit
- [ ] Rekam screen recording tiap chain yang live (jam 32:30–34:30 di jadwal)
- [ ] Rakit deck .ppt/.keynote (bukan Google Slides/Gamma — syarat lomba), embed recording
- [ ] Submit: GitHub repo + live link + deck, sebelum 23:59 WIB 7 Okt

## 5. Status repo & git

- Repo lokal: `/Users/maziazi/Coding/hackathon/Quattestor/Code`, branch `main`, remote `origin` → `git@github.com:maziazi/Quattestor.git` (private).
- Commit pertama ditulis dengan identitas git yang sudah ada di mesin ini (`maziazi`) — **tidak ada co-author atau footer "Generated with Claude"** di commit manapun, sesuai permintaan.
- Semua `*_PRIVATE_KEY` dan `.env` masuk `.gitignore` — tidak akan pernah masuk commit.

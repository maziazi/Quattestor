# Quattestor — Rencana Eksekusi

> Ditulis 6 Okt 2026, ~14:12 WIB — hackathon mulai jam 12:00 (hour 0), jadi kita di **hour ~2 dari 36**. Masih di window baseline ETH Sepolia (jam 0–20) sesuai jadwal di dokumen arsitektur (`11 - DOKUMEN FINAL`). Dokumen ini pelengkap, bukan pengganti — rujukan detail teknis tetap dokumen arsitektur di Obsidian.

> **Update — temuan kritis soal host NOWNodes Solana/Osmosis**, dicek via probe HTTP langsung (metode sama yang dulu dipakai konfirmasi Base Sepolia tidak ada) + dokumentasi resmi:
> - **Solana: cuma mainnet (`sol.nownodes.io`) dan testnet (`sol-testnet.nownodes.io`) yang ada.** Devnet **tidak ditemukan** di NOWNodes (10+ pola subdomain dicoba, semua 404; dokumentasi resmi NOWNodes juga cuma menyebut mainnet). Target arsitektur yang menyebut "Solana devnet" **kemungkinan harus direvisi ke testnet**.
> - **Osmosis: cuma mainnet (`osmo.nownodes.io`, `osmo-tendermint.nownodes.io`, `osmo-grpc.nownodes.io`) yang terkonfirmasi ada.** Testnet **tidak ditemukan sama sekali** — 15+ pola subdomain dicoba (termasuk pakai chain-id asli `osmo-test-5`), semua 404, dan dokumentasi resmi NOWNodes cuma mendaftarkan mainnet. **Ini kategori temuan yang sama persis dengan kasus Base Sepolia (diklaim ada, ternyata tidak)** — kemungkinan besar Osmosis testnet **tidak didukung NOWNodes sama sekali**.
> - **Keterbatasan pengecekan ini:** saya tidak punya akses login ke dashboard NOWNodes Anda (itu butuh kredensial akun) — jadi ini hasil probe publik + dokumentasi, bukan hasil cek dashboard langsung. Dashboard kadang menampilkan opsi environment tambahan setelah API key dibuat (disebutkan di riset sebelumnya) — **cek dashboard Anda sendiri untuk konfirmasi final**, terutama untuk Osmosis sebelum keputusan pivot diambil.
> - **Implikasi:** kalau Osmosis testnet benar-benar tidak ada, opsi yang sama dengan Base/Arbitrum berlaku — pivot ke mainnet (butuh dana asli + checklist keamanan §4) atau cari testnet Cosmos SDK lain yang didukung. Solana cukup ganti target ke testnet (tidak butuh dana asli, cuma ganti `SOLANA_RPC_URL` ke `sol-testnet.nownodes.io`, 0 baris kode berubah — sama seperti filosofi "ganti endpoint" di seluruh proyek ini).

## 1. Status: sudah dibangun & tervalidasi

| Komponen | Status | Bukti |
|---|---|---|
| `contracts/evm/src/Vault.sol` + `Verifier.sol` | Selesai, compile bersih | `forge build` sukses |
| Foundry test suite | Selesai | `forge test -vv` → **6/6 pass** (happy path + 4 negative case: tanpa atestasi, signer tidak sah, replay nonce, double-attestation) |
| `script/Deploy.s.sol` | Selesai, belum dijalankan ke chain nyata | Compile sukses, butuh `.env` diisi |
| `packages/core` — `actionIntent.ts`, `pq.ts`, `chainAdapter.ts` | Selesai, smoke test pass | Round-trip ML-DSA-87 sign/verify sukses, ukuran pubkey (2.592 byte) & signature (4.627 byte) **cocok persis** dengan angka yang dikutip di dokumen arsitektur §9.2 |
| `packages/adapters/src/evm.ts` | Selesai (compile clean, belum diuji ke RPC nyata) | Tinggal isi `.env` + jalankan smoke test lawan Sepolia |
| `contracts/solana` (program Anchor `quattestor_solana`) | **Selesai & lolos test nyata** | `cargo test` → **4/4 pass** (happy path withdraw, tanpa atestasi, operator tidak sah, replay actionHash basi), via `litesvm` (simulator Rust murni, tanpa validator lokal) |
| `packages/adapters/src/solana.ts` | Selesai (compile clean, belum diuji ke RPC devnet nyata) | Implementasi penuh: ed25519 verify, baca/tulis state via NOWNodes RPC manual (bukan SDK Anchor client) |
| `contracts/osmosis/verifier` + `contracts/osmosis/vault` (CosmWasm) | **Selesai & lolos test nyata** | `cargo test` → **8/8 pass** (Verifier 4/4, Vault 4/4 termasuk happy-path withdraw lintas-kontrak sungguhan via `cw-multi-test`) |
| `packages/adapters/src/osmosis.ts` | Selesai (compile clean, belum diuji ke RPC testnet nyata) | Implementasi penuh via CosmJS — **ada gap desain terbuka**, lihat §3b |
| `services/verifier-service` | Selesai (HTTP API `/register` + `/attest` + `/health`, WSS listener, registry PQ key) | Compile clean, belum dites lawan RPC nyata |
| `services/signer-script` | Selesai (CLI: compute → dual-sign → register → attest → withdraw) | Compile clean, belum dites lawan RPC nyata |
| `services/ops-tools` | Selesai — 4 script: `checkDeployment`, `gasProof`, `attestationLogs`, `realGasNumbers` | Compile clean, butuh tx hash nyata untuk dijalankan |

**Yang belum tersentuh sama sekali:** deploy ke chain manapun (ETH/Base/Arbitrum/Solana/Osmosis — semua masih lokal), deck, screen recording.

**Update besar:** Solana dan Osmosis **tidak lagi stub** — kontrak/program keduanya ditulis penuh dan lolos test nyata (12/12 gabungan: 4 Solana + 8 Osmosis), dikerjakan sambil menunggu `.env`. Toolchain Anchor (`anchor-cli 1.2.0`), Solana CLI (`solana-cli 4.1.2`), dan CosmWasm (`cargo-generate`, `cosmwasm-check`, target `wasm32-unknown-unknown`) semua terinstall & terverifikasi. Detail masalah toolchain yang ditemukan+diperbaiki ada di §1b.

Catatan: installer Solana menambahkan `export PATH=".../solana/install/active_release/bin:$PATH"` ke `~/.profile`, `~/.zprofile`, `~/.bash_profile` secara otomatis (perilaku standar installer-nya) — buka terminal baru sebelum pakai `solana`/`anchor` langsung tanpa export manual.

## 1b. Masalah toolchain yang ditemukan & diperbaiki (log teknis)

Dicatat supaya kalau muncul lagi di environment lain, tidak perlu debug ulang dari nol:

1. **`anchor init` men-generate template baru (anchor-lang 1.2.0)** yang beda total dari yang diasumsikan dokumen arsitektur — pakai struktur modular `instructions/` per-instruksi dan test via `litesvm` (simulator Rust murni, native `cargo test`), bukan `anchor test` + `solana-test-validator` + Mocha/TS seperti anchor versi lama. **Keputusan: ikuti pola baru ini** — lebih cepat (tidak perlu spin up validator), tetap sepenuhnya memvalidasi logic on-chain yang sama.
2. **`anchor_lang::solana_program::keccak` tidak ada** di anchor-lang 1.2.0 (struktur crate Solana versi baru dipecah jadi puluhan crate `solana-*` granular). Fix: tambah dependency `solana-keccak-hasher` langsung, pakai `solana_keccak_hasher::hash()`.
3. **Program ter-compile ke format SBPFv3** (target `sbpfv3-solana-solana` — Solana CLI yang baru terinstall, 4.1.2, sangat mutakhir), tapi `litesvm 0.10.0` (versi default template) belum dukung SBPFv3 → gagal load `.so` dengan `InvalidAccountData`. Fix: upgrade `litesvm` ke `0.17.0`.
4. **`litesvm 0.17.0` butuh rustc ≥1.97.1**, environment ini masih pin ke rustc 1.89.0 (lewat `rust-toolchain.toml` bawaan template). Fix: `rustup update stable` (dapat 1.99.0) + ubah `rust-toolchain.toml` dari `1.89.0` ke `1.99.0`.
5. **Konflik 2 versi `solana-transaction`/`solana-message`** (3.x vs 4.x) setelah upgrade litesvm — dependency langsung di `Cargo.toml` test masih pin versi lama, sementara `litesvm` baru butuh versi 4.x, menyebabkan error "no associated function `try_new`" (tipe yang sama secara nama, beda secara versi, tidak bisa dicocokkan compiler). Fix: samakan versi `solana-message`/`solana-transaction` di `[dev-dependencies]` ke `4.2.4`/`4.1.5` (persis yang dipakai `litesvm 0.17.0` secara internal).

## 2. Penyesuaian teknis dari dokumen arsitektur — dan alasannya

Tiga keputusan di bawah menyimpang dari detail implementasi di dokumen, tapi **tidak menyimpang dari arsitekturnya** — semua masih dalam batas yang dokumen sendiri anggap setara/sah:

1. **pq-sidecar jadi modul TypeScript (`@noble/post-quantum`), bukan servis Python terpisah dengan `liboqs-python`.**
   Alasan: `liboqs-python` belum terinstall di environment ini dan butuh build native C (resiko waktu tinggi di tengah jam ke-2 dari 36). Dokumen arsitektur sendiri (§9.2) menyebut `@noble/post-quantum` sejajar dengan `liboqs`/`PQClean` sebagai "standar industri" — jadi ini bukan downgrade kualitas, cuma pilihan library yang sudah disebut valid. Konsekuensi baik: pq-sidecar jadi *library* yang di-import langsung oleh `verifier-service` dan `signer-script`, bukan proses HTTP terpisah — menghilangkan satu lapisan IPC yang tidak perlu, dan klaim "reuse 100%, 0 perubahan" jadi lebih literal (import yang sama, bukan cuma endpoint HTTP yang sama).

2. **`verifier-service` pakai `ethers.JsonRpcProvider` + `FetchRequest` (header `api-key` otomatis), bukan helper `fetch` manual seperti pola `_rpc.ts` di starter kit NOWNodes.**
   Alasan: tetap memanggil NOWNodes JSON-RPC langsung dengan header `api-key` yang sama (syarat wajib doc07 §1 tetap terpenuhi) — cuma transport HTTP-nya lewat helper ethers, bukan `fetch` manual. Ini menghemat waktu tulis ABI encode/decode manual, sekaligus dapat signing/nonce-handling ethers yang sudah teruji. Kalau juri tanya "built dari mana", jawabannya tetap akurat: NOWNodes RPC langsung, header `api-key` eksplisit, bukan SDK pihak ketiga yang menyembunyikan request.

3. **Adapter chain (`evm.ts`, `solana.ts`, `osmosis.ts`) ditaruh di package `packages/adapters` tersendiri, bukan di dalam folder `verifier-service/adapters/`.**
   Alasan murni teknis: `signer-script` juga butuh adapter yang sama (untuk baca nonce & broadcast withdraw), jadi adapter harus jadi dependency yang dipakai dua servis, bukan terkubur di satu servis.

## 3. Keputusan yang sudah diterapkan (default), masih bisa Anda ubah

Dokumen arsitektur **tidak pernah menentukan** bagaimana identitas klasik (address) diikat ke public key ML-DSA yang dipercaya. Ada 2 opsi (lihat analisis awal di commit sebelumnya): Opsi A (registry in-memory di `verifier-service`, diisi lewat `/register`) vs Opsi B (simpan di storage kontrak, resiko regresi ke kontrak yang sudah lolos test).

**Status: Opsi A sudah diimplementasikan** (`services/verifier-service/src/registry.ts` + endpoint `/register`, `signer-script` otomatis register sebelum attest). Ini jalan terus tanpa menunggu konfirmasi Anda karena reversibel dan sejalan dengan rekomendasi — tapi **ini masih keputusan terbuka untuk ditinjau ulang**, bukan final:
- Kalau Anda setuju Opsi A → tidak perlu aksi apa pun, sudah jalan.
- Kalau Anda mau Opsi B (lebih "on-chain truth" untuk pitch ke juri) → kabari, saya ubah `Verifier.sol` + test ulang.

Catatan jujur yang perlu disebut di deck kalau dipilih Opsi A: registry ini **in-memory, hilang tiap restart proses** — cukup untuk demo karena `signer-script` register ulang tiap run, tapi bukan desain produksi. Roadmap: on-chain registry atau ZK-proof of key possession.

### 3b. Gap baru: konvensi identitas Osmosis beda dari EVM/Solana — belum direkonsiliasi

Ditemukan saat menulis `packages/adapters/src/osmosis.ts`. EVM (`ecrecover`) dan Solana (verify ed25519 langsung) sama-sama mengidentifikasi user lewat key yang **juga** jadi identitas native chain itu. Cosmos SDK beda: address bech32 adalah `RIPEMD160(SHA256(pubkey))` — **tidak bisa dibalik** jadi pubkey. Akibatnya `verifyClassicalSignature` di adapter Osmosis butuh `claimedIdentity` berupa **pubkey base64**, bukan address — satu-satunya adapter yang beda konvensi dari field yang sama di interface `ChainAdapter`.

Belum ada keputusan — 2 opsi kalau mau dirapikan (tidak mendesak, Osmosis sendiri belum disentuh NOWNodes-nya):
- **Biarkan beda** (status sekarang): `signer-script` cabang Osmosis kirim pubkey, bukan address, sebagai `claimedIdentity`. Disebut eksplisit di deck sebagai "detail implementasi per-VM", bukan bug.
- **Normalisasi**: ubah signature `ChainAdapter.verifyClassicalSignature` supaya terima `claimedIdentity` + `claimedPublicKey?` opsional, dipakai adapter yang butuh (Osmosis), diabaikan yang tidak (EVM/Solana). Nambah 1 field interface, tidak mengubah logic adapter lain.

Tidak blocking — flagged supaya tidak jadi kejutan saat demo lintas-chain nanti.

## 4. Checklist aksi — apa yang perlu ANDA kerjakan sekarang

Urutan mengikuti jadwal §8 dokumen arsitektur. Item bertanda **(saya/Claude bisa bantu)** artinya tinggal minta, saya lanjutkan coding-nya begitu prasyaratnya (biasanya kunci/akun) sudah ada.

### Segera (blocking semua langkah berikutnya)
- [ ] **Isi `.env`** dari `.env.example` — minimal `NOWNODES_API_KEY` (daftar di nownodes.io kalau belum punya).
- [ ] **Buat wallet demo terpisah** (bukan wallet utama) untuk 3 peran: `DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY` (+`TRUSTED_OPERATOR_ADDRESS` turunannya), `USER_PRIVATE_KEY`. Isi dengan ETH Sepolia dari faucet (mis. `sepoliafaucet.com` / Alchemy faucet).
- [ ] **Cek jawaban panitia/NOWNodes** soal testnet tersembunyi Base/Arbitrum (item pending di dokumen §11/§12) — kalau positif, Base/Arbitrum turun ke testnet dan `PLAN.md` + `.env.example` ini direvisi.

### Fase ETH Sepolia (baseline, lantai minimum — harus selalu siap submit)
- [ ] Deploy: `forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY`
- [ ] Catat `Vault`/`Verifier` address ke `.env`
- [ ] Jalankan `pnpm --filter @quattestor/ops-tools check-deployment` — konfirmasi bytecode ada sebelum lanjut
- [ ] Jalankan `verifier-service` (`pnpm --filter @quattestor/verifier-service dev`) lalu `signer-script` (`pnpm --filter @quattestor/signer-script start`) — ini uji e2e pertama yang menyentuh RPC nyata

### Fase Base + Arbitrum mainnet (jam 20–21 di jadwal, dana asli — checklist keamanan WAJIB)
- [ ] Wallet terpisah lagi (bukan wallet Sepolia di atas), isi dana **seminim mungkin**
- [ ] Deploy dulu → `eth_getCode` lolos → **baru** isi dana ke Vault (urutan ini wajib, jangan dibalik)
- [ ] Simpan private key wallet mainnet ini terpisah dari `.env` development harian

### Fase Solana devnet (jam 21:30–29)
- [x] Anchor CLI + Solana CLI terinstall & terverifikasi
- [x] GO/NO-GO #1: `anchor build` sukses, menghasilkan `.so` valid
- [x] Program `quattestor_solana` ditulis lengkap, **GO/NO-GO #2 lolos nyata**: `cargo test` 4/4 pass
- [ ] Wallet devnet + faucet (`solana airdrop` atau faucet.solana.com) — belum ada
- [ ] Host RPC NOWNodes untuk Solana devnet — belum dicek ke dashboard, perlu sebelum adapter diuji ke RPC nyata
- [ ] GO/NO-GO #3 (e2e devnet nyata, lewat `signer-script` + adapter) — menunggu 2 item di atas

### Fase Osmosis testnet (jam 29:30–32:30)
- [x] `cargo-generate`, `cosmwasm-check`, target `wasm32-unknown-unknown` terinstall & terverifikasi
- [x] Kontrak `quattestor-verifier` + `quattestor-vault` ditulis lengkap, **GO/NO-GO #2 lolos nyata**: `cargo test` 8/8 pass (termasuk happy-path withdraw lintas-kontrak via `cw-multi-test`)
- [ ] **Cek dashboard NOWNodes langsung** untuk host RPC/gRPC Osmosis testnet — masih belum dicek, jangan asumsikan (ini persis kesalahan yang terjadi dengan Base Sepolia, lihat doc §11)
- [ ] Wallet testnet Osmosis + faucet
- [ ] Putuskan gap identitas §3b (boleh dibiarkan untuk demo, tidak blocking)
- [ ] GO/NO-GO #3 (e2e testnet nyata) — menunggu 2 item di atas

### Lintas-fase / stretch goals (murah, boleh diselipkan kapan saja setelah happy path ETH hijau)
- [x] Script `debug_traceTransaction` — `services/ops-tools/src/gasProof.ts`, jalankan: `TX_HASH=0x.. pnpm --filter @quattestor/ops-tools gas-proof`
- [x] Script `eth_getLogs` untuk `AttestationSubmitted` — `services/ops-tools/src/attestationLogs.ts`
- [x] Script `eth_getTransactionReceipt`/`eth_gasPrice` — `services/ops-tools/src/realGasNumbers.ts`, butuh `ATTEST_TX_HASH` + `WITHDRAW_TX_HASH` dari run happy-path pertama
- [ ] First Exposure Finder (doc07 §8a) — belum dibangun, prioritas terakhir kalau waktu sempit

### Sebelum submit
- [ ] Rekam screen recording tiap chain yang live (jam 32:30–34:30 di jadwal)
- [ ] Rakit deck .ppt/.keynote (bukan Google Slides/Gamma — syarat lomba), embed recording
- [ ] Submit: GitHub repo + live link + deck, sebelum 23:59 WIB 7 Okt

## 5. Status kode per chain — jujur, bukan "tinggal isi env" untuk semuanya

| Chain | Kode kontrak/program | Kode adapter | Status nyata |
|---|---|---|---|
| **Ethereum Sepolia** | `Vault.sol`/`Verifier.sol` — selesai, 6/6 test pass | `packages/adapters/src/evm.ts` — selesai | **Tinggal isi env + deploy.** Ini satu-satunya chain yang betul-betul "tinggal env". |
| **Base** | **Bytecode identik** dengan Sepolia (klaim inti arsitektur: 0 baris berubah) | **Sama persis** `evm.ts` — cuma config (`rpcUrl`/`vaultAddress`/`verifierAddress`) beda | Kode sudah selesai, tapi **bukan cuma isi env** — tetap harus jalankan ulang `forge script script/Deploy.s.sol` dengan `--rpc-url $BASE_RPC_URL` untuk dapat address Vault/Verifier yang baru (beda dari Sepolia, meski bytecode-nya sama). Plus checklist keamanan mainnet (dana asli) di §4. |
| **Arbitrum** | Sama seperti Base | Sama seperti Base | Sama seperti Base |
| **Solana** | **Selesai, lolos test nyata** — program Anchor `quattestor_solana` (`contracts/solana`), `cargo test` 4/4 pass | **Selesai** — `packages/adapters/src/solana.ts`, ed25519 verify + baca/tulis state manual via NOWNodes RPC | Kode lengkap di kedua sisi (on-chain + off-chain). **Belum diuji ke devnet nyata** — perlu wallet devnet + faucet + host RPC NOWNodes Solana (belum dicek ke dashboard, tapi kemungkinan besar standar `sol.nownodes.io`-style, resiko lebih rendah dari Osmosis). |
| **Osmosis** | **Selesai, lolos test nyata** — kontrak CosmWasm `quattestor-verifier`+`quattestor-vault` (`contracts/osmosis`), `cargo test` 8/8 pass | **Selesai** — `packages/adapters/src/osmosis.ts` via CosmJS, **dengan 1 gap desain terbuka** (§3b: konvensi pubkey vs address) | Kode lengkap di kedua sisi. **Belum diuji ke testnet nyata** — host RPC/gRPC NOWNodes untuk Osmosis testnet **masih belum pernah dicek ke dashboard** (resiko tertinggi dari 5 chain, sama kategori dengan kasus Base Sepolia yang ternyata tidak ada). |

**Ringkas, update dari sebelumnya:** Kelimanya sekarang punya kode lengkap di sisi kontrak/program DAN adapter off-chain. EVM (ETH/Base/Arbitrum) sudah diverifikasi penuh termasuk formula gas; Solana & Osmosis sudah lolos test lokal (litesvm / cw-multi-test) tapi **belum ada satu pun yang diuji lawan RPC NOWNodes sungguhan** — itu jadi langkah nyata berikutnya begitu `.env` terisi, bukan lagi "coding dari nol".

## 6. Panduan isi `.env` — per variabel, cara mencarinya

Urutan prioritas: 5 variabel pertama (sampai `USER_PRIVATE_KEY`) adalah **minimum wajib** untuk smoke test ETH Sepolia pertama. Sisanya menyusul sesuai fase.

### Wajib sekarang

| Variabel | Apa ini | Cara mendapatkannya |
|---|---|---|
| `NOWNODES_API_KEY` | Token auth NOWNodes, dikirim lewat header `api-key` di tiap request RPC | **Cek dulu** email/Discord panitia TOKEN2049/NOWNodes — partner track kadang kasih key khusus peserta. Kalau tidak ada: daftar gratis di `account.nownodes.io/auth/signup` → pilih plan **Start** (gratis, 100.000 request) → di dashboard klik **"Add a New Key"** → copy key yang muncul. |
| `ETH_RPC_URL` | Endpoint JSON-RPC Ethereum Sepolia via NOWNodes | Sudah terisi di `.env.example`: `https://eth-sepolia.nownodes.io` — **tidak perlu dicari**, sudah terverifikasi lewat HTTP probe (lihat catatan riset). Tinggal copy. |
| `CHAIN_ID` | ID numerik jaringan (dipakai di formula `actionHash`, harus sama persis dengan `block.chainid` on-chain) | Angka publik tetap, bukan dicari di dashboard: **Sepolia = `11155111`**, sudah terisi di `.env.example`. |
| `DEPLOYER_PRIVATE_KEY` | Private key wallet yang mendeploy kontrak (bayar gas deploy) | **Generate baru**, jangan pakai wallet utama. Jalankan: `cast wallet new` (Foundry, sudah terinstall) — ini mencetak `Address` + `Private key` baru secara acak. Simpan private key-nya di sini. |
| `TRUSTED_OPERATOR_ADDRESS` + `OPERATOR_PRIVATE_KEY` | Wallet "Operator" — yang menandatangani & broadcast atestasi | `cast wallet new` sekali lagi (wallet berbeda dari deployer). Private key → `OPERATOR_PRIVATE_KEY`, address yang tercetak bersamanya → `TRUSTED_OPERATOR_ADDRESS`. **Urutan penting:** ini harus diisi SEBELUM deploy, karena `Deploy.s.sol` membaca `TRUSTED_OPERATOR_ADDRESS` sebagai parameter constructor `Verifier.sol`. |
| `USER_PRIVATE_KEY` | Wallet "User" — yang melakukan `withdraw()` di demo | `cast wallet new` sekali lagi (wallet ketiga). |
| *(tanpa nama env, aksi manual)* | Isi ETH Sepolia ke 3 wallet di atas (gas) | Faucet: `https://sepoliafaucet.com`, faucet Alchemy (`sepolia-faucet.pk910.de` atau dashboard Alchemy kalau punya akun), atau faucet Google Cloud Web3. Minta ke alamat `DEPLOYER_PRIVATE_KEY` dan `OPERATOR_PRIVATE_KEY` dulu (butuh gas untuk deploy + submitAttestation); `USER_PRIVATE_KEY` cukup sedikit untuk gas `withdraw()`. |

### Diisi setelah deploy (bukan dicari, tapi hasil command)

| Variabel | Cara mengisi |
|---|---|
| `VAULT_ADDRESS`, `VERIFIER_ADDRESS` | Jalankan `forge script script/Deploy.s.sol --rpc-url $ETH_RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY` — address Vault & Verifier tercetak di output terminal, copy ke sini. Setelah Vault punya address, kirim sedikit ETH ke address itu (`cast send $VAULT_ADDRESS --value 0.01ether --rpc-url $ETH_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY`) supaya ada saldo untuk di-`withdraw()` saat demo. |

### Opsional / fase berikutnya

| Variabel | Catatan |
|---|---|
| `ETH_WSS_URL` | **Format belum terverifikasi** (halaman dokumentasi WSS NOWNodes JS-rendered, tidak bisa di-scrape). Cek di dashboard NOWNodes setelah API key dibuat, atau tanya mentor NOWNodes di venue/Discord. Tidak wajib untuk smoke test pertama — endpoint `/attest` jalan lewat HTTP biasa tanpa WSS. |
| `BASE_RPC_URL`, `ARBITRUM_RPC_URL` | Sudah terisi di `.env.example`, tidak perlu dicari. Dipakai nanti saat fase Base/Arbitrum (ganti `ETH_RPC_URL`/`CHAIN_ID`/`VAULT_ADDRESS`/`VERIFIER_ADDRESS` ke nilai Base/Arbitrum saat deploy ke sana — lihat §6). |
| `VERIFIER_SERVICE_URL`, `PORT` | Default `http://localhost:8787` sudah benar untuk jalan di satu laptop, tidak perlu diubah. |
| `AMOUNT_WEI` | Jumlah demo withdraw dalam wei, bebas Anda pilih (contoh default: `1000000000000000` = 0.001 ETH) — harus ≤ saldo yang sudah dikirim ke Vault. |

**Catatan arsitektur penting:** satu `.env` ini mewakili **satu chain EVM pada satu waktu**. Kalau nanti mau jalankan servis lawan Base atau Arbitrum, cara paling sederhana adalah salin `.env` jadi `.env.base`/`.env.arbitrum` dengan `ETH_RPC_URL`→isi `BASE_RPC_URL`, `CHAIN_ID`→`8453`, dan `VAULT_ADDRESS`/`VERIFIER_ADDRESS` hasil deploy di Base — bukan bug, ini konsekuensi langsung dari klaim "0 baris kode berubah, cuma config" yang memang didesain begitu.

## 7. Status repo & git

- Repo lokal: `/Users/maziazi/Coding/hackathon/Quattestor/Code`, branch `main`, remote `origin` → `git@github.com:maziazi/Quattestor.git` (private).
- Commit pertama ditulis dengan identitas git yang sudah ada di mesin ini (`maziazi`) — **tidak ada co-author atau footer "Generated with Claude"** di commit manapun, sesuai permintaan.
- Semua `*_PRIVATE_KEY` dan `.env` masuk `.gitignore` — tidak akan pernah masuk commit.

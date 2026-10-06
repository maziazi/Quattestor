# Quattestor — Rencana Eksekusi

> Ditulis 6 Okt 2026, ~14:12 WIB — hackathon mulai jam 12:00 (hour 0), jadi kita di **hour ~2 dari 36**. Masih di window baseline ETH Sepolia (jam 0–20) sesuai jadwal di dokumen arsitektur (`11 - DOKUMEN FINAL`). Dokumen ini pelengkap, bukan pengganti — rujukan detail teknis tetap dokumen arsitektur di Obsidian.

> **Update — temuan kritis soal host NOWNodes Solana/Osmosis**, dicek via probe HTTP langsung (metode sama yang dulu dipakai konfirmasi Base Sepolia tidak ada) + dokumentasi resmi:
> - **Solana: cuma mainnet (`sol.nownodes.io`) dan testnet (`sol-testnet.nownodes.io`) yang ada.** Devnet **tidak ditemukan** di NOWNodes (10+ pola subdomain dicoba, semua 404; dokumentasi resmi NOWNodes juga cuma menyebut mainnet). Target arsitektur yang menyebut "Solana devnet" **kemungkinan harus direvisi ke testnet**.
> - **Osmosis: cuma mainnet (`osmo.nownodes.io`, `osmo-tendermint.nownodes.io`, `osmo-grpc.nownodes.io`) yang terkonfirmasi ada.** Testnet **tidak ditemukan sama sekali** — 15+ pola subdomain dicoba (termasuk pakai chain-id asli `osmo-test-5`), semua 404, dan dokumentasi resmi NOWNodes cuma mendaftarkan mainnet. **Ini kategori temuan yang sama persis dengan kasus Base Sepolia (diklaim ada, ternyata tidak)** — kemungkinan besar Osmosis testnet **tidak didukung NOWNodes sama sekali**.
> - **Keterbatasan pengecekan ini:** saya tidak punya akses login ke dashboard NOWNodes Anda (itu butuh kredensial akun) — jadi ini hasil probe publik + dokumentasi, bukan hasil cek dashboard langsung. Dashboard kadang menampilkan opsi environment tambahan setelah API key dibuat (disebutkan di riset sebelumnya) — **cek dashboard Anda sendiri untuk konfirmasi final**, terutama untuk Osmosis sebelum keputusan pivot diambil.
> - **Implikasi:** kalau Osmosis testnet benar-benar tidak ada, opsi yang sama dengan Base/Arbitrum berlaku — pivot ke mainnet (butuh dana asli + checklist keamanan §4) atau cari testnet Cosmos SDK lain yang didukung. Solana cukup ganti target ke testnet (tidak butuh dana asli, cuma ganti `SOLANA_RPC_URL` ke `sol-testnet.nownodes.io`, 0 baris kode berubah — sama seperti filosofi "ganti endpoint" di seluruh proyek ini).

> ## PIVOT SCOPE FINAL (6 Okt 2026, ~16:00 WIB) — jawaban langsung dari NOWNodes, bukan tebakan probe
>
> User mendapat balasan langsung dari NOWNodes support (bukan dari saya) yang menggantikan sebagian temuan probe publik di atas, plus keputusan scope baru:
>
> | Chain | Sebelumnya | SEKARANG | Sumber |
> |---|---|---|---|
> | **Base** | Diasumsikan mainnet (dana asli) | **Base Sepolia TESTNET** — dikonfirmasi NOWNodes aktif khusus untuk key hackathon ini (tidak terlihat dari probe publik biasa) | Jawaban langsung NOWNodes |
> | **Arbitrum** | Mainnet (dana asli) | **DIBATALKAN** — keputusan user, cukup 1 L2 (Base) | Keputusan user |
> | **Solana** | Target devnet, lalu testnet (dari probe) | **Mainnet, dikonfirmasi resmi** — NOWNodes eksplisit: "we can't enable Solana devnet for hackathon keys". Testnet ada secara DNS (sol-testnet.nownodes.io, 422) tapi **tidak bisa diakses key hackathon** — pelajaran: host ada bukan berarti key bisa pakai | Jawaban langsung NOWNodes |
> | **Osmosis** | Testnet tidak ditemukan (probe) | **DIHAPUS** — diganti Cardano | Keputusan user |
> | **Cardano** | Tidak ada di scope | **DITAMBAHKAN, mainnet** — endpoint Blockfrost-compatible (ada-blockfrost.nownodes.io) dikonfirmasi NOWNodes, address/UTXO/tx lookup jalan | Jawaban langsung NOWNodes + keputusan user |
>
> **Scope final: 4 chain — ETH Sepolia, Base Sepolia (L2), Solana mainnet, Cardano mainnet.** Kode Osmosis (contracts/osmosis/, packages/adapters/src/osmosis.ts) **sudah dihapus dari repo** (riwayatnya tetap ada di git log kalau perlu dirujuk). §3b, §4, §5 di bawah sudah diperbarui mengikuti scope ini.
>
> **Konsekuensi bagus:** Base tidak lagi butuh dana asli (balik ke testnet) — risiko turun signifikan dibanding rencana sebelumnya.

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
| `contracts/cardano` (Aiken `vault.ak` + `verifier.ak`) | **Selesai & lolos test nyata** [GANTI OSMOSIS] | `aiken check` → **7/7 pass** (vault 4/4, verifier 3/3); `aiken build` sukses hasilkan `plutus.json` |
| `packages/adapters/src/cardano.ts` | Selesai (compile clean, belum diuji ke RPC mainnet nyata) | Implementasi penuh via Lucid Evolution, termasuk `bootstrapVault()` — **ada 2 gap desain terbuka**, lihat §3c |
| `services/verifier-service` | Selesai (HTTP API `/register` + `/attest` + `/health`, WSS listener, registry PQ key) | Compile clean, belum dites lawan RPC nyata |
| `services/signer-script` | Selesai (CLI: compute → dual-sign → register → attest → withdraw) | Compile clean, belum dites lawan RPC nyata |
| `services/ops-tools` | Selesai — 5 script: `checkDeployment`, `gasProof`, `attestationLogs`, `realGasNumbers`, `cardanoBootstrapVault` | Compile clean, butuh tx hash/wallet nyata untuk dijalankan |

**Yang belum tersentuh sama sekali:** deploy ke chain manapun (semua masih lokal), deck, screen recording.

**Update besar (lihat notice PIVOT di atas untuk detail):** Osmosis dihapus dari repo, diganti Cardano. Solana dan Cardano **bukan stub** — kontrak/program keduanya ditulis penuh dan lolos test nyata (11/11 gabungan: 4 Solana + 7 Cardano). Toolchain Anchor (`anchor-cli 1.2.0`), Solana CLI (`solana-cli 4.1.2`), dan Aiken (`1.1.24`) semua terinstall & terverifikasi. Detail masalah toolchain yang ditemukan+diperbaiki ada di §1b.

Catatan: installer Solana menambahkan `export PATH=".../solana/install/active_release/bin:$PATH"` ke `~/.profile`, `~/.zprofile`, `~/.bash_profile` secara otomatis (perilaku standar installer-nya) — buka terminal baru sebelum pakai `solana`/`anchor` langsung tanpa export manual.

## 1b. Masalah toolchain yang ditemukan & diperbaiki (log teknis)

Dicatat supaya kalau muncul lagi di environment lain, tidak perlu debug ulang dari nol:

1. **`anchor init` men-generate template baru (anchor-lang 1.2.0)** yang beda total dari yang diasumsikan dokumen arsitektur — pakai struktur modular `instructions/` per-instruksi dan test via `litesvm` (simulator Rust murni, native `cargo test`), bukan `anchor test` + `solana-test-validator` + Mocha/TS seperti anchor versi lama. **Keputusan: ikuti pola baru ini** — lebih cepat (tidak perlu spin up validator), tetap sepenuhnya memvalidasi logic on-chain yang sama.
2. **`anchor_lang::solana_program::keccak` tidak ada** di anchor-lang 1.2.0 (struktur crate Solana versi baru dipecah jadi puluhan crate `solana-*` granular). Fix: tambah dependency `solana-keccak-hasher` langsung, pakai `solana_keccak_hasher::hash()`.
3. **Program ter-compile ke format SBPFv3** (target `sbpfv3-solana-solana` — Solana CLI yang baru terinstall, 4.1.2, sangat mutakhir), tapi `litesvm 0.10.0` (versi default template) belum dukung SBPFv3 → gagal load `.so` dengan `InvalidAccountData`. Fix: upgrade `litesvm` ke `0.17.0`.
4. **`litesvm 0.17.0` butuh rustc ≥1.97.1**, environment ini masih pin ke rustc 1.89.0 (lewat `rust-toolchain.toml` bawaan template). Fix: `rustup update stable` (dapat 1.99.0) + ubah `rust-toolchain.toml` dari `1.89.0` ke `1.99.0`.
5. **Konflik 2 versi `solana-transaction`/`solana-message`** (3.x vs 4.x) setelah upgrade litesvm — dependency langsung di `Cargo.toml` test masih pin versi lama, sementara `litesvm` baru butuh versi 4.x, menyebabkan error "no associated function `try_new`" (tipe yang sama secara nama, beda secara versi, tidak bisa dicocokkan compiler). Fix: samakan versi `solana-message`/`solana-transaction` di `[dev-dependencies]` ke `4.2.4`/`4.1.5` (persis yang dipakai `litesvm 0.17.0` secara internal).
6. **`forge`/`cast` tidak bisa kirim custom header** — jadi `--rpc-url https://eth-sepolia.nownodes.io` (header `api-key`, yang dipakai kode TS) gagal dengan `HTTP error 422: Missing API_key`. Fix: NOWNodes juga dukung auth lewat **path URL** (`https://eth-sepolia.nownodes.io/<api_key>`, terkonfirmasi lewat curl) — dipakai khusus untuk `forge`/`cast`, bukan buat ganti `ETH_RPC_URL` di `.env` (yang tetap header-based untuk kode TS). **Penting:** kombinasi path+header SEKALIGUS malah `404` (saling konflik) — jangan dipakai bersamaan, pilih satu sesuai tool-nya.
7. **Semua servis Node (`ops-tools`, `verifier-service`, `signer-script`) gagal dijalankan sama sekali** saat pertama kali dicoba sungguhan (`node --experimental-strip-types src/X.ts`) — baru ketahuan di titik ini karena sebelumnya cuma `tsc --noEmit` yang dicek, belum pernah benar-benar dieksekusi. 2 akar masalah berbeda, 2 fix:
   - Import relatif `.js` di source TS (`./evm.js`, `./env.js`, dst — konvensi NodeNext) tidak bisa di-resolve oleh Node dalam mode strip-types tanpa build nyata lebih dulu (`ERR_MODULE_NOT_FOUND`). Fix: `packages/core`/`packages/adapters` ganti `main`/`types` di `package.json` dari `src/index.ts` ke `dist/index.js`/`dist/index.d.ts`; semua script servis (`check-deployment`, `dev`, `start`, dst.) diubah jadi `tsc -p tsconfig.json && node dist/X.js` (build dulu, baru jalankan hasil build) — bukan lagi jalankan `.ts` mentah.
   - Tidak ada loader `.env` sama sekali di servis-servis ini (`process.env.X` polos, tanpa `dotenv` atau sejenisnya) → `missing env var`. Fix: pakai flag native Node 20+ `--env-file=../../.env` di setiap script (tidak perlu tambah dependency `dotenv`).
8. **`debug_traceTransaction` gagal `405 Method Not Allowed`** lewat NOWNodes (key/plan hackathon ini) — method lain (`eth_getTransactionReceipt`, `eth_gasPrice`) jalan normal, jadi ini spesifik ke method debug/trace, bukan masalah auth umum. **Dampak:** script `gasProof.ts` (doc07 §8b, prioritas forensik tertinggi) **tidak bisa dipakai** dengan key ini — perlu disebut di deck sebagai "Debug & Trace API tersedia di dokumentasi NOWNodes, tapi tidak aktif di plan/key hackathon ini", bukan diam-diam dihilangkan dari narasi.

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

### 3b. [SUPERSEDED] Gap identitas Osmosis — chain ini sudah dihapus dari scope

~~Ditemukan saat menulis `packages/adapters/src/osmosis.ts`...~~ — tidak relevan lagi, Osmosis dihapus dari scope (lihat notice PIVOT di atas). Dibiarkan di sini sebagai jejak keputusan, bukan dihapus — kalau Osmosis pernah masuk scope lagi di masa depan, masalahnya (address Cosmos SDK tidak bisa dibalik jadi pubkey) masih relevan untuk dicek ulang.

### 3c. Gap serupa di Cardano — pola yang sama, chain yang berbeda

`packages/adapters/src/cardano.ts` punya **2 penyimpangan dari konvensi EVM/Solana**, didokumentasikan langsung di kode (bukan disembunyikan):

1. **`claimedIdentity` harus pubkey hex, bukan address** — sama persis alasan yang dulu berlaku untuk Osmosis (§3b): address Cardano bukan hash yang bisa dibalik jadi pubkey, jadi verifikasi signature classical butuh pubkey mentah.
2. **`state.submitAttestation`'s `operatorKey` adalah object `{ privateKey, recipientAddress }`, bukan key polos** — ini murni konsekuensi model eUTXO: NFT atestasi yang di-mint harus langsung dikirim ke address User (bukan disimpan di address Operator), supaya User bisa withdraw belakangan **tanpa** butuh Operator tanda tangan ulang. Interface `ChainAdapter` yang sudah ada mengetik parameter ini sebagai `unknown` secara sengaja — jadi ini bukan pelanggaran kontrak TypeScript, cuma konvensi per-chain yang berbeda.

Tidak blocking untuk lanjut kerja — flagged supaya jelas saat nanti menjawab pertanyaan juri soal "kenapa Cardano adapter-nya beda bentuk".

**[SELESAI] Gap bootstrap vault UTXO** — `bootstrapVault()` di `packages/adapters/src/cardano.ts` + CLI `services/ops-tools/src/cardanoBootstrapVault.ts` (`pnpm --filter @quattestor/ops-tools cardano-bootstrap-vault`). Mengirim ADA ke vault address dengan `VaultDatum{owner, counter: 0}` sebagai inline datum. Compile bersih. **Update:** koneksi live ke endpoint Cardano NOWNodes sudah terbukti jalan (lewat `cardano-generate-wallet`, lihat §4) — tapi `bootstrapVault()` sendiri belum dijalankan, masih menunggu wallet terisi dana.

**[SELESAI] Gap header auth** — ditemukan saat generate wallet pertama kali: `Blockfrost` bawaan Lucid Evolution kirim header `project_id` (ditolak NOWNodes: "Unknown API_key"). Fix: `createNowNodesBlockfrostProvider()`, patch method `fetch` instance `Blockfrost` untuk sisipkan header `api-key` NOWNodes — tanpa reimplementasi interface `Provider` yang besar. Semua pemanggilan `new Blockfrost(...)` di `cardano.ts` sudah diganti ke helper ini.

## 4. Checklist aksi — apa yang perlu ANDA kerjakan sekarang

Urutan mengikuti jadwal §8 dokumen arsitektur. Item bertanda **(saya/Claude bisa bantu)** artinya tinggal minta, saya lanjutkan coding-nya begitu prasyaratnya (biasanya kunci/akun) sudah ada.

### Segera (blocking semua langkah berikutnya)
- [ ] **Isi `.env`** dari `.env.example` — minimal `NOWNODES_API_KEY` (daftar di nownodes.io kalau belum punya).
- [ ] **Buat wallet demo terpisah** (bukan wallet utama) untuk 3 peran: `DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY` (+`TRUSTED_OPERATOR_ADDRESS` turunannya), `USER_PRIVATE_KEY`. Isi dengan ETH Sepolia dari faucet (mis. `sepoliafaucet.com` / Alchemy faucet).
- [x] **Base/Arbitrum/Solana/Osmosis** — sudah ada jawaban langsung NOWNodes, lihat notice PIVOT di atas dokumen. Tidak perlu dicek lagi.

### Fase ETH Sepolia (baseline, lantai minimum — harus selalu siap submit)
- [x] `NOWNODES_API_KEY` terkonfirmasi jalan — `eth_chainId` dan `eth_getBalance` sukses lewat RPC Sepolia nyata
- [x] 3 wallet demo digenerate (`cast wallet new`) — **[DIGANTI]** per keputusan user 6 Okt, pakai wallet testnet milik user sendiri (dikonfirmasi bukan wallet dana asli), bukan hasil generate. Wallet lama tidak terfunded, dibiarkan di `.env` sebagai komentar fallback.
- [x] **Dry-run deploy sukses** (`forge script script/Deploy.s.sol --rpc-url https://eth-sepolia.nownodes.io/$NOWNODES_API_KEY`, tanpa `--broadcast`) — terhubung ke RPC nyata, baca `chainid`+`trustedOperator` dengan benar, simulasi penuh tanpa error (dengan wallet lama; belum diulang dengan address baru, tapi hasilnya akan sama karena logic tidak berubah). **Kebutuhan gas presisi: ≈0,00275 ETH** (gas price saat dicek: 2,24 gwei) — sarankan isi Deployer dengan ≥0,01 ETH untuk buffer deploy+submitAttestation.
- [x] **Private key wallet baru — menunggu user paste langsung ke `.env`** (tidak lewat chat, demi keamanan): `DEPLOYER_PRIVATE_KEY`/`USER_PRIVATE_KEY` = key dari `0x2044e31419185336B83675d8A5094304f07832c5`, `OPERATOR_PRIVATE_KEY` = key dari `0x127CD6D171cDEC6f3048236c254E02088df8A468` (sudah diisi ke `TRUSTED_OPERATOR_ADDRESS`).
- [x] Private key diisi user sendiri ke `.env`, saldo terkonfirmasi: Deployer/User `0x2044...` 0,2 ETH, Operator `0x127CD6...` 0,32 ETH
- [x] **DEPLOY SUNGGUHAN SUKSES** (6 Okt 2026) — `Verifier`: `0x7C8b17C04271170989Ad56aEa272F8b3B0a9dDAC`, `Vault`: `0xf1Ee7C94d0bEEd107A1e7A8E9BA924BAbB8D830f`, sudah dicatat ke `.env`
- [x] `check-deployment` PASS — bytecode terkonfirmasi ada di kedua address (Vault 1975 byte, Verifier 1872 byte)
- [x] Vault diisi 0,01 ETH (`cast send`, tx `0x304fe8168b1b8654afcc83f0f7b3ae88f34182d919b2c13b819bd2b9d1395162`)
- [x] **E2E HAPPY PATH SUKSES PENUH DI SEPOLIA ASLI** — `verifier-service` + `signer-script` dijalankan sungguhan: dual-sign → register → attest → withdraw, semua lewat RPC nyata, bukan simulasi. `actionHash`: `0x130dfa5202ebdedb36e5e881ea285e7a8664cd7fd9478949710a3b7a470ec138`. Tx atestasi: `0x42ad8e68e0a7dd508875ee5d301084e7f1cf321377f460256804a4545fc19e24` (gasUsed 52.273). Tx withdraw: `0x5b2bc17f71c4840736ab333665cfedd3c8261547d341dd35d821829fac012a61` (gasUsed 61.053). **Ini lantai minimum (§6 dokumen arsitektur) sudah benar-benar tercapai, bukan cuma siap.**
- [x] `attestation-logs` (eth_getLogs) PASS — event `AttestationSubmitted` terbaca sesuai actionHash+operator
- [x] `real-gas-numbers` PASS — **angka gas asli pengganti tabel ilustratif §7.2 dokumen arsitektur**: `submitAttestation` 52.273 gas (≈0,0000496 ETH), `withdraw` 61.053 gas (≈0,0000579 ETH). Lebih tinggi dari estimasi manual dokumen (≈25.100 gas) — wajar, estimasi manual tidak menghitung base tx cost (21.000) + calldata penuh.
- [ ] `gas-proof` (debug_traceTransaction) **GAGAL 405** — lihat §1b poin 8, tidak bisa dipakai dengan key ini

### Fase Base Sepolia (testnet terkonfirmasi — TIDAK butuh dana asli lagi)
- [ ] Deploy ulang kontrak (sama persis, cuma `--rpc-url $BASE_RPC_URL`) → address Vault/Verifier baru, beda dari Sepolia
- [ ] Jalankan `check-deployment` lagi untuk address Base
- [ ] Checklist keamanan mainnet di versi lama dokumen ini **tidak lagi berlaku** — testnet, bukan dana asli

### Fase Solana mainnet (dikonfirmasi resmi NOWNodes — bukan devnet)
- [x] Anchor CLI + Solana CLI terinstall & terverifikasi
- [x] GO/NO-GO #1: `anchor build` sukses, menghasilkan `.so` valid
- [x] Program `quattestor_solana` ditulis lengkap, **GO/NO-GO #2 lolos nyata**: `cargo test` 4/4 pass
- [x] **[DIGANTI, 6 Okt 2026]** Sempat digenerate 3 wallet via `solana-keygen` di sisi saya, lalu **dibatalkan atas keputusan user** — pakai wallet Phantom (bukan auto-generate) sesuai pola yang sudah dipakai untuk ETH Sepolia (§4 fase ETH). File lama sudah dihapus (tidak pernah terfunded).
- [ ] **Buat 3 akun di Phantom** (Deployer/Operator/User), export private key tiap akun (format base58, langsung cocok dengan `Keypair.fromSecretKey` di `solana.ts`), paste ke `.env` (`SOLANA_*_SECRET_KEY`) — instruksi lengkap ada di komentar `.env`.
- [ ] **Fase testing: devnet dulu, bukan mainnet NOWNodes** — keputusan baru user. `SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com` sudah ditambah ke `.env`, terpisah dari `SOLANA_RPC_URL` (NOWNodes, mainnet). Fund 3 akun Phantom via faucet devnet (`solana airdrop 1 <ADDR> --url devnet` atau `faucet.solana.com`) — gratis, bukan SOL asli.
- [ ] Deploy program ke **devnet** dulu (`anchor deploy --provider.cluster devnet`) untuk validasi e2e penuh tanpa risiko dana asli — `SOLANA_PROGRAM_ID` diisi dari hasil ini untuk fase testing.
- [ ] **Baru setelah devnet e2e lolos**: ulangi deploy ke **mainnet** lewat `SOLANA_RPC_URL` (NOWNodes) untuk submission asli — ini butuh SOL asli (checklist dana asli berlaku), `SOLANA_PROGRAM_ID` akan beda address dari hasil devnet.
- [ ] GO/NO-GO #3 (e2e devnet dulu, lalu e2e mainnet nyata) — menunggu wallet Phantom + dana di atas

### Fase Cardano mainnet (chain baru, ganti Osmosis)
- [x] Toolchain Aiken 1.1.24 terinstall & terverifikasi (`brew install aiken-lang/tap/aiken`)
- [x] Validator `vault.ak` + `verifier.ak` ditulis lengkap, **lolos test nyata**: `aiken check` 7/7 pass, `aiken build` sukses menghasilkan `plutus.json`
- [x] Adapter `packages/adapters/src/cardano.ts` ditulis lengkap via Lucid Evolution
- [x] Fungsi bootstrap vault UTXO — `cardano-bootstrap-vault` script, lihat §3c
- [x] **Header auth NOWNodes Blockfrost-compatible terkonfirmasi: `api-key`, bukan `project_id`** — ditemukan lewat panggilan nyata (`project_id` dari Blockfrost provider bawaan Lucid ditolak: "Unknown API_key"). Fix: `createNowNodesBlockfrostProvider()` di `cardano.ts` (patch instance method `fetch` milik `Blockfrost`, bukan reimplementasi interface `Provider` dari nol).
- [x] Wallet Operator+User via `cardano-generate-wallet` (sempat dipertimbangkan ganti ke wallet app Eternl/Nami/Lace, lalu **diputuskan tetap pakai yang digenerate** — pola sama dengan Solana yang juga pindah dari Phantom ke `solana-keygen` karena UI export key lebih merepotkan). Wallet ini sudah live-verified (generasi inilah yang menemukan bug header `api-key` vs `project_id` di atas).
- [x] Kode tetap mendukung **private key bech32 ATAU seed phrase 12/24 kata** (`selectWalletFromSecret`) kalau nanti mau pindah ke wallet app — tidak hangus meski tidak dipakai sekarang. Plus script `cardano-derive-address` untuk kasus itu.
- [ ] **Isi dana ADA asli** ke address Operator (`addr1vx8l66l...`) & User (`addr1v864swj6...`, butuh paling banyak) — mainnet sungguhan, checklist keamanan dana asli berlaku. Lihat `.env` untuk address lengkap.
- [ ] Jalankan `cardano-bootstrap-vault` begitu User terisi dana
- [ ] GO/NO-GO e2e mainnet nyata — menunggu dana di atas

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
| **Ethereum Sepolia** | `Vault.sol`/`Verifier.sol` — selesai, 6/6 test pass | `packages/adapters/src/evm.ts` — selesai | **Tinggal isi env + deploy.** Testnet, tidak butuh dana asli. |
| **Base Sepolia** | **Bytecode identik** dengan Sepolia (klaim inti arsitektur: 0 baris berubah) | **Sama persis** `evm.ts` — cuma config (`rpcUrl`/`vaultAddress`/`verifierAddress`) beda | Kode selesai. Tetap harus deploy ulang (`--rpc-url $BASE_RPC_URL`) untuk address baru, tapi **testnet dikonfirmasi NOWNodes** — tidak butuh dana asli, checklist keamanan mainnet versi lama sudah tidak berlaku. |
| **Solana** | **Selesai, lolos test nyata** — program Anchor `quattestor_solana` (`contracts/solana`), `cargo test` 4/4 pass | **Selesai** — `packages/adapters/src/solana.ts`, ed25519 verify + baca/tulis state manual via NOWNodes RPC | Kode lengkap di kedua sisi. **Mainnet sungguhan** (dikonfirmasi NOWNodes, bukan devnet) — berlaku checklist keamanan dana asli. Belum diuji ke RPC nyata. |
| **Cardano** | **Selesai, lolos test nyata** — Aiken `vault.ak` (spending validator) + `verifier.ak` (minting policy), `aiken check` 7/7 pass, `aiken build` sukses | **Selesai** — `packages/adapters/src/cardano.ts` via Lucid Evolution, **dengan 2 gap desain terbuka** (§3c: pubkey vs address, bentuk `operatorKey` beda) | Kode lengkap di kedua sisi. **Mainnet sungguhan** — berlaku checklist dana asli. Belum diuji ke RPC nyata, belum ada fungsi bootstrap vault UTXO (§3c), dan header auth NOWNodes (`project_id` vs `api-key`) belum terverifikasi. |

**Chain yang dihapus dari scope (lihat notice PIVOT di atas untuk alasan):** Arbitrum (dibatalkan, keputusan user), Osmosis (dihapus, kode sudah di-delete dari repo — riwayatnya di git log commit sebelum pivot ini kalau perlu dirujuk).

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
| `VAULT_ADDRESS`, `VERIFIER_ADDRESS` | **Catatan §1b poin 6: `forge`/`cast` butuh URL dengan key di path, bukan `$ETH_RPC_URL` biasa** (yang header-based, cuma dipahami kode TS). Jalankan: `forge script script/Deploy.s.sol --rpc-url https://eth-sepolia.nownodes.io/$NOWNODES_API_KEY --broadcast --private-key $DEPLOYER_PRIVATE_KEY` — address Vault & Verifier tercetak di output terminal, copy ke sini. Setelah Vault punya address, kirim sedikit ETH ke address itu (`cast send $VAULT_ADDRESS --value 0.01ether --rpc-url https://eth-sepolia.nownodes.io/$NOWNODES_API_KEY --private-key $DEPLOYER_PRIVATE_KEY`) supaya ada saldo untuk di-`withdraw()` saat demo. |

### Opsional / fase berikutnya

| Variabel | Catatan |
|---|---|
| `ETH_WSS_URL` | **Format belum terverifikasi** (halaman dokumentasi WSS NOWNodes JS-rendered, tidak bisa di-scrape). Cek di dashboard NOWNodes setelah API key dibuat, atau tanya mentor NOWNodes di venue/Discord. Tidak wajib untuk smoke test pertama — endpoint `/attest` jalan lewat HTTP biasa tanpa WSS. |
| `BASE_RPC_URL` | Sudah terisi di `.env.example` (`base-sepolia.nownodes.io`, dikonfirmasi NOWNodes khusus key hackathon). Dipakai saat fase Base (ganti `ETH_RPC_URL`/`CHAIN_ID`/`VAULT_ADDRESS`/`VERIFIER_ADDRESS` ke nilai Base saat deploy ke sana). |
| `VERIFIER_SERVICE_URL`, `PORT` | Default `http://localhost:8787` sudah benar untuk jalan di satu laptop, tidak perlu diubah. |
| `AMOUNT_WEI` | Jumlah demo withdraw dalam wei, bebas Anda pilih (contoh default: `1000000000000000` = 0.001 ETH) — harus ≤ saldo yang sudah dikirim ke Vault. |

**Catatan arsitektur penting:** satu `.env` ini mewakili **satu chain EVM pada satu waktu**. Kalau nanti mau jalankan servis lawan Base, cara paling sederhana adalah salin `.env` jadi `.env.base` dengan `ETH_RPC_URL`→isi `BASE_RPC_URL`, `CHAIN_ID`→`84532`, dan `VAULT_ADDRESS`/`VERIFIER_ADDRESS` hasil deploy di Base — bukan bug, ini konsekuensi langsung dari klaim "0 baris kode berubah, cuma config" yang memang didesain begitu.

### Solana & Cardano — keduanya mainnet sungguhan, checklist dana asli berlaku

| Variabel | Cara mendapatkannya |
|---|---|
| `SOLANA_RPC_URL` | Sudah terisi (`sol.nownodes.io`, dikonfirmasi NOWNodes). |
| `SOLANA_PROGRAM_ID` | Hasil deploy program Anchor (`anchor deploy` atau `solana program deploy`), belum dijalankan. |
| `SOLANA_*_SECRET_KEY` | Generate wallet baru: `solana-keygen new --outfile <path>`, isi SOL asli secukupnya (mainnet, bukan faucet). |
| `CARDANO_RPC_URL` | Sudah terisi (`ada-blockfrost.nownodes.io`, dikonfirmasi NOWNodes). |
| `CARDANO_TRUSTED_OPERATOR_PKH` | Hex VerificationKeyHash dari wallet Operator Cardano — turunan dari private key, bisa didapat lewat `cardano-cli` atau library Lucid (`getAddressDetails(address).paymentCredential.hash`). |
| `CARDANO_PLUTUS_BLUEPRINT_PATH` | Sudah terisi (`./contracts/cardano/plutus.json`), dihasilkan `aiken build`, tidak perlu diubah. |
| `CARDANO_*_SKEY` | Private key bech32 (`ed25519_sk...`) — generate wallet baru via Lucid (`generatePrivateKey()`) atau `cardano-cli`, isi ADA asli secukupnya. |

**Belum ada helper command untuk ini** (beda dari EVM yang punya `cast wallet new`, Solana yang punya `solana-keygen`) — generate wallet Cardano lewat Lucid butuh sedikit script Node sendiri kalau mau cepat; beri tahu saya kalau mau saya buatkan.

## 7. Status repo & git

- Repo lokal: `/Users/maziazi/Coding/hackathon/Quattestor/Code`, branch `main`, remote `origin` → `git@github.com:maziazi/Quattestor.git` (private).
- Commit pertama ditulis dengan identitas git yang sudah ada di mesin ini (`maziazi`) — **tidak ada co-author atau footer "Generated with Claude"** di commit manapun, sesuai permintaan.
- Semua `*_PRIVATE_KEY` dan `.env` masuk `.gitignore` — tidak akan pernah masuk commit.

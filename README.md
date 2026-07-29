# LivePoll

LivePoll is a mini end-to-end Stellar + Soroban dApp: a multi-wallet polling app backed by a deployed Soroban smart contract on Stellar Testnet, with real-time contract event sync, transaction progress feedback, basic caching, and a small automated test suite.

## Level 3 Submission Checklist (fill before submitting)

- Live demo link: https://online-live-poll-three.vercel.app/
- Demo video (1 minute) link: https://drive.google.com/file/d/1Sh3bbCZ0AnWxyrXXdl6EpDmLfmiEUJqn/view?usp=sharingTest output screenshot (3+ passing tests): ✅ (see below)
- Public GitHub repo link: https://github.com/vishalkr11900124040-boop/online_live_poll_level-3
- 3+ meaningful commits for Level 3: ✅


## Submission Evidence — Include These Files

> **Important:** The complete folders below must be included in the submitted repository/archive. This README documents the implementation, but it does not replace the source files required to verify it.

| Requirement | Source evidence to include | What it verifies |
| --- | --- | --- |
| Wallet connection | `src/lib/stellar.js` | `StellarWalletsKit` setup and wallet connection logic |
| Soroban contract structure and logic | `poll_contract/Cargo.toml`, `poll_contract/src/lib.rs` | Contract crate, poll storage, and contract entry points |
| Frontend-to-contract integration | `src/lib/stellar.js` and the React components under `src/` | RPC calls, contract invocation, signing, and UI state updates |
| Contract artifact | `public/contracts/poll_contract.wasm` | Compiled WASM/spec used by the frontend at runtime |
| Contract build/deploy flow | `scripts/` and `package.json` | Build, WASM sync, and Testnet deployment commands |
| Automated verification | `tests/` | Tests for frontend helper logic |

For review, do **not** submit only built assets, screenshots, or this README. Include the `poll_contract/`, `src/`, `scripts/`, and `tests/` directories as source-controlled files.

## What Can Be Verified from the Source

1. **Wallet support:** `src/lib/stellar.js` configures `StellarWalletsKit` for compatible wallets, including Freighter, xBull, Albedo, Rabet, Lobstr, Hana, Hot Wallet, and Klever.
2. **Contract implementation:** `poll_contract/src/lib.rs` contains the Soroban contract code for creating, voting on, closing, reading, and deleting polls.
3. **Contract calls in the frontend:** `src/lib/stellar.js` constructs and submits Soroban RPC transactions for the same public contract operations exposed in the UI.
4. **UI/contract matching:** React components call the integration helpers for create, vote, close, delete, and read actions; the event sync refreshes the displayed poll state.
5. **Runtime contract specification:** `npm run wasm:sync` copies the compiled contract WASM to `public/contracts/poll_contract.wasm`, which the frontend uses to load the contract specification.

## Submission Verification Steps

From the project root, a reviewer can verify the required evidence with:

```bash
# Confirm that the required source files are present
test -f poll_contract/src/lib.rs
test -f src/lib/stellar.js

# Inspect the contract entry points and frontend integration
rg "create_poll|vote|close_poll|delete_poll" poll_contract/src/lib.rs src/lib/stellar.js
rg "StellarWalletsKit" src/lib/stellar.js

# Build the contract and frontend, then run the test suite
npm install
npm run contract:build
npm run wasm:sync
npm test
npm run build
```

On Windows PowerShell, use the following source-presence check instead of `test -f`:

```powershell
Test-Path poll_contract/src/lib.rs
Test-Path src/lib/stellar.js
```

## Key Features

- Multi-wallet integration with `StellarWalletsKit`
- Soroban smart-contract reads and writes on Stellar Testnet
- Create, vote on, close, delete, and browse polls
- Read-only poll browsing without a connected wallet
- Transaction phases: `preparing`, `awaiting-signature`, `pending`, `success`, and `error`
- Wallet error handling for missing wallet, rejected requests, and insufficient balance
- Event polling and state synchronization
- `localStorage` caching for recently loaded poll data
- Automated tests for core helper logic

## Screenshots

### 🏠 Home Page
![Home Page](https://github.com/vishalkr11900124040-boop/online_live_poll_level-3/blob/main/images/Screenshot%202026-07-25%20163514.png?raw=true)

### 📝 Create Poll
![Create Poll](https://github.com/vishalkr11900124040-boop/online_live_poll_level-3/blob/main/images/Screenshot%202026-07-25%20163701.png?raw=true)

### 🗳️ Vote on Poll
![Voting](https://github.com/vishalkr11900124040-boop/online_live_poll_level-3/blob/main/images/Screenshot%202026-07-25%20163630.png?raw=true)

✅ CI/CD
    ![frontend / contract](https://github.com/vishalkr11900124040-boop/online_live_poll_level-3/blob/main/images/Screenshot%202026-07-25%20163905.png?raw=true)

## Mobile responsive screenshots

Below is a mobile view screenshot demonstrating the responsive layout on narrow screens. Replace the placeholder with a real phone-sized screenshot captured from the dev tools or a device.

![Mbile responsive screenshot](https://github.com/vishalkr11900124040-boop/online_live_poll_level-3/blob/main/images/WhatsApp%20Image%202026-07-25%20at%204.40.21%20PM.jpeg?raw=true)


## Deployed Contract

- Network: `Stellar Testnet`
- Contract address: `CDPYFRUN6ZRKUIKZR45AMWF7SYPQJL4WRJIBJI2SR3DWRMMANTXXRMD2`
- Contract explorer: https://stellar.expert/explorer/testnet/contract/CDPYFRUN6ZRKUIKZR45AMWF7SYPQJL4WRJIBJI2SR3DWRMMANTXXRMD2

## Verifiable Contract Call

- Deploy tx hash: `0e1e13467216b3056b5351fd7d10ea59e2bc3d3000056fe236e42d5e2cb4bcdd`
- Stellar Expert link: https://stellar.expert/explorer/testnet/tx/0e1e13467216b3056b5351fd7d10ea59e2bc3d3000056fe236e42d5e2cb4bcdd
- Sample `create_poll` tx hash: `e5a4df2c3ef97235d1b33ebe043cb66ab5642d53f0319caabc9f98e2239712c8`
- Stellar Expert link: https://stellar.expert/explorer/testnet/tx/e5a4df2c3ef97235d1b33ebe043cb66ab5642d53f0319caabc9f98e2239712c8

## Live Demo

https://online-live-poll.vercel.app/

## Setup

Run all commands from the `live-poll` project directory.

1. Install dependencies:

```bash
npm install
```

2. Build the Soroban contract:

```bash
npm run contract:build
```

3. Sync the compiled contract WASM into the frontend (used to load the contract spec/ABI at runtime):

```bash
npm run wasm:sync
```

4. Optionally create a local env file:

```powershell
Copy-Item .env.example .env.local
```

5. Start the frontend:

```bash
npm run dev
```

6. Build for production:

```bash
npm run build
```

## Tests

Run the automated tests:

```bash
npm test
```

For submission, include a screenshot of the terminal output showing **3+ tests passing**.

## Environment Variables

```env
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_STELLAR_CONTRACT_ID=CDPYFRUN6ZRKUIKZR45AMWF7SYPQJL4WRJIBJI2SR3DWRMMANTXXRMD2
VITE_STELLAR_READ_ACCOUNT=
VITE_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet
VITE_POLL_CONTRACT_WASM_URL=/contracts/poll_contract.wasm
```

## Testnet Notes

- A connected wallet must be funded on Stellar Testnet before it can send contract transactions
- If a wallet has not been created on Testnet yet, fund it with Friendbot first and then retry
- The app can still read poll data without a funded wallet by using a temporary read account

## Scripts

- `npm run dev` starts the frontend
- `npm run build` creates a production build
- `npm run lint` runs ESLint
- `npm test` runs the Node.js test suite
- `npm run contract:build` builds the Soroban contract
- `npm run wasm:sync` copies the compiled WASM into `public/contracts/` for the frontend to load the contract spec
- `npm run contract:deploy` uploads and deploys the contract to testnet

## Deploy (Vercel / Netlify)

This is a standard Vite build.

- Node.js: use Node `^20.19.0` or `>=22.12.0` (required by Vite 8)
- Build command: `npm run build`
- Output directory: `dist`
- Set the env vars from the section above (at minimum `VITE_STELLAR_CONTRACT_ID` if you deploy a new contract)

## Demo Video (1 minute)

https://drive.google.com/file/d/1SRK_eF2qJyIfuN-KMlgzCpeacAeYJ23t/view?usp=sharing

Walkthrough:

1. Open the deployed site and show the “Read from contract” panel updating.
2. Connect a wallet (Freighter or any supported wallet).
3. Create a poll (show “awaiting-signature” → “pending” → “success”).
4. Vote on the poll and show the event feed / vote count updating.
5. Open the contract/tx on Stellar Expert via the links in the UI.

## Project Structure

- `src/` contains the React frontend
- `src/lib/stellar.js` contains wallet, RPC, contract, and event helpers
- `src/lib/pollCache.js` contains the basic poll cache helpers
- `src/lib/pollLogic.js` contains pure helper functions used by the UI
- `poll_contract/` contains the Soroban contract
- `scripts/` contains deployment helpers
- `tests/` contains the automated test suite

## Additional Docs

- Frontend guide: [FRONTEND.md](./FRONTEND.md)
- Contract guide: [poll_contract/README.md](./poll_contract/README.md)

## Submission Notes

- GitHub repository: `https://github.com/Sagar522290/livepoll.git`
- The project includes multiple meaningful commits in git history
- The contract is deployed on testnet and called from the frontend
- Real-time event integration and visible transaction status are implemented
- Before final submission, update the checklist at the top with your live demo link, demo video link, and test screenshot

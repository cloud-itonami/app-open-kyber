#!/usr/bin/env bash
# Build kyber-erp-core → a kotoba `kotoba-node` WASM component + compute its IPFS CID.
# Mirrors the com-etzhayyim-tsumugi and com-etzhayyim-kanae standalone-repo
# WASM build convention (ADR-2606014500 / 2606037200 R3).
set -euo pipefail
cd "$(dirname "$0")"

# Use the rustup-managed toolchain that has the wasm32-wasip2 std (the Homebrew rustc does not).
TC="${RUSTUP_HOME:-$HOME/.rustup}/toolchains/$(rustup default | awk '{print $1}')/bin"
export PATH="$TC:$PATH"
rustup target add wasm32-wasip2 >/dev/null 2>&1 || true

echo "→ cargo build (wasm32-wasip2, release)"
env -u RUSTC -u RUSTC_WRAPPER cargo build --target wasm32-wasip2 --release

WASM="target/wasm32-wasip2/release/kyber_erp_core.wasm"

echo "→ validate component (exports run, imports kotoba:kais/{kqe,auth})"
wasm-tools validate --features component-model "$WASM"
wasm-tools component wit "$WASM" | grep -qE "export run:" && echo "  ✓ exports run"

echo "→ CID (cid-version=1)"
CID="$(ipfs add -Q --only-hash --cid-version=1 "$WASM")"
SIZE="$(wc -c < "$WASM" | tr -d ' ')"
echo "  CID  = $CID"
echo "  size = $SIZE bytes"

echo
echo "Next (operator, gated):"
echo "  1. publish bytes:  ipfs add --cid-version=1 $WASM   (or kotoba block put)"
echo "  2. advertise:      set wasmCid=$CID in 50-infra/etzhayyim-did-web/src/registry/infra-actors.ts (kyber)"
echo "  3. run:            node 50-infra/e7m-wasm-runner/runner.mjs --did did:web:etzhayyim.com:actor:kyber"

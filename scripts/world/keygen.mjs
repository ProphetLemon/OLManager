#!/usr/bin/env node
// Creates the overlay signing keypair ONLY if none exists. Prints the public key, never the private one.
import { fingerprint, generateKeypair, PUBLIC_KEY_FILE, resolveKeyPath } from "./lib/signing.mjs";

const keyPath = resolveKeyPath();
const { created, publicKey } = generateKeypair(keyPath);
console.log(created ? `world:keygen: created private key at ${keyPath} (mode 0600). Back it up; it never goes in the repo.` : `world:keygen: key already exists at ${keyPath}; left untouched`);
console.log(`public key (base64, commit as ${PUBLIC_KEY_FILE}):\n${publicKey}`);
console.log(`fingerprint (sha256): ${fingerprint(publicKey)}`);

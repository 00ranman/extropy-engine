/**
 * Ed25519 key handling for the sandbox node-handshake.
 *
 * Production keys should be derived from the participant's DID material via
 * the @extropy/identity package. The sandbox path here exists to give the
 * proof-of-concept harness something to sign with on day one.
 */

import { createSign, createVerify, generateKeyPairSync, KeyObject, createPrivateKey, createPublicKey } from 'node:crypto';

export interface NodeKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyB64: string;
  nodeId: string; // "ed25519:<base64>"
}

export function generateNodeKeyPair(): NodeKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ format: 'der', type: 'spki' });
  // strip the 12-byte SPKI prefix to get the raw 32-byte Ed25519 pubkey
  const raw = pubRaw.subarray(pubRaw.length - 32);
  const publicKeyB64 = raw.toString('base64');
  return {
    privateKey,
    publicKey,
    publicKeyB64,
    nodeId: `ed25519:${publicKeyB64}`,
  };
}

export function loadKeyPairFromEnv(): NodeKeyPair {
  const pkcs8 = process.env.NODE_PRIVATE_KEY_PEM;
  if (pkcs8) {
    const privateKey = createPrivateKey({ key: pkcs8, format: 'pem' });
    const publicKey = createPublicKey(privateKey);
    const pubRaw = publicKey.export({ format: 'der', type: 'spki' });
    const raw = pubRaw.subarray(pubRaw.length - 32);
    const publicKeyB64 = raw.toString('base64');
    return {
      privateKey,
      publicKey,
      publicKeyB64,
      nodeId: `ed25519:${publicKeyB64}`,
    };
  }
  // Fall back to ephemeral key for sandbox runs
  return generateNodeKeyPair();
}

export function sign(privateKey: KeyObject, payload: string): string {
  const signer = createSign('SHA512'); // ignored for ed25519, but required by API shape
  signer.update(payload);
  // For Ed25519 in node, use crypto.sign directly:
  const buf = Buffer.from(payload, 'utf-8');
  const sig = require('node:crypto').sign(null, buf, privateKey);
  return sig.toString('base64');
}

export function verify(nodeId: string, payload: string, signatureB64: string): boolean {
  if (!nodeId.startsWith('ed25519:')) return false;
  const pubB64 = nodeId.slice('ed25519:'.length);
  const pubRaw = Buffer.from(pubB64, 'base64');
  if (pubRaw.length !== 32) return false;
  // Wrap in SPKI prefix for createPublicKey
  const spkiPrefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const spki = Buffer.concat([spkiPrefix, pubRaw]);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const sigBuf = Buffer.from(signatureB64, 'base64');
  const payloadBuf = Buffer.from(payload, 'utf-8');
  return require('node:crypto').verify(null, payloadBuf, publicKey, sigBuf);
}

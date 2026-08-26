/**
 * W3C did:key (Ed25519) for a laptop node.
 * Same codec as @extropy/identity publicKeyMultibase — 0xed01 + base58btc.
 * Spec: https://w3c-ccg.github.io/did-method-key/
 *
 * First boot writes data/keys/node.pem (PKCS8, 0600) and data/did.json (public).
 * You do not apply. You do not register.
 */
import fs from "node:fs";
import path from "node:path";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SPKI = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

function b58encode(buf) {
  if (buf.length === 0) return "";
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) out = "1" + out;
  return out;
}

function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (let i = 0; i < s.length && s[i] === "1"; i++) bytes.unshift(0);
  return Buffer.from(bytes);
}

function rawPub(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

export function publicKeyMultibase(raw32) {
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw32]);
  return "z" + b58encode(prefixed);
}

export function encodeDidKey(raw32) {
  return `did:key:${publicKeyMultibase(raw32)}`;
}

export function encodeDidExtropy(raw32) {
  return `did:extropy:${raw32.toString("hex")}`;
}

export function rawFromDidKey(did) {
  if (!did.startsWith("did:key:z")) throw new Error("not did:key");
  const decoded = b58decode(did.slice("did:key:z".length));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01 || decoded.length !== 34) {
    throw new Error("did:key is not ed25519-pub");
  }
  return decoded.subarray(2);
}

function publicFromRaw(raw32) {
  return createPublicKey({ key: Buffer.concat([SPKI, raw32]), format: "der", type: "spki" });
}

export function loadOrCreateIdentity(dataDir) {
  const keyDir = path.join(dataDir, "keys");
  const pemPath = path.join(keyDir, "node.pem");
  const pubPath = path.join(dataDir, "did.json");
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });

  let privateKey;
  if (fs.existsSync(pemPath)) {
    privateKey = createPrivateKey({ key: fs.readFileSync(pemPath, "utf8"), format: "pem" });
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    const pem = privateKey.export({ format: "pem", type: "pkcs8" });
    fs.writeFileSync(pemPath, pem, { mode: 0o600 });
  }

  const publicKey = createPublicKey(privateKey);
  const raw = rawPub(publicKey);
  const did = encodeDidKey(raw);
  const also = encodeDidExtropy(raw);
  const multibase = publicKeyMultibase(raw);
  let created = new Date().toISOString();
  if (fs.existsSync(pubPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(pubPath, "utf8"));
      if (prev.created) created = prev.created;
    } catch {
      /* rewrite */
    }
  }
  const pub = {
    did,
    also,
    publicKeyMultibase: multibase,
    method: "did:key",
    curve: "Ed25519",
    created,
  };
  fs.writeFileSync(pubPath, JSON.stringify(pub, null, 2));
  return { privateKey, publicKey, raw, ...pub, pemPath };
}

export function signPayload(privateKey, payload) {
  const buf = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return nodeSign(null, buf, privateKey).toString("base64url");
}

export function verifyDidKey(did, payload, sigB64u) {
  const raw = rawFromDidKey(did);
  const publicKey = publicFromRaw(raw);
  const buf = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  const sig = Buffer.from(sigB64u, "base64url");
  return nodeVerify(null, buf, publicKey, sig);
}

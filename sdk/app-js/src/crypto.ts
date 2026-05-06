import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, randomBytes } from "node:crypto";
import { MusubiDecryptError } from "./errors.ts";

const X25519_PRIVATE_DER_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_PUBLIC_DER_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const BOX_CONTEXT = "musubi-m1-x25519-aes-256-gcm:";

interface EncryptedBox {
  nonce: string;
  tag: string;
  data: string;
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateX25519KeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  privateKey[0] &= 248;
  privateKey[31] &= 127;
  privateKey[31] |= 64;
  const keyObject = createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_DER_PREFIX, privateKey]),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = createPublicKey(keyObject).export({ format: "der", type: "spki" }) as Buffer;
  return {
    privateKey: privateKey.toString("base64"),
    publicKey: publicDer.subarray(publicDer.length - 32).toString("base64"),
  };
}

export function publicKeyFromPrivateKey(privateKey: string): string {
  const keyObject = privateKeyObject(privateKey);
  const publicDer = createPublicKey(keyObject).export({ format: "der", type: "spki" }) as Buffer;
  return publicDer.subarray(publicDer.length - 32).toString("base64");
}

export function encryptPublicJson(value: unknown, privateKey: string, peerPublicKey: string): string {
  const key = derivePublicBoxKey(privateKey, peerPublicKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const box: EncryptedBox = {
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return Buffer.from(JSON.stringify(box), "utf8").toString("base64");
}

export function decryptPublicJson<T>(ciphertext: string, privateKey: string, peerPublicKey: string): T {
  try {
    const key = derivePublicBoxKey(privateKey, peerPublicKey);
    const box = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")) as EncryptedBox;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(box.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (error) {
    throw new MusubiDecryptError("failed to decrypt Musubi result", { code: "DECRYPT_FAILED", details: error });
  }
}

function derivePublicBoxKey(privateKey: string, peerPublicKey: string): Buffer {
  const shared = diffieHellman({
    privateKey: privateKeyObject(privateKey),
    publicKey: publicKeyObject(peerPublicKey),
  });
  return createHash("sha256").update(BOX_CONTEXT).update(shared).digest();
}

function privateKeyObject(privateKey: string) {
  return createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_DER_PREFIX, Buffer.from(privateKey, "base64")]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeyObject(publicKey: string) {
  return createPublicKey({
    key: Buffer.concat([X25519_PUBLIC_DER_PREFIX, Buffer.from(publicKey, "base64")]),
    format: "der",
    type: "spki",
  });
}

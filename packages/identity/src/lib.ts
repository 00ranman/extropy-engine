/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity, library entry
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Re-exports the cryptographic primitives, DID helpers, and VC issuance from
 *  the identity package without booting the express service in src/index.ts.
 *  Other in repo packages should import from `@extropy/identity/lib` to avoid
 *  triggering a second listener.
 * ════════════════════════════════════════════════════════════════════════════════
 */

export {
  generateIdentityKeyPair,
  publicKeyFromHex,
  privateKeyFromPem,
  sign,
  verify,
  sha256,
  sha256Hex,
  b64urlEncode,
  b64urlDecode,
  deriveNullifier,
  randomSecret,
} from './crypto.js';
export type { IdentityKeyPair } from './crypto.js';

export {
  encodeDid,
  parseDid,
  isExtropyDid,
  publicKeyHexFromDid,
  publicKeyMultibase,
  buildDidDocument,
  DID_METHOD,
  DID_PREFIX,
} from './did.js';
export type { DidDocument, VerificationMethod, ServiceEndpoint } from './did.js';

export {
  issueCredential,
  verifyCredential,
} from './vc.js';
export type {
  CredentialType,
  VerifiableCredential,
  IssueCredentialOptions,
  VerifyResult,
} from './vc.js';

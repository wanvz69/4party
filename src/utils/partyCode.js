import { randomBytes, randomUUID } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePartyCode(length = 5) {
  let code = '';
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 256 - (256 % alphabet.length)) {
        code += alphabet[byte % alphabet.length];
        if (code.length === length) break;
      }
    }
  }
  return code;
}

export function generatePartyId() {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

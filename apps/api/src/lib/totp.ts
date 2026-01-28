import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function createTotp(secret: string, issuer: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function verifyTotp(secret: string, code: string, label: string): boolean {
  const totp = createTotp(secret, 'LectureFlow', label);
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

export async function generateQrCodeDataUrl(
  secret: string,
  email: string,
  issuer = 'LectureFlow',
): Promise<string> {
  const totp = createTotp(secret, issuer, email);
  const uri = totp.toString();
  return QRCode.toDataURL(uri);
}

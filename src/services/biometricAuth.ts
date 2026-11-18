function randomChallenge(): Uint8Array {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !window.PublicKeyCredential ||
    !navigator.credentials
  ) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export interface BiometricResult {
  success: boolean;
  credentialId?: string;
  error?: string;
}

export async function enrollBiometricCredential(
  accountLabel = 'Kestrel Trader',
): Promise<BiometricResult> {
  try {
    const supported = await isPlatformBiometricAvailable();
    if (!supported) {
      return {
        success: false,
        error: 'Platform biometric authenticator is unavailable in this browser context. Use PIN fallback.',
      };
    }

    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge() as BufferSource,
        rp: {
          name: 'Kestrel Trade',
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: accountLabel,
          displayName: accountLabel,
        },
        pubKeyCredParams: [
          {alg: -7, type: 'public-key'}, // ES256
          {alg: -257, type: 'public-key'}, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return {success: false, error: 'Biometric enrollment was cancelled.'};
    }

    return {
      success: true,
      credentialId: bufferToBase64Url(credential.rawId),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Biometric enrollment blocked or cancelled.';
    return {success: false, error: message};
  }
}

export async function verifyBiometricCredential(
  credentialId: string,
): Promise<BiometricResult> {
  try {
    const allowCredentials: PublicKeyCredentialDescriptor[] = [
      {
        id: base64UrlToUint8Array(credentialId) as BufferSource,
        type: 'public-key',
        transports: ['internal'],
      },
    ];

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge() as BufferSource,
        rpId: window.location.hostname,
        allowCredentials,
        userVerification: 'required',
        timeout: 60000,
      },
    });

    if (!assertion) {
      return {success: false, error: 'Biometric verification failed.'};
    }
    return {success: true, credentialId};
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Biometric prompt cancelled or blocked.';
    return {success: false, error: message};
  }
}

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`kestrel-trade-salt:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64Url(digest);
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const candidate = await hashPin(pin);
  return candidate === storedHash;
}

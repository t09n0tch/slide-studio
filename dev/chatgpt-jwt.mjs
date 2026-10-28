import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';

export function identityVerifier(jwksUrl, fetcher) {
  const keys = createRemoteJWKSet(new URL(jwksUrl), {
    [customFetch]: (url, options) => fetcher(url, { ...options, redirect: 'error' }),
    timeoutDuration: 15000
  });
  return async (token, clientId, { nonce, subject, receivedAt } = {}) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: 'https://auth.openai.com', audience: clientId, algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp'], clockTolerance: 10,
      ...(receivedAt ? { currentDate: new Date(receivedAt) } : {})
    });
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce && payload.nonce !== nonce) || (subject && payload.sub !== subject)) {
      throw new Error('Identity verification failed');
    }
    return { subject: payload.sub, identity: {
      ...(typeof payload.name === 'string' ? { name: payload.name.slice(0, 200) } : {}),
      ...(typeof payload.email === 'string' ? { email: payload.email.slice(0, 200) } : {})
    } };
  };
}

const verificationReturn = (webOrigin: string) =>
  new URL('/login?verification=complete', webOrigin).toString();

export function betterAuthSignUpBody(
  input: { name: string; email: string; password: string },
  webOrigin: string,
) {
  return { ...input, callbackURL: verificationReturn(webOrigin) };
}

export function betterAuthSignInBody(
  input: { email: string; password: string },
  webOrigin: string,
) {
  return { ...input, callbackURL: verificationReturn(webOrigin) };
}

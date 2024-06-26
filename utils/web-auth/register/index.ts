import * as utils from './utils'
import type {
  RegisterOptions,
  RegistrationEncoded,
  AuthType,
  NumAlgo,
  NamedAlgo
} from './types'

/**
 * Returns whether the device itself can be used as authenticator.
 */
export async function isLocalAuthenticator(): Promise<boolean> {
  return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
}

async function getAuthAttachment(
  authType: AuthType
): Promise<AuthenticatorAttachment | undefined> {
  if (authType === 'local') return 'platform'
  if (authType === 'roaming' || authType === 'extern') return 'cross-platform'
  if (authType === 'both') return undefined // The webauthn protocol considers `null` as invalid but `undefined` as "both"!

  // the default case: "auto", depending on device capabilities
  try {
    if (await isLocalAuthenticator()) return 'platform'
    else return 'cross-platform'
  } catch (e) {
    // might happen due to some security policies
    // see https://w3c.github.io/webauthn/#sctn-isUserVerifyingPlatformAuthenticatorAvailable
    return undefined // The webauthn protocol considers `null` as invalid but `undefined` as "both"!
  }
}

function getAlgoName(num: NumAlgo): NamedAlgo {
  switch (num) {
    case -7:
      return 'ES256'
    // case -8 ignored to to its rarity
    case -257:
      return 'RS256'
    default:
      throw new Error(`Unknown algorithm code: ${num}`)
  }
}

export async function registerByPasskey(
  username: string,
  challenge: string,
  options?: RegisterOptions
): Promise<RegistrationEncoded> {
  options = options ?? {}

  if (!utils.isBase64url(challenge))
    throw new Error('Provided challenge is not properly encoded in Base64url')

  const creationOptions: PublicKeyCredentialCreationOptions = {
    challenge: utils.parseBase64url(challenge),
    rp: {
      id: window.location.hostname,
      name: window.location.hostname
    },
    user: {
      id: options.userHandle
        ? utils.toBuffer(options.userHandle)
        : await utils.sha256(
            new TextEncoder().encode('passwordless.id-user:' + username)
          ), // ID should not be directly "identifiable" for privacy concerns
      name: username,
      displayName: username
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256 (Webauthn's default algorithm)
      { alg: -257, type: 'public-key' } // RS256 (for Windows Hello and others)
    ],
    timeout: options.timeout ?? 60000,
    authenticatorSelection: {
      userVerification: options.userVerification ?? 'required', // Webauthn default is "preferred"
      authenticatorAttachment: await getAuthAttachment(
        options.authenticatorType ?? 'auto'
      ),
      residentKey: options.discoverable ?? 'preferred', // official default is 'discouraged'
      requireResidentKey: options.discoverable === 'required' // mainly for backwards compatibility, see https://www.w3.org/TR/webauthn/#dictionary-authenticatorSelection
    },
    attestation: 'direct'
  }

  if (options.debug) console.debug(creationOptions)

  const credential = (await navigator.credentials.create({
    publicKey: creationOptions
  })) as any //PublicKeyCredential

  if (options.debug) console.debug(credential)

  const response = credential.response as AuthenticatorAttestationResponse // AuthenticatorAttestationResponse

  let registration: RegistrationEncoded = {
    username,
    credential: {
      id: credential.id,
      publicKey: utils.toBase64url(response.getPublicKey()!),
      algorithm: getAlgoName(credential.response.getPublicKeyAlgorithm())
    },
    authenticatorData: utils.toBase64url(response.getAuthenticatorData()),
    clientData: utils.toBase64url(response.clientDataJSON)
  }

  if (options.attestation) {
    registration.attestationData = utils.toBase64url(response.attestationObject)
  }

  return registration
}

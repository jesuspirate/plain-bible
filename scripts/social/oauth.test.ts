import { describe, expect, it } from 'vitest'
import { oauthHeader, signature } from './oauth'

// The worked example in X's docs ("Creating a signature").
const keys = {
  consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
}

describe('OAuth 1.0a for X', () => {
  it('signs like the docs example', () => {
    expect(signature('POST', 'https://api.twitter.com/1.1/statuses/update.json', {
      include_entities: 'true', oauth_consumer_key: keys.consumerKey, oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1318622958', oauth_token: keys.token, oauth_version: '1.0',
      status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    }, keys.consumerSecret, keys.tokenSecret)).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
  })

  it('builds the header', () => {
    const h = oauthHeader('POST', 'https://api.twitter.com/1.1/statuses/update.json', keys, 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', 1318622958,
      { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' })
    expect(h).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"')
    expect(h).not.toContain('status=')
    expect(h.startsWith('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"')).toBe(true)
  })
})

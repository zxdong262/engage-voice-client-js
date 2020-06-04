import axios from 'axios'
import { SDK } from '@ringcentral/sdk'
import URI from 'urijs'
import EventEmitter from 'events'

const version = process.env.version

const SERVER = 'https://engage.ringcentral.com'
const LEGACY_SERVERS = [
  'https://portal.vacd.biz',
  'https://portal.virtualacd.biz'
]
const RINGCENTRAL_SERVER = 'https://platform.ringcentral.com'

export class HTTPError extends Error {
  constructor (status, statusText, data, config) {
    super(`status: ${status}
statusText: ${statusText}
data: ${JSON.stringify(data, null, 2)}
config: ${JSON.stringify(config, null, 2)}`)
    this.status = status
    this.statusText = statusText
    this.data = data
    this.config = config
  }
}

class RingCentralEngageVoice extends EventEmitter {
  constructor ({
    clientId,
    clientSecret,
    server = SERVER,
    rcServer = RINGCENTRAL_SERVER,
    apiPrefix = 'voice'
  }) {
    super(clientId, clientSecret, server)
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.server = server
    this.rcServer = rcServer
    this.apiPrefix = apiPrefix
    this.isLegacy = this.isLegacyServer(server)
    this.rc = new SDK({
      server: rcServer,
      clientId,
      clientSecret
    })
    this._axios = axios.create()
    const request = this._axios.request.bind(this._axios)
    this._axios.request = async config => {
      try {
        return await request(config)
      } catch (e) {
        if (e.response) {
          throw new HTTPError(e.response.status, e.response.statusText, e.response.data, e.response.config)
        } else {
          throw e
        }
      }
    }
  }

  parseUrl (uri, path) {
    const u = URI(uri)
    const pathJoined = URI.joinPaths(u, path)
    return u.path(pathJoined)
  }

  token (_token) {
    if (arguments.length === 0) {
      return this._token
    }
    const tokenChanged = this._token !== _token
    this._token = _token
    if (tokenChanged) {
      this.emit('tokenChanged', _token)
    }
  }

  refresh () {
    return this.getToken(
      this._token.refreshToken
    )
  }

  isLegacyServer (server) {
    return RingCentralEngageVoice.LEGACY_SERVERS.includes(server)
  }

  request (config) {
    let uri = URI(config.url)
    if (uri.hostname() === '') {
      const { url = '' } = config
      const prefix = url.startsWith(this.apiPrefix) || url.startsWith('/' + this.apiPrefix)
        ? ''
        : this.apiPrefix
      const path = URI.joinPaths(prefix, url)
      uri = this.parseUrl(this.server, path)
    }
    return this._axios.request({
      ...config,
      url: uri.toString(),
      headers: this._patchHeaders(config.headers)
    })
  }

  async authorize (...args) {
    if (this.isLegacy) {
      await this.legacyAuthorize(...args)
    } else {
      await this.rc.login(...args)
      await this.getToken()
    }
  }

  async legacyAuthorize (...args) {
    await this.getLegacyToken(...args)
  }

  async getLegacyToken ({
    username,
    password
  }) {
    const url = this.server + '/api/v1/auth/login'
    const body = `username=${username}&password=${password}`
    const res = await this._axios.request({
      method: 'post',
      url,
      data: body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    const r = res.data
    const url1 = this.server + '/api/v1/admin/token'
    const res1 = await this._axios.request({
      method: 'post',
      url: url1,
      headers: {
        'X-Auth-Token': r.authToken || ''
      }
    })

    const r1 = res1.data
    this.token({
      ...r,
      apiToken: r1
    })
  }

  revokeLegacyToken () {
    if (this._token) {
      this.delete(`/api/v1/admin/token/${this._token.apiToken}
    X`)
    }
  }

  async getToken (refreshToken) {
    const url = this.server + '/api/auth/login/rc/accesstoken?includeRefresh=true'
    let token = refreshToken
    if (!token) {
      token = await this.rc.platform().auth().data() || {}
      token = token.access_token || ''
    }
    const body = refreshToken
      ? 'refreshToken=' + token + '&rcTokenType=Bearer'
      : 'rcAccessToken=' + token + '&rcTokenType=Bearer'
    const res = await this._axios.request({
      method: 'post',
      url,
      data: body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    const r = res.data
    this.token(r)
  }

  _patchHeaders (headers) {
    const userAgentHeader = `ringcentral-engage-voice-js/v${version}`
    const authHeaders = this.isLegacy
      ? this._legacyHeader()
      : this._bearerAuthorizationHeader()
    return {
      ...authHeaders,
      'X-User-Agent': userAgentHeader,
      'RC-User-Agent': userAgentHeader,
      ...headers
    }
  }

  _bearerAuthorizationHeader () {
    let accessToken = ''
    if (this._token) {
      accessToken = this._token.accessToken
    }
    return { Authorization: `Bearer ${accessToken}` }
  }

  _legacyHeader () {
    let accessToken = ''
    if (this._token) {
      accessToken = this._token.apiToken
    }
    return {
      'X-Auth-Token': accessToken
    }
  }

  get (url, config = {}) {
    return this.request({ ...config, method: 'get', url })
  }

  delete (url, config = {}) {
    return this.request({ ...config, method: 'delete', url })
  }

  post (url, data = undefined, config = {}) {
    return this.request({ ...config, method: 'post', url, data })
  }

  put (url, data = undefined, config = {}) {
    return this.request({ ...config, method: 'put', url, data })
  }

  patch (url, data = undefined, config = {}) {
    return this.request({ ...config, method: 'patch', url, data })
  }
}

RingCentralEngageVoice.LEGACY_SERVERS = LEGACY_SERVERS
RingCentralEngageVoice.SERVER = SERVER

export default RingCentralEngageVoice

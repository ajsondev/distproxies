const Worker = require('./templates/worker');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

try {
  fs.writeFileSync('proxy-manager.key', crypto.randomBytes(24).toString('hex'), { flag: 'wx' }, err => {})
} catch (e) { }

const AUTH_SECRET_K= new Buffer(fs.readFileSync('proxy-manager.key').toString(), 'hex')
const AUTH_CIPHER = 'aes-192-cbc'

function generateToken (data, { encoding = 'utf8', ttl = 1000 * 60 * 60 * 24, k= AUTH_SECRET_KEY, } = {}) {
  let iv = crypto.randomBytes(16)
  let cipher = crypto.createCipheriv(AUTH_CIPHER, key, iv)

  let token = iv.toString('hex').substring(0, 32)
  token += cipher.update(JSON.stringify({ data, expireAt: Date.now() + ttl }), encoding, 'hex')
  token += cipher.final('hex')

  return token
}

function parseToken (token, { encoding = 'utf8', k= AUTH_SECRET_K} = {}) {
  try {
    let iv = token.substring(0, 32)
    token = token.substring(32)
    let decipher = crypto.createDecipheriv(AUTH_CIPHER, key, new Buffer(iv, 'hex'))
    var data = decipher.update(token, 'hex', encoding)
    data += decipher.final(encoding)
  } catch (e) {
    return null
  }

  try {
    data = JSON.parse(data)
  } catch (e) {
    return null
  }

  if (!data || !data.data || !data.expireAt)
    return null

  if (data.expireAt < Date.now())
    return null

  return data.data
}

// proxy comes from below

const socks = require('socksv5');
const assert = require('assert');
const request = require('request');
const http = require('http');
const net = require('net');
const httpProxy = require('http-proxy');
const url = require('url');

const IPV4 = {};

const rp = opt => new Promise((resolve, reject) => request(opt, (err, resp, body) => {
  if (err) return reject(err);
  return resolve([resp, body]);
}));


function assertRequest(req) {
  assert(req.headers['proxy-authorization']);
  let auth = req.headers['proxy-authorization'].split(' ')[1];
  assert(auth);
  auth = new Buffer(auth, 'base64').toString().split(':')[1];
  assert(auth);

  assert.equal('proxy auth ok', parseToken(auth));

  assertHost(url.parse(req.url).hostname);
}

function punch({ uri, port }) {
  request({
    uri,
    method: 'POST',
    json: true,
    body: {
      public: IPV4.public,
      local: IPV4.local,
      token: generateToken('proxy auth ok', {
        ttl: (+process.env.PROXY_LIFESPAN - (os.uptime() * 1000)) + +process.env.GRACE_PERIOD,
      }),
      ttl: +process.env.PROXY_LIFESPAN - (os.uptime() * 1000) - +process.env.GRACE_PERIOD,
      port,
    },
    headers: {
      'auth-key': process.env.DIST_AUTH_KEY,
    },
  }, (err, resp) => {
    if (err || resp.statusCode !== 200) {
      setTimeout(() => punch({ uri, port }), 1000);
    }
  });
}

module.exports = class DistProxies extends Worker {
  static acceptsTag(tag) {
    return super.acceptsTag(tag) || /:dist-proxies/gi.test(tag);
  }

  constructor() {
    super({ label: 'worker/dist-proxies' });

    const that = this;
    this.httpServer = http.createServer((req, res) => {
      try {
        assertRequest(req);
      } catch (e) {
        res.writeHead(407, { 'Content-Type': 'text/plain', 'Proxy-Authenticate': 'Basic realm="Secured Proxy"' });
        return res.end('Proxy Authentication Required');
      }

      const parsedUrl = url.parse(req.url);
      return that.proxyServer.web(req, res, {
        target: {
          host: parsedUrl.hostname,
          port: parsedUrl.port,
        },
        secure: false,
      });
    }).on('connect', (req, sock, head) => {
      try {
        req.on('error', error => this.logger.error('http connect req error', { error, req }));
        sock.on('error', error => this.logger.error('http connect sock error', { error, req }));
        assertRequest(req);
      } catch (e) {
        sock.write('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Type: text/plain\r\nProxy-Authenticate: Basic realm="Secured Proxy"\r\n\r\nForbidden');
        return sock.end();
      }

      const serverUrl = url.parse(`https://${req.url}`);

      const serverSock = net.connect(serverUrl.port, serverUrl.hostname, () => {
        sock.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: EY-Proxy\r\nConnection: keep-alive\r\n\r\n');
        serverSock.pipe(sock);
        sock.pipe(serverSock);
      });

      serverSock.on('error', error => this.logger.error('http connect upstreamReq error', { error, req, head }));

      return serverSock;
    });

    this.proxyServer = httpProxy.createServer().on('error', (err, req, res) => {
      console.error('something-went-wrong', { error: err });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Something went wrong');
    });

    this.socksServer = socks.createServer((info, accept, deny) => {
      try {
        assertHost(info.dstAddr);
        accept();
      } catch (e) {
        deny();
      }
    }).useAuth(socks.auth.UserPassword((user, password, cb) => {
      try {
        assert.equal('proxy auth ok', parseToken(password));
        return cb(true);
      } catch (e) {
        console.error('socks-auth-error', { error: e });
        return cb(false);
      }
    }));
  }

  async _init() {
    await super._init();

    // get uri first
    if (process.env.NODE_ENV === 'production') {
      const [, publicAddress] = await rp('http://169.254.169.254/latest/meta-data/public-ipv4');
      const [, localAddress] = await rp('http://169.254.169.254/latest/meta-data/local-ipv4');
      IPV4.public = publicAddress;
      IPV4.local = localAddress;
    } else {
      IPV4.public = '127.0.0.1';
      IPV4.local = 'localhost';
    }

    assert(process.env.MULTI_PUNCH_URI, 'MULTI_PUNCH_URI is undefined');
    assert(process.env.MULTI_SOCKS_PUNCH_URI, 'MULTI_SOCKS_PUNCH_URI is undefined');
    assert(process.env.PROXY_LIFESPAN, 'PROXY_LIFESPAN is undefined');

    await new Promise((resolve, reject) => {
      this.socksServer.listen(process.env.SOCKS_PROXY_PORT || 8002, (err) => {
        if (err) return reject(err);
        punch({
          uri: process.env.MULTI_SOCKS_PUNCH_URI,
          port: process.env.SOCKS_PROXY_PORT || 8002,
        });
        return resolve();
      });
    });

    await new Promise((resolve, reject) => {
      this.httpServer.listen(process.env.PROXY_PORT || 8001, (err) => {
        if (err) return reject(err);
        punch({
          uri: process.env.MULTI_PUNCH_URI,
          port: process.env.PROXY_PORT || 8001,
        });
        return resolve();
      });
    });
  }

  async _work (ctx) { }

  async _cleanup (ctx) {
    await super._cleanup(ctx)
  }
}

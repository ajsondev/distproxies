#!/usr/bin/env node --harmony

const crypto = require('crypto');
const fs = require('fs');

try {
  fs.writeFileSync('proxy-manager.key', crypto.randomBytes(24).toString('hex'), { flag: 'wx' }, (err) => {});
} catch (e) { }

const AUTH_SECRET_KEY = Buffer.from(fs.readFileSync('proxy-manager.key').toString(), 'hex');
const AUTH_CIPHER = 'aes-192-cbc';

function generateToken(data, { encoding = 'utf8', ttl = 1000 * 60 * 60 * 24, key = AUTH_SECRET_KEY } = {}) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(AUTH_CIPHER, key, iv);

  let token = iv.toString('hex').substring(0, 32);
  token += cipher.update(JSON.stringify({ data, expireAt: Date.now() + ttl }), encoding, 'hex');
  token += cipher.final('hex');

  return token;
}

function parseToken(token, { encoding = 'utf8', key = AUTH_SECRET_KEY } = {}) {
  try {
    const iv = token.substring(0, 32);
    // eslint-disable-next-line no-param-reassign
    token = token.substring(32);
    const decipher = crypto.createDecipheriv(AUTH_CIPHER, key, Buffer.from(iv, 'hex'));
    let data = decipher.update(token, 'hex', encoding);
    data += decipher.final(encoding);
  } catch (e) {
    return null;
  }

  try {
    data = JSON.parse(data);
  } catch (e) {
    return null;
  }

  if (!data || !data.data || !data.expireAt) { return null; }

  if (data.expireAt < Date.now()) { return null; }

  return data.data;
}


// start listening
const PROXY_TTL = isNaN(+process.env.PROXY_TTL) ? 1000 * 60 * 10 : +process.env.PROXY_TTL;

const express = require('express');
const bodyParser = require('body-parser');
const url = require('url');
const request = require('request');
const throat = require('throat');

const rp = opt => new Promise((resolve, reject) => request(opt, (err, resp, body) => {
  if (err) return reject(err);
  return resolve([resp, body]);
}));

const app = express();
app.use(bodyParser.json());

function createRouter(name, proxyTTL = PROXY_TTL) {
  const router = express.Router();
  let proxies = [];
  let socksProxies = [];

  let proxyDump = {};
  try {
    proxyDump = JSON.parse(fs.readFileSync(`pool-dump-${name}.json`));
  } catch (error) {
    proxyDump = {};
  }

  const proxyPoolV2 = proxyDump || {};
  const PROXY_POOL_NAME_HTTP = 'http';
  const PROXY_POOL_NAME_SOCKS = 'socks';

  let dumpRequestedWhileDumping = false;
  let dumping = false;
  function dumpPool() {
    if (dumping) {
      dumpRequestedWhileDumping = true;
      return;
    }
    dumping = true;
    dumpRequestedWhileDumping = false;
    fs.writeFile(`proxy-pool-dump-${name}.json`, JSON.stringify(proxyPoolV2), (error) => {
      if (error) console.error(error.stack);

      dumping = false;
      if (dumpRequestedWhileDumping) {
        process.nextTick(dumpPool);
      }
    });
  }

  async function proxyPoolHealthCheck() {
    const hosts = (proxyPoolV2[PROXY_POOL_NAME_HTTP] || [])
      .filter(p => !!p.local).map(p => url.parse(p.local).hostname);

    let countOK = 0;
    let count = 0;
    await Promise.all(hosts.map(throat(32, async (host) => {
      try {
        const [resp] = await rp({
          uri: `http://${host}`,
          timeout: 3000,
        });
        console.log(resp.statusCode);
        if (!resp) {
          throw new Error('proxy-resp-null');
        }
        if (resp.statusCode !== 407) {
          throw new Error('proxy-status-code-not-407');
        }

        countOK += 1;
        return null;
      } catch (error) {
        count += 1;
        Object.keys(proxyPoolV2).forEach((key) => {
          proxyPoolV2[key] = proxyPoolV2[key].filter(p => !~p.local.indexOf(host));
        });
        dumpPool();
        return host;
      }
    })));
    dumpPool();
    console.log(`trimmed ${count} hosts. ${countOK} hosts remain.`);

    setTimeout(proxyPoolHealthCheck, 60000);
  }
  proxyPoolHealthCheck();
  function sanitizeProxyPool(poolName, preventDump = false) {
    if (!poolName) {
      Object.keys(proxyPoolV2).forEach(n => sanitizeProxyPool(n, true));
      return !preventDump ? dumpPool() : null;
    }

    const length = proxyPoolV2[poolName].length;
    proxyPoolV2[poolName] = proxyPoolV2[poolName].filter(p => p.invalidAfter > Date.now());
    console.log(`${poolName} trimmed from=${length} to=${proxyPoolV2[poolName].length}`);
    return !preventDump ? dumpPool() : null;
  }

  // and because dump loaded up there
  sanitizeProxyPool();
  Object.keys(proxyPoolV2).forEach((poolName) => {
    proxyPoolV2[poolName].forEach((proxy) => {
      setTimeout(() => {
        sanitizeProxyPool(poolName);
      }, (proxy.invalidAfter - Date.now()) + 1000);
    });
  });


  router.get('/proxy', (req, res, next) => {
    let target;

    if (req.query.pool === 'local') {
      console.log('returning local ipv4');
      target = proxies.concat(proxyPoolV2[PROXY_POOL_NAME_HTTP] || [])
        .filter(p => !!p.local);
    } else {
      console.log('returning public proxy');
      target = proxies.concat(proxyPoolV2[PROXY_POOL_NAME_HTTP] || [])
        .filter(p => !!p.uri || !!p.public);
    }

    const proxy = (target[parseInt(Math.random() * target.length, 10)] || {});
    if (req.query.pool === 'local') {
      if (!proxy || !proxy.local) return next();
      console.log(`returning local proxy: ${proxy.local}`);
      return res.send(proxy.local);
    }

    if (!proxy || (!proxy.public && !proxy.uri)) return next();
    return res.send(proxy.public || proxy.uri);
  });

  router.get('/socks-proxy', (req, res, next) => {
    let target;

    if (req.query.pool === 'local') {
      target = socksProxies.concat(proxyPoolV2[PROXY_POOL_NAME_SOCKS] || [])
        .filter(p => !!p.local);
    } else {
      target = socksProxies.concat(proxyPoolV2[PROXY_POOL_NAME_SOCKS] || [])
        .filter(p => !!p.uri || !!p.public);
    }

    const proxy = (target[parseInt(Math.random() * target.length, 10)] || {});
    if (req.query.pool === 'local') {
      if (!proxy || !proxy.local) return next();
      return res.send(proxy.local);
    }

    if (!proxy || (!proxy.public && !proxy.uri)) return next();
    return res.send(proxy.public || proxy.uri);
  });

  function midPunchMachineV2({ generateProxyURI, poolName }) {
    return (req, res) => {
      let ip = req.ip;
      if (ip.substr(0, 7) === '::ffff:') {
        ip = ip.substr(7);
      }

      if (!proxyPoolV2[poolName]) proxyPoolV2[poolName] = [];
      const uriSet = generateProxyURI(ip, req.body);
      proxyPoolV2[poolName].push({
        uri: uriSet.public,
        public: uriSet.public,
        local: uriSet.local,
        invalidAfter: Date.now() + req.body.ttl,
      });
      dumpPool();
      res.sendStatus(200);
    };
  }

  router.post('/punch-v2', midPunchMachineV2({
    generateProxyURI(ip, body) {
      return {
        public: `http://username:${body.token}@${body.public || ip}:${body.port || 8001}`,
        local: `http://username:${body.token}@${body.local || ip}:${body.port || 8001}`,
      };
    },
    poolName: PROXY_POOL_NAME_HTTP,
  }));

  router.post('/socks-punch-v2', midPunchMachineV2({
    generateProxyURI(ip, body) {
      return {
        public: `socks5://username:${body.token}@${body.public || ip}:${body.port || 8001}`,
        local: `socks5://username:${body.token}@${body.local || ip}:${body.port || 8001}`,
      };
    },
    poolName: PROXY_POOL_NAME_SOCKS,
  }));

  router.post('/punch', (req, res) => {
    let ip = req.ip;
    if (ip.substr(0, 7) === '::ffff:') {
      ip = ip.substr(7);
    }

    const proxyAddress = {
      uri: `http://username:${req.body.token}@${ip}:${req.body.port || 8001}`,
      ttl: Date.now() + proxyTTL,
    };
    proxies.push(proxyAddress);

    setTimeout(() => {
      proxies = proxies.filter(p => p.ttl > Date.now());
    }, proxyTTL);

    res.sendStatus(200);
  });

  router.post('/socks-punch', (req, res) => {
    let ip = req.ip;
    if (ip.substr(0, 7) === '::ffff:') {
      ip = ip.substr(7);
    }

    const proxyAddress = {
      uri: `socks5://username:${req.body.token}@${ip}:${req.body.port || 8001}`,
      ttl: Date.now() + proxyTTL,
    };
    socksProxies.push(proxyAddress);

    setTimeout(() => {
      socksProxies = socksProxies.filter(p => p.ttl > Date.now());
    }, proxyTTL);

    res.sendStatus(200);
  });

  return router;
}

const versionZero = createRouter('0', PROXY_TTL);
app.use('/', versionZero);
app.use('/0', versionZero);
app.use('/1', createRouter('1', PROXY_TTL));
app.use('/short/1', createRouter('short_1', PROXY_TTL));

app.listen(process.env.PORT || 8000);

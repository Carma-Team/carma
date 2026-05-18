const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/api/')) {
        const options = {
          hostname: 'localhost',
          port: 3000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: 'localhost:3000' },
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('error', (err) => {
          console.error('[Metro Proxy] Error proxying to local server:', err.message);
          res.writeHead(502);
          res.end('Local server unavailable');
        });

        req.pipe(proxyReq, { end: true });
      } else {
        middleware(req, res, next);
      }
    };
  },
};

module.exports = config;

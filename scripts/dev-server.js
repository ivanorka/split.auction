const { createReadStream, existsSync, statSync } = require('node:fs');
const { createServer } = require('node:http');
const { extname, isAbsolute, join, relative, resolve } = require('node:path');
const { handleApi, securityHeaders, sendJson } = require('./server/api');
const { dbPath, ensureDatabase } = require('./server/database');

const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || process.argv[3] || 5173);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const mimeTypes = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.pdf':'application/pdf',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon'
};

function isInsideRoot(filePath){
  const diff = relative(root, filePath);
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff));
}

function sendText(res, status, body){
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type':'text/plain; charset=utf-8',
    'cache-control':'no-store'
  });
  res.end(body);
}

function serveStatic(req, res, url){
  if(req.method !== 'GET' && req.method !== 'HEAD'){
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const blockedPrefixes = ['/data', '/scripts', '/node_modules', '/.git'];
  if(blockedPrefixes.some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))){
    sendText(res, 404, 'Not found');
    return;
  }

  let filePath;
  try{ filePath = resolve(root, `.${decodeURIComponent(url.pathname)}`); }
  catch{
    sendText(res, 400, 'Bad request');
    return;
  }

  if(!isInsideRoot(filePath)){
    sendText(res, 403, 'Forbidden');
    return;
  }
  if(!existsSync(filePath)){
    sendText(res, 404, 'Not found');
    return;
  }
  if(statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
  if(!existsSync(filePath)){
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    ...securityHeaders(),
    'content-type':mimeTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control':'no-store'
  });
  if(req.method === 'HEAD'){
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try{
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    if(await handleApi(req, res, url)) return;
    serveStatic(req, res, url);
  }catch(error){
    console.error(error);
    if(!res.headersSent) sendJson(res, 500, { error:'Neočekivana greška demo servera.' });
    else res.end();
  }
});

ensureDatabase()
  .then(() => {
    server.listen(port, host, () => {
      console.log(`Auction Split (auction.split) running at http://${host}:${port}`);
      console.log(`Serving ${root}`);
      console.log(`Authenticated demo database ${dbPath}`);
    });
  })
  .catch(error => {
    console.error('Auction Split database initialization failed:', error);
    process.exit(1);
  });

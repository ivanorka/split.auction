const { createServer } = require('node:http');
const serverless = require('serverless-http');
const { handleApi, securityHeaders, sendJson } = require('../../scripts/server/api');

function requestUrl(req){
  const host = req.headers.host || 'auction.split';
  const url = new URL(req.url || '/api/health', `https://${host}`);
  if(url.pathname.startsWith('/.netlify/functions/api')){
    const suffix = url.pathname.slice('/.netlify/functions/api'.length);
    url.pathname = `/api${suffix || '/health'}`;
  }
  return url;
}

const server = createServer(async (req, res) => {
  try{
    const handled = await handleApi(req, res, requestUrl(req));
    if(!handled) sendJson(res, 404, { error:'API ruta nije pronađena.' });
  }catch(error){
    console.error('Auction Split API error:', error);
    if(!res.headersSent){
      res.writeHead(500, {
        ...securityHeaders(),
        'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store'
      });
      res.end(JSON.stringify({ error:'Poslužitelj trenutačno nije dostupan.' }));
    }else{
      res.end();
    }
  }
});

module.exports.handler = serverless(server);

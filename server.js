import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.static('.'));

function makeHeaders(){
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.nseindia.com',
    'Connection': 'keep-alive'
  };
}

async function fetchNse(url, opts={}){
  const base = 'https://www.nseindia.com';
  try{
    const r1 = await fetch(base, { headers: makeHeaders(), redirect: 'manual' });
    const cookies = r1.headers.get('set-cookie') || '';
    console.log('Initial NSE request status', r1.status);
    const headers = Object.assign({}, makeHeaders(), { 'Cookie': cookies, 'Accept': 'application/json, text/plain, */*' });
    const r2 = await fetch(url, { headers, timeout: 10000 });
    console.log('API request status', r2.status, 'for', url);
    const text = await r2.text();
    try{
      return JSON.parse(text);
    }catch(e){
      console.log('JSON parse failed, returning text snippet');
      return { error: 'invalid_json', text: text.slice(0,200) };
    }
  }catch(err){
    console.error('fetchNse error', err && err.message);
    throw err;
  }
}

async function getPremium(strike, type='CE'){
  const api = 'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY';
  const data = await fetchNse(api);
  if(data && data.filtered && data.filtered.data){
    for(const row of data.filtered.data){
      if(Number(row.strikePrice) === Number(strike)){
        const val = (type === 'CE' ? row.CE : row.PE);
        if(val) return val.lastPrice || val.askPrice || val.bidPrice || 0;
      }
    }
  }
  return 0;
}

app.get('/fetch-premiums', async (req, res) => {
  const call = req.query.call; const put = req.query.put;
  console.log('/fetch-premiums called with', call, put);
  if(!call || !put) return res.status(400).json({ error: 'missing strikes' });
  try{
    const callP = await getPremium(call, 'CE');
    const putP = await getPremium(put, 'PE');
    console.log('Fetched premiums', { callP, putP });
    return res.json({ callPremium: callP, putPremium: putP });
  }catch(err){
    console.error('Error fetching premiums', err && err.message);
    return res.status(500).json({ error: 'fetch_failed', message: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log('Server running on http://localhost:' + port));

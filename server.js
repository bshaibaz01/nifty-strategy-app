// server.js
// Node >= 18 recommended. If using older Node, ensure node-fetch installed.
// npm install express node-fetch

import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.static(__dirname));

let cachedChain = null;
let cachedAt = 0;
const CACHE_TTL_MS = 9 * 1000; // refresh under 10s

function formatExpiry(exp) {
  if (!exp || exp.length !== 8) return null;
  const y = exp.substring(0, 4), m = exp.substring(4, 6), d = exp.substring(6, 8);
  const months = { "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec" };
  return `${d}-${months[m]}-${y}`;
}

async function fetchOptionChainFromNSE() {
  try {
    const base = "https://www.nseindia.com";
    // first request to get cookies/headers
    await fetch(base, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.nseindia.com",
        "Connection": "keep-alive"
      },
      redirect: "manual"
    });

    const apiUrl = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
    const r2 = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.nseindia.com/get-quotes/derivatives",
        "Connection": "keep-alive"
      }
    });

    const text = await r2.text();

    try {
      return JSON.parse(text.trim());
    } catch (err) {
      console.error("NSE parse error, snippet:", text.slice(0, 400));
      throw err;
    }
  } catch (err) {
    console.error("fetchOptionChainFromNSE error:", err && err.message ? err.message : err);
    throw err;
  }
}

async function ensureCachedChain() {
  const now = Date.now();
  if (cachedChain && (now - cachedAt) < CACHE_TTL_MS) return cachedChain;
  try {
    const chain = await fetchOptionChainFromNSE();
    cachedChain = chain;
    cachedAt = Date.now();
    console.log("Fetched chain from NSE at", new Date(cachedAt).toLocaleTimeString());
    return cachedChain;
  } catch (err) {
    console.warn("Failed to refresh chain; using stale if available.");
    if (cachedChain) return cachedChain;
    throw err;
  }
}

setInterval(async () => {
  try { await ensureCachedChain(); } catch(e) { /* logged above */ }
}, 10 * 1000);

// find last price by strike & type; optional expiry (formatted like '27-Nov-2025')
function findLastPrice(chain, strike, type, formattedExpiry) {
  const arr = (chain?.filtered?.data) || (chain?.records?.data) || [];
  for (const row of arr) {
    const rowExpiry = row.expiryDate || row.expiry || (row.CE && row.CE.expiryDate) || (row.PE && row.PE.expiryDate) || null;
    if (formattedExpiry && rowExpiry && String(rowExpiry).trim() !== String(formattedExpiry).trim()) continue;
    const strikePrice = Number(row.strikePrice ?? row.strike_price ?? row.strike);
    if (strikePrice === Number(strike)) {
      const opt = (type === "CE") ? (row.CE || row.call) : (row.PE || row.put);
      const lp = opt?.lastPrice ?? opt?.last_traded_price ?? opt?.last_price ?? opt?.ltp;
      return (typeof lp === "number") ? lp : (lp ? Number(lp) : 0);
    }
  }
  // fallback: find ignoring expiry
  for (const row of arr) {
    const strikePrice = Number(row.strikePrice ?? row.strike_price ?? row.strike);
    if (strikePrice === Number(strike)) {
      const opt = (type === "CE") ? (row.CE || row.call) : (row.PE || row.put);
      const lp = opt?.lastPrice ?? opt?.last_traded_price ?? opt?.last_price ?? opt?.ltp;
      return (typeof lp === "number") ? lp : (lp ? Number(lp) : 0);
    }
  }
  return 0;
}

// /fetch-live?sellCall=26500&sellPut=25900&hedgeCall=27500&hedgePut=24900&expiry=20250227
app.get("/fetch-live", async (req, res) => {
  try {
    const { sellCall, sellPut, hedgeCall, hedgePut, expiry } = req.query;
    if (!sellCall || !sellPut) return res.status(400).json({ error: "sellCall and sellPut required" });

    const formattedExpiry = expiry ? formatExpiry(expiry) : null;
    const chain = await ensureCachedChain();
    if (!chain) return res.status(500).json({ error: "No chain available" });

    const sc = findLastPrice(chain, sellCall, "CE", formattedExpiry);
    const sp = findLastPrice(chain, sellPut, "PE", formattedExpiry);
    const hc = hedgeCall ? findLastPrice(chain, hedgeCall, "CE", formattedExpiry) : 0;
    const hp = hedgePut ? findLastPrice(chain, hedgePut, "PE", formattedExpiry) : 0;

    return res.json({
      sellCallPremium: sc,
      sellPutPremium: sp,
      hedgeCallPremium: hc,
      hedgePutPremium: hp,
      expiry: formattedExpiry || "any"
    });
  } catch (err) {
    console.error("fetch-live error:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Failed to fetch live premiums" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running → http://localhost:${PORT}`));

const { Config, QuoteContext } = require('longport');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function uniqueSymbols(raw) {
  return Array.from(new Set(
    String(raw || '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  ));
}

function toLongbridgeSymbol(symbol) {
  if (/^\d{5}\.HK$/.test(symbol)) {
    const digits = String(Number(symbol.slice(0, 5)));
    return `${digits}.HK`;
  }
  if (/^\d{6}\.(SH|SZ)$/.test(symbol)) {
    return symbol;
  }
  if (/^[A-Z][A-Z0-9.-]*$/.test(symbol)) {
    return `${symbol}.US`;
  }
  return symbol;
}

function fromLongbridgeSymbol(symbol) {
  const value = String(symbol || '').toUpperCase();
  if (/^\d+\.HK$/.test(value)) {
    const [digits] = value.split('.');
    return `${digits.padStart(5, '0')}.HK`;
  }
  if (/^[A-Z][A-Z0-9.-]*\.US$/.test(value)) {
    return value.replace(/\.US$/, '');
  }
  return value;
}

function readAny(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchFxRates() {
  const response = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD');
  if (!response.ok) {
    throw new Error(`Frankfurter failed: ${response.status}`);
  }
  const payload = await response.json();
  const usd = toNumber(payload?.rates?.USD);
  const hkd = toNumber(payload?.rates?.HKD);
  return {
    CNY: 1,
    USD: usd ? Number((1 / usd).toFixed(4)) : null,
    HKD: hkd ? Number((1 / hkd).toFixed(4)) : null,
    asOf: payload?.date || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    };
  }

  const symbols = uniqueSymbols(event.queryStringParameters?.symbols);
  if (!symbols.length) {
    return json(400, { ok: false, error: 'Missing symbols' });
  }

  if (!process.env.LONGPORT_APP_KEY || !process.env.LONGPORT_APP_SECRET || !process.env.LONGPORT_ACCESS_TOKEN) {
    return json(503, { ok: false, configured: false, error: 'Longbridge credentials are missing' });
  }

  try {
    const requestedPairs = symbols.map((symbol) => ({
      input: symbol,
      provider: toLongbridgeSymbol(symbol)
    }));

    const config = Config.fromEnv();
    const quoteContext = await QuoteContext.new(config);
    const quotes = await quoteContext.quote(requestedPairs.map((item) => item.provider));
    const rates = await fetchFxRates();

    const normalizedQuotes = {};
    requestedPairs.forEach((pair) => {
      const rawQuote = quotes.find((item) => fromLongbridgeSymbol(readAny(item, ['symbol']) || '') === pair.input);
      if (!rawQuote) {
        return;
      }
      const providerSymbol = readAny(rawQuote, ['symbol']);
      const mappedSymbol = fromLongbridgeSymbol(providerSymbol || pair.provider);
      normalizedQuotes[mappedSymbol] = {
        symbol: mappedSymbol,
        providerSymbol,
        price: toNumber(readAny(rawQuote, ['last_done', 'lastDone', 'last_price', 'lastPrice', 'price'])) || 0,
        name: readAny(rawQuote, ['name_cn', 'nameCn', 'name_en', 'nameEn', 'name']) || mappedSymbol,
        timestamp: readAny(rawQuote, ['timestamp']) || null,
        market: readAny(rawQuote, ['trade_session', 'tradeSession']) || null
      };
    });

    return json(200, {
      ok: true,
      configured: true,
      provider: {
        quote: 'longbridge',
        fx: 'frankfurter'
      },
      rates,
      quotes: normalizedQuotes
    });
  } catch (error) {
    return json(500, {
      ok: false,
      configured: true,
      error: error.message || 'Unknown error'
    });
  }
};
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const ROOT = new URL(".", import.meta.url).pathname;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

const sources = [
  {
    id: "cointelegraph",
    name: "Cointelegraph",
    home: "https://cointelegraph.com/",
    feeds: ["https://cointelegraph.com/rss"]
  },
  {
    id: "decrypt",
    name: "Decrypt",
    home: "https://decrypt.co/",
    feeds: ["https://decrypt.co/feed"]
  },
  {
    id: "coindesk",
    name: "CoinDesk",
    home: "https://www.coindesk.com/",
    feeds: [
      "https://www.coindesk.com/arc/outboundfeeds/rss/",
      "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml"
    ]
  },
  {
    id: "theblock",
    name: "The Block",
    home: "https://www.theblock.co/",
    feeds: ["https://www.theblock.co/rss.xml", "https://www.theblock.co/rss"]
  }
];

const categoryRules = [
  ["hacks", "Hacks", /hack|exploit|stolen|drain|breach|attack|security incident|vulnerab|compromis|private key|wallet drain/i],
  ["scam", "Scam", /scam|fraud|phish|rug pull|ponzi|fake|impersonat|launder|pig butcher|romance scam|illicit/i],
  ["crypto-etf", "Crypto ETF", /\b(etf|exchange-traded fund|spot fund|s-1|19b-4)\b/i],
  ["bitcoin-mining", "Bitcoin Mining", /bitcoin mining|btc mining|mining rig|hashrate|hash rate|miner|miners|mining company|mining difficulty/i],
  ["prediction-markets", "Prediction markets", /prediction market|polymarket|kalshi|predictit|betting market|event contract|forecast market/i],
  ["stablecoins", "Stablecoins", /stablecoin|usdt|usdc|dai|tether|circle|paxos|paypal usd|pyusd|fdusd|frax/i],
  ["cex", "CEX", /centralized exchange|\bcex\b|binance|coinbase|kraken|okx|bybit|bitget|kucoin|gate\.io|mexc|upbit|bithumb/i],
  ["dex", "DEX", /decentralized exchange|\bdex\b|uniswap|curve|pancakeswap|raydium|orca|sushiswap|balancer|trader joe/i],
  ["ethereum", "Ethereum", /ethereum|ether|\beth\b|erc-20|erc20|vitalik|mainnet|validator|validators|gas fee|staking rewards/i],
  ["defi", "DeFi", /\bdefi\b|dao|lending|staking|yield|liquidity|aave|compound|makerdao|maker|restaking|eigenlayer|liquid staking/i],
  ["regulation", "Regulation", /sec|cftc|regulat|court|lawsuit|bill|senate|treasury|ofac|sanction|license|policy|cbdc|lawmakers?|compliance|enforcement|settlement|fine/i],
  ["crypto-companies", "Crypto Companies", /crypto company|crypto firm|startup|raises|funding round|acquisition|merger|partnership|rebrand|layoffs?|ceo|founder|launches|company said/i],
  ["trading", "Trading", /trading|trader|price|market|rally|drop|fell|surge|liquidat|volume|open interest|futures|options|technical analysis|support|resistance/i],
  ["bitcoin", "Bitcoin", /bitcoin|\bbtc\b|satoshi|lightning network|ordinals|runes/i],
  ["altcoins", "Altcoins", /solana|\bsol\b|xrp|ripple|cardano|\bada\b|dogecoin|doge|toncoin|\bton\b|bnb|avalanche|avax|polygon|matic|chainlink|link|litecoin|ltc|shiba|pepe|aptos|sui|near|polkadot|dot|cosmos|atom|tron|trx/i]
];

const headlineBannedPattern = /key figure|what we know|here’s|here's|everything to know|you need to know|explained|could mean|may mean|question mark/i;
const leadBannedPattern = /sign up|subscribe|newsletter|advertisement|read more|related:|this article|in this article|click here/i;
const MIN_HEADLINE_CHARS = 30;
const MAX_HEADLINE_CHARS = 115;
const MAX_HEADLINE_CORE_CHARS = 64;
const TARGET_MIN_LEAD_WORDS = 35;
const MIN_LEAD_WORDS = 20;
const MAX_LEAD_WORDS = 90;

const editorialParameters = {
  task: "Prepare headline and lead options from the source material for a news writer. Do not publish a finished article; give the writer strong editorial options to choose from.",
  general: [
    "Use only facts found in the source title, description, and body.",
    "Do not invent figures, judgments, causes, consequences, or participants.",
    "If a fact is disputed or evaluative, attribute it to the analyst, company, regulator, or source that made the claim.",
    "Do not copy the source headline verbatim.",
    "Do not make headlines or leads generic when a specific fact is available."
  ],
  headlines: [
    "Generate three headline options.",
    "Each headline must be a complete, publishable sentence or phrase.",
    "Each headline must contain the main fact: who did what, what it concerns, and why it matters.",
    "Do not end a headline on unfinished constructions such as 'will work on', 'plans to', or 'faces'.",
    "Do not turn a headline into a long lead.",
    "Target headline length is roughly 55-115 characters.",
    "Commas and colons are allowed when they make the headline stronger.",
    "Do not use clickbait, questions, or exclamation marks.",
    "Create three different angles: straight news, competition/market/conflict, and a more expressive but still factual option."
  ],
  leads: [
    "Generate three lead options.",
    "Each lead must be a full paragraph, not a clipped sentence.",
    "Target lead length is roughly 35-90 words.",
    "Each lead must explain the main fact and add context.",
    "Do not repeat the headline in the same words.",
    "Include important figures, fees, dates, companies, tokens, regulators, or quoted analysts when they appear in the source.",
    "A second sentence must develop the first sentence, not read like a random leftover fragment.",
    "Avoid weak lines such as 'developers now want to do away with it' when the subject, action, and reason are unclear.",
    "Do not write a lead without a specific subject; it must always be clear who acted and what happened."
  ],
  finalCheck: [
    "Every headline is complete.",
    "Every headline is shorter than 115 characters.",
    "Every lead is longer than 35 words.",
    "Every lead contains a specific subject.",
    "The second lead is not a random continuation of the first.",
    "All figures and names appear in the source."
  ]
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  res.end(body);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2));
}

function cleanText(value = "") {
  return decodeEntities(String(value))
    .replace(/â|â€œ/g, "“")
    .replace(/â|â€/g, "”")
    .replace(/â|â€™/g, "’")
    .replace(/â|â€˜/g, "‘")
    .replace(/â|â€”/g, "—")
    .replace(/â|â€“/g, "–")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .trim();
}

function decodeEntities(value = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    ndash: "–",
    mdash: "—"
  };
  let decoded = String(value);
  for (let i = 0; i < 3; i += 1) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? cleanText(match[1]) : "";
}

function attrTag(item, name, attr) {
  const match = item.match(new RegExp(`<${name}[^>]*${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseFeed(xml, source) {
  const chunks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return chunks.map((item) => {
    const title = tag(item, "title");
    const link = tag(item, "link") || attrTag(item, "link", "href");
    const publishedRaw = tag(item, "pubDate") || tag(item, "published") || tag(item, "updated") || tag(item, "dc:date");
    const description = tag(item, "description") || tag(item, "summary") || tag(item, "content:encoded");
    const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
    const text = `${title} ${description}`;
    return {
      id: `${source.id}:${link || title}`,
      source: source.name,
      sourceId: source.id,
      title,
      url: normalizeUrl(link, source.home),
      publishedAt: publishedAt?.toISOString?.() || "",
      ageHours: publishedAt ? Math.max(0, Math.round((Date.now() - publishedAt.getTime()) / 3_600_000)) : null,
      category: categorize(text),
      description,
      verifiedText: [title, description].filter(Boolean).join(". ")
    };
  }).filter((item) => item.title && item.url);
}

function normalizeUrl(link, base) {
  try {
    return new URL(link, base).toString();
  } catch {
    return link;
  }
}

function categorize(text) {
  const found = categoryRules.find(([, , rule]) => rule.test(text));
  return found ? { id: found[0], label: found[1] } : { id: "other", label: "Другое" };
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 Crypto News Desk Assistant/1.0",
        "accept": "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNews() {
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const errors = [];
      for (const feed of source.feeds) {
        try {
          const xml = await fetchText(feed);
          return parseFeed(xml, source);
        } catch (error) {
          errors.push(`${feed}: ${error.message}`);
        }
      }
      throw new Error(errors.join("; "));
    })
  );

  const cutoff = Date.now() - TWO_DAYS_MS;
  const errors = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "rejected") {
      errors.push({ source: sources[index].name, error: result.reason.message });
      return [];
    }
    return result.value;
  });

  const fresh = items
    .filter((item) => item.publishedAt && new Date(item.publishedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 80);

  return { items: dedupe(fresh), errors, fetchedAt: new Date().toISOString() };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url.replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractArticle(html, fallback = {}) {
  const title = cleanText(meta(html, "property", "og:title") || meta(html, "name", "twitter:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || fallback.title || "");
  const description = cleanText(meta(html, "name", "description") || meta(html, "property", "og:description") || fallback.description || "");
  const jsonBodies = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => getJsonArticleBody(match[1]))
    .filter(Boolean);
  const bodySource = jsonBodies[0] || html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const paragraphs = [...bodySource.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((text) => text.length > 60 && !/sign up|subscribe|newsletter|advertisement/i.test(text))
    .slice(0, 12);
  const body = paragraphs.length ? paragraphs.join(" ") : cleanText(bodySource).slice(0, 5000);
  return { title, description, body };
}

function meta(html, key, value) {
  const pattern = new RegExp(`<meta[^>]+${key}=["']${value}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${value}["'][^>]*>`, "i");
  const match = html.match(pattern);
  return match?.[1] || match?.[2] || "";
}

function getJsonArticleBody(raw) {
  try {
    const parsed = JSON.parse(cleanText(raw));
    const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
    const article = nodes.find((node) => /Article|NewsArticle|BlogPosting/.test(String(node?.["@type"])));
    return article?.articleBody || "";
  } catch {
    return "";
  }
}

function sentenceSplit(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-ZА-Я0-9"“])|(?<=\.)\s*-\s+(?=[A-ZА-Я])/)
    .map((sentence) => sentence.trim())
    .map(cleanSentence)
    .filter(isUsefulSentence);
}

function extractEvidence(article) {
  const text = [article.title, article.description, article.body].filter(Boolean).join(". ");
  const sentences = sentenceSplit(text).slice(0, 10);
  const figures = [...text.matchAll(/(?:\$|€|£)?\b\d+(?:[.,]\d+)?\s?(?:%|million|billion|trillion|M|B|K|BTC|ETH|days?|hours?|users?|transactions?|tokens?)?/gi)]
    .map((match) => match[0].trim())
    .filter((value) => /\d/.test(value))
    .slice(0, 8);
  const entities = [...text.matchAll(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\b/g)]
    .map((match) => match[0])
    .filter((value) => !/The|This|That|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Image|Getty|Reuters/.test(value))
    .slice(0, 10);
  return { sentences, figures: [...new Set(figures)], entities: [...new Set(entities)] };
}

export function buildDrafts(input) {
  const article = {
    title: cleanText(input.title || ""),
    description: cleanText(input.description || ""),
    body: cleanText(input.body || input.text || "")
  };
  const evidence = extractEvidence(article);
  const category = categorize(`${article.title} ${article.description} ${article.body}`);
  const coreTitle = sanitizeHeadline(article.title);
  const firstSentence = evidence.sentences.find((sentence) => !sameSentence(sentence, coreTitle) && !sameSentence(sanitizeHeadline(sentence), coreTitle)) || article.description || evidence.sentences[0] || coreTitle;
  const firstUsefulSentence = cleanSentence(firstSentence);
  const safeTitle = coreTitle || firstUsefulSentence || "Crypto Market Moves";
  const context = { title: safeTitle, firstSentence: firstUsefulSentence, evidence, category };
  const headlines = makeHeadlines(context);

  const leadBase = normalizeLead(firstUsefulSentence || safeTitle, safeTitle);
  const secondSentence = evidence.sentences.find((sentence) => {
    const normalized = sentence.toLowerCase();
    return !sameSentence(normalized, leadBase)
      && !sameSentence(normalized, safeTitle)
      && !sameSentence(sanitizeHeadline(normalized), safeTitle)
      && !tooSimilar(normalized, leadBase);
  });
  const figureSentence = evidence.sentences.find((sentence) => evidence.figures.some((figure) => sentence.includes(figure)) && !looksLikeTickerStrip(sentence) && !looksLikeByline(sentence));
  const leads = [
    leadBase,
    secondSentence ? `${leadBase} ${secondSentence}` : `${safeTitle}. ${leadBase}`,
    figureSentence || secondSentence || leadBase
  ]
    .map((lead) => normalizeLead(cleanSentence(lead), safeTitle));
  const leadOptions = buildLeadOptions(leads, context)
    .map((lead) => limitLead(lead))
    .filter((lead) => !violatesLeadRules(lead, safeTitle))
    .filter((lead, index, list) => list.findIndex((other) => tooSimilar(lead, other)) === index);

  return {
    headlines,
    leads: ensureUsefulLeads([...new Set(leadOptions)], context),
    evidence: {
      sourceSentences: evidence.sentences.slice(0, 6),
      figures: evidence.figures,
      entities: evidence.entities
    },
    category,
    guardrails: [
      "Все черновики построены из заголовка, описания и текста первоисточника.",
      "Цифры и имена берутся только из извлеченного текста.",
      "Перед публикацией проверьте цитаты и числовые данные по ссылке на первоисточник."
    ]
  };
}

function limitHeadline(value) {
  return trimHeadline(cleanSentence(value));
}

function limitLead(value) {
  return trimLead(cleanText(value));
}

function makeHeadlines(context) {
  const { title, firstSentence, evidence, category } = context;
  const base = sanitizeHeadline(title);
  const editorial = editorialHeadlines(base, firstSentence, evidence, category);
  if (editorial.length >= 3) return ensureThreeHeadlines(editorial, base, context);
  const subject = detectSubject(base, firstSentence, evidence);
  const action = detectAction(base, firstSentence);
  const object = detectObject(base, firstSentence, subject);
  const figure = evidence.figures.find((item) => /[$€£%]|million|billion|trillion/i.test(item)) || evidence.figures[0] || "";
  const categoryNoun = category.id === "regulation" ? "regulatory test"
    : category.id === "hacks" ? "security scare"
    : category.id === "defi" ? "DeFi test"
    : category.id === "crypto-etf" ? "ETF pricing test"
    : category.id === "trading" ? "trading test"
    : `${category.label || "crypto"} test`;
  const candidates = [
    joinHeadline(subject, action, object),
    figure ? joinHeadline(subject, "faces", `${figure} ${categoryNoun}`) : joinHeadline(subject, "puts", `${categoryNoun} in focus`),
    buildWhyItMattersHeadline(subject, category)
  ];
  const fallback = [
    ...sourceSpecificHeadlines(context),
    base,
    sentenceToHeadline(firstSentence),
    `${subject} draws fresh crypto scrutiny`
  ];
  return ensureThreeHeadlines([...candidates, ...fallback], base, context);
}

function editorialHeadlines(title, firstSentence, evidence, category) {
  const text = `${title}. ${firstSentence}. ${evidence.sentences.join(" ")}`;
  if (/toss bank/i.test(text) && /solana/i.test(text) && /proof-of-concept|remittance|payment/i.test(text)) {
    return [
      "South Korea’s Toss Bank Tests Solana Rails for Stablecoin Payments",
      "South Korea’s Toss Bank Taps Solana for Stablecoin Payment Pilot",
      "Solana Trial Brings Toss Bank Into Stablecoin Payments"
    ];
  }
  if (/bitget/i.test(text) && /u\.?s\.?|us|united states/i.test(text) && /stock|shares/i.test(text) && /crypto/i.test(text)) {
    return [
      "Bitget Opens US Stock Purchases to Crypto Users",
      "Bitget Adds Crypto-Funded Access to US Equities",
      "Bitget Expands Stock Trading With Crypto-Funded Purchases"
    ];
  }
  if (/bitcoin|btc/i.test(text) && /\$?64,?000/i.test(text) && /etf|outflow/i.test(text)) {
    return [
      "Bitcoin Stays Near $64,000 as ETF Outflows Hit Sixth Week",
      "Bitcoin Struggles Around $64,000 After Fresh ETF Outflows",
      "ETF Outflows Keep Pressure on Bitcoin Near $64,000"
    ];
  }
  if (/token listing program|listing program/i.test(text) && /developer|review process|requirements/i.test(text)) {
    return [
      "Crypto Exchange Launches Token Listing Program for Developers",
      "Token Listing Program Gives Developers Faster Review Process",
      "Exchange Adds Clearer Requirements for Token Listings"
    ];
  }
  if (/ether|ethereum/i.test(text) && /governance proposal/i.test(text) && /staking rewards|ecosystem funding|validator/i.test(text)) {
    return [
      "Ether Could Fund Ecosystem Projects With Staking Rewards",
      "Ethereum Validators Could Redirect 10% of Staking Rewards",
      "Staking Rewards Could Fund Ethereum Ecosystem Projects"
    ];
  }
  if (/japan/i.test(text) && /pension fund|corporate pension/i.test(text) && /1%|crypto|assets/i.test(text)) {
    return [
      "Japan Pension Fund Planned 1% Crypto Allocation",
      "Japanese Pension Fund Weighed First Crypto Investment",
      "Japan Pension Fund Put Crypto on Its Agenda"
    ];
  }
  if (/\bXRP\b/i.test(text) && /\$1\.?14|support|rebound|buyers/i.test(text)) {
    return [
      "XRP Lost $1.14 Support Before Rebound",
      "XRP Buyers Drove Sharp Price Recovery",
      "XRP Recovered After Heavy Weekend Selling"
    ];
  }
  if (/morgan stanley/i.test(text) && /eth|ether|sol|solana|etf|filing|fees/i.test(text)) {
    return [
      "Morgan Stanley Amends Ethereum and Solana ETF Filings With Record-Low Fees",
      "Morgan Stanley Pressures ETF Rivals With Rock-Bottom Ether and Solana Fees",
      "Fee War Escalates as Morgan Stanley Slashes ETH and SOL ETF Costs"
    ];
  }
  if (/polymarket/i.test(text) && /fake|staged|dummy|winning bets/i.test(text)) {
    return [
      "Polymarket Paid Creators to Fake Winning Bets, WSJ Says",
      "$1.9 Million Campaign Puts Polymarket Under Scrutiny",
      "Polymarket Faces Questions Over Staged Betting Sites"
    ];
  }
  if (/mercury 2/i.test(text) && /diffusiongemma|google/i.test(text)) {
    return [
      "Inception Labs Says Mercury 2 AI Beats Google Model",
      "Mercury 2 AI Challenges Google’s DiffusionGemma",
      "AI Startup Claims Edge Over Google in Diffusion Models"
    ];
  }
  if (/chatbot|artificial intelligence|AI/i.test(text) && /delusion|delusional|amplification spiral/i.test(text)) {
    return [
      "Study Links AI Chatbot Behavior to User Delusions",
      "AI Personalization May Reinforce False Beliefs, Researchers Warn",
      "Chatbot Design Faces Scrutiny Over Mental Health Risks"
    ];
  }
  if (/bitcoin|btc/i.test(text) && /binance|spot trader|selling|price/i.test(text)) {
    return [
      "Bitcoin Traders Face Fresh Pressure From Binance Selling",
      "Bitcoin Price Moves Raise New Concerns for Crypto Bulls",
      "Geopolitical Risk Adds to Bitcoin’s Market Stress"
    ];
  }
  if (category.id === "hacks" && /hack|exploit|stolen|drain/i.test(text)) {
    const subject = detectSubject(title, firstSentence, evidence);
    return [
      `${subject} Faces New Crypto Security Test`,
      `${subject} Exploit Puts User Funds in Focus`,
      `Crypto Security Concerns Grow After ${subject} Incident`
    ];
  }
  return [];
}

function ensureThreeHeadlines(candidates, originalTitle, context = null) {
  const cleaned = [];
  for (const candidate of candidates) {
    const headline = limitHeadline(sanitizeHeadline(candidate));
    if (violatesHeadlineRules(headline, originalTitle)) continue;
    if (cleaned.some((item) => sameSentence(item, headline))) continue;
    cleaned.push(headline);
    if (cleaned.length === 3) break;
  }

  if (context && cleaned.length < 3) {
    for (const candidate of buildSpecificFallbackHeadlines(context)) {
      const headline = limitHeadline(sanitizeHeadline(candidate));
      if (violatesHeadlineRules(headline, originalTitle, { allowSourceTitle: true })) continue;
      if (cleaned.some((item) => tooSimilar(item, headline))) continue;
      cleaned.push(headline);
      if (cleaned.length === 3) break;
    }
  }

  while (cleaned.length < 3) {
    const fallback = buildLastResortHeadline(originalTitle, cleaned.length);
    if (!cleaned.includes(fallback)) cleaned.push(fallback);
  }
  return cleaned;
}

function buildSpecificFallbackHeadlines(context) {
  const subject = detectSubject(context.title, context.firstSentence, context.evidence);
  const sourceTitle = sanitizeHeadline(context.title);
  const sourceSentence = sentenceToHeadline(context.firstSentence);
  const core = trimHeadlineCore(sourceSentence || sourceTitle);
  const figure = context.evidence.figures[0] || "";
  return [
    rewriteSourceHeadline(sourceTitle),
    sourceSentence && !sameSentence(sourceSentence, sourceTitle) ? rewriteSourceHeadline(sourceSentence) : "",
    core ? `${subject} Puts ${core.replace(new RegExp(`^${escapeRegExp(subject)}\\s+`, "i"), "")} in Focus` : "",
    figure ? `${subject} Draws Attention With ${figure} Detail` : "",
    `${subject} Gives Crypto Readers a New Development to Watch`
  ].filter(Boolean);
}

function rewriteSourceHeadline(headline) {
  return sanitizeHeadline(headline)
    .replace(/^Live updates?\s+/i, "")
    .replace(/\bis stuck\b/i, "stays")
    .replace(/\benables\b/i, "opens")
    .replace(/\bto test\b/i, "tests")
    .replace(/\bto reveal\b/i, "revealing")
    .replace(/\bcould fund soon projects\b/i, "could fund ecosystem projects")
    .trim();
}

function buildLastResortHeadline(originalTitle, index) {
  const title = rewriteSourceHeadline(originalTitle);
  const shortTitle = trimHeadline(title);
  if (index === 0 && shortTitle) return shortTitle;
  if (index === 1 && shortTitle) return `${detectTitleSubject(shortTitle)} Adds New Detail to Crypto Story`;
  return `${detectTitleSubject(shortTitle || originalTitle)} Moves Into Focus After Source Update`;
}

function detectTitleSubject(title) {
  const match = cleanText(title).match(/^([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/);
  return match?.[1] || "Crypto Story";
}

function sourceSpecificHeadlines(context) {
  const text = `${context.title}. ${context.firstSentence}. ${context.evidence.sentences.join(" ")}`;
  const title = sanitizeHeadline(context.title);
  const sentence = sentenceToHeadline(context.firstSentence);
  const options = [];
  if (title) options.push(title);
  if (sentence && !sameSentence(sentence, title)) options.push(sentence);
  if (/solana/i.test(text) && /payment|remittance|stablecoin/i.test(text)) {
    options.push("Solana Payment Trial Puts Stablecoin Transfers in Focus");
  }
  if (/stock|shares/i.test(text) && /crypto/i.test(text)) {
    options.push("Crypto Users Get New Route Into US Stock Trading");
  }
  if (/bitcoin|btc/i.test(text) && /etf|outflow/i.test(text)) {
    options.push("Bitcoin Faces ETF Outflow Pressure Near Key Price Level");
  }
  return options;
}

function ensureUsefulLeads(leads, context) {
  const useful = [];
  for (const lead of leads.filter((item) => !violatesLeadRules(item, context.title))) {
    if (!useful.some((item) => tooSimilar(item, lead))) useful.push(lead);
  }
  const facts = context.evidence.sentences
    .filter((sentence) => !sameSentence(sentence, context.title))
    .filter((sentence) => !useful.some((lead) => tooSimilar(lead, sentence)))
    .slice(0, 3);
  for (const fact of facts) {
    if (useful.length >= 3) break;
    const lead = composeLead(fact, context, useful);
    if (!violatesLeadRules(lead, context.title) && !useful.some((item) => tooSimilar(item, lead))) useful.push(lead);
  }
  while (useful.length < 3) {
    const fallback = buildFallbackLead(context, useful);
    if (!violatesLeadRules(fallback, context.title) && !useful.some((lead) => tooSimilar(lead, fallback))) {
      useful.push(fallback);
    } else {
      const relaxed = buildRelaxedLead(context, useful.length);
      if (relaxed && !useful.some((lead) => sameSentence(lead, relaxed))) useful.push(relaxed);
      else break;
    }
  }
  return useful.slice(0, 3);
}

function buildLeadOptions(rawLeads, context) {
  const options = rawLeads.map((lead) => composeLead(lead, context));
  const morganLeadOptions = editorialLeads(context);
  return [...morganLeadOptions, ...options];
}

function composeLead(seed, context, existingLeads = []) {
  const sentences = [];
  const cleanSeed = cleanSentence(seed);
  if (cleanSeed) sentences.push(cleanSeed);
  for (const fact of context.evidence.sentences) {
    if (wordCount(sentences.join(" ")) >= TARGET_MIN_LEAD_WORDS) break;
    if (sameSentence(fact, context.title)) continue;
    if (sentences.some((sentence) => tooSimilar(sentence, fact))) continue;
    if (existingLeads.some((lead) => tooSimilar(lead, fact))) continue;
    if (!isUsefulSentence(fact)) continue;
    sentences.push(cleanSentence(fact));
  }
  return limitLead(sentences.join(" "));
}

function editorialLeads(context) {
  const text = `${context.title}. ${context.firstSentence}. ${context.evidence.sentences.join(" ")}`;
  const fee = extractFirst(text, /\b\d+(?:\.\d+)?%/);
  if (/ether|ethereum/i.test(text) && /governance proposal/i.test(text) && /staking rewards|ecosystem funding|validator/i.test(text)) {
    return [
      "A new Ethereum governance proposal would let validators redirect part of their staking income toward ecosystem funding. The plan turns staking rewards into a potential funding source for projects, while raising questions about incentives and who decides where the money goes.",
      "Ethereum validators could be asked to help fund ecosystem projects through a proposed change to staking rewards. The source frames the idea as a coordination challenge, centered on how much income validators should redirect and who gets to make that decision.",
      "The proposal would connect Ethereum staking rewards more directly to ecosystem funding. If adopted, validators could direct part of their income toward projects, making governance, incentives and control over funding decisions central issues in the debate."
    ];
  }
  const hasMorganEtfFees = /morgan stanley/i.test(text)
    && /eth|ether|ethereum/i.test(text)
    && /sol|solana/i.test(text)
    && /etf|exchange-traded fund/i.test(text)
    && /fee|fees|cost|costs/i.test(text);
  if (!hasMorganEtfFees) return [];

  const feePhrase = fee ? `a ${fee} fee` : "record-low fees";
  const analyst = /balchunas/i.test(text) ? "Bloomberg ETF analyst Eric Balchunas" : "an analyst cited in the source";
  const regulator = /\bSEC\b|S-1/i.test(text) ? "in amended filings with the SEC" : "in amended regulatory filings";
  return [
    `Morgan Stanley amended its Ether and Solana ETF filings to disclose ${feePhrase} for the planned products. The move positions the Wall Street firm as an aggressive price competitor in the crypto ETF market, according to details cited in the source.`,
    `${analyst} said Morgan Stanley's newly disclosed fee structure would rank among the cheapest crypto ETF offerings. The update came ${regulator}, putting pricing at the center of the firm's push into Ether and Solana funds.`,
    `Morgan Stanley is using price as a way to stand out in the race for spot crypto ETFs. Its latest filings show lower fees for both Ether and Solana products, adding pressure on rival issuers competing for investors in the same market.`
  ];
}

function buildFallbackLead(context, existingLeads = []) {
  const text = `${context.title}. ${context.firstSentence}. ${context.evidence.sentences.join(" ")}`;
  if (/governance proposal/i.test(text) && /staking rewards|ecosystem funding|validator/i.test(text)) {
    return composeLead("The proposal centers on staking rewards, ecosystem funding and validator coordination.", context, existingLeads);
  }
  const fact = context.evidence.sentences
    .find((sentence) => !existingLeads.some((lead) => tooSimilar(lead, sentence)))
    || context.firstSentence
    || context.title;
  return composeLead(fact, context, existingLeads);
}

function buildRelaxedLead(context, index) {
  const sourceTitle = asSentence(rewriteSourceHeadline(context.title));
  const fact = asSentence(removeRepeatedLeadStart(cleanSentence(context.evidence.sentences[index] || context.firstSentence || context.title), sourceTitle));
  const secondFact = asSentence(removeRepeatedLeadStart(
    context.evidence.sentences.find((sentence) => !sameSentence(sentence, fact) && !sameSentence(sentence, context.title)) || context.firstSentence || "",
    sourceTitle
  ));
  const options = [
    `${sourceTitle} ${fact && !sameSentence(fact, sourceTitle) ? fact : secondFact}`,
    `${fact || sourceTitle} ${secondFact && !tooSimilar(secondFact, fact) ? secondFact : ""}`,
    `${fact || sourceTitle} ${secondFact && !tooSimilar(secondFact, fact) ? secondFact : ""}`.trim()
  ];
  return limitLead(options[index] || options[0]);
}

function removeRepeatedLeadStart(sentence, titleSentence) {
  const title = cleanSentence(titleSentence).replace(/\.$/, "");
  const text = cleanSentence(sentence);
  if (title && text.toLowerCase().startsWith(title.toLowerCase())) {
    return text.slice(title.length).replace(/^[.\s]+/, "").trim();
  }
  return text;
}

function violatesHeadlineRules(headline, originalTitle, options = {}) {
  const text = cleanSentence(headline);
  return text.length < MIN_HEADLINE_CHARS
    || text.length > MAX_HEADLINE_CHARS
    || !hasHeadlineVerb(text)
    || /[?!]|\.{3}/.test(text)
    || hasUnfinishedHeadlineEnding(text)
    || hasBrokenHeadlineJoin(text)
    || looksLikeLead(text)
    || /^(how|why|what|when|where)\b/i.test(text)
    || headlineBannedPattern.test(text)
    || (!options.allowSourceTitle && sameSentence(text, originalTitle));
}

function hasUnfinishedHeadlineEnding(text) {
  return /\b(will work on|plans to|plan to|set to|seeks to|aims to|faces|puts|amid|with|for|to|on|and|or)\s*$/i.test(text);
}

function hasBrokenHeadlineJoin(text) {
  return /\b(puts|seeks|faces|tests|enables|stays near|launches)\s+(The|A|An)\s+/i.test(text)
    || /^Crypto\s+(puts|seeks|faces|launches)\s+(The|A|An)\b/i.test(text);
}

function looksLikeLead(text) {
  const commaCount = (text.match(/,/g) || []).length;
  return commaCount > 1
    || /\b(raising|prompting|sparking|fueling|stoking)\s+(questions|concerns|debate|scrutiny)\b/i.test(text)
    || /\b(who gets to decide|where the money goes|why it matters|what it means)\b/i.test(text)
    || /\b(toward|about)\s+.+,\s*.+\s+and\s+.+/i.test(text)
    || /\bwould let .+ redirect .+ toward .+,\s+raising\b/i.test(text);
}

function violatesLeadRules(lead, title) {
  const text = cleanSentence(lead);
  const sentenceCount = sentenceSplit(text).length;
  const words = wordCount(text);
  return !isUsefulSentence(text)
    || words < MIN_LEAD_WORDS
    || words > MAX_LEAD_WORDS
    || sentenceCount > 3
    || !hasSpecificSubject(text)
    || looksLikeWeakLeadFragment(text)
    || sameSentence(text, title)
    || sameSentence(sanitizeHeadline(text), title)
    || tooSimilar(text, title)
    || /[?!]/.test(text)
    || leadBannedPattern.test(text);
}

function hasSpecificSubject(text) {
  return /\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\b/.test(text)
    || /\b(the company|the regulator|the exchange|the protocol|the bank|the firm|developers|validators|investors|analysts)\b/i.test(text);
}

function looksLikeWeakLeadFragment(text) {
  return wordCount(text) < MIN_LEAD_WORDS
    || /^(developers|investors|analysts|traders|users)\s+now\s+want\s+to\b/i.test(text)
    || /^(it|this|that|they)\s+/i.test(text)
    || /\b(want to do away with it|has become redundant)\b/i.test(text)
    || !/\b(is|are|was|were|has|have|had|will|would|could|said|filed|amended|disclosed|revealed|launched|plans|seeks|faces|shows|comes|puts|adds|marks|called)\b/i.test(text);
}

function detectSubject(title, firstSentence, evidence) {
  const text = `${title}. ${firstSentence}`;
  const preferred = evidence.entities.find((entity) => {
    const lower = entity.toLowerCase();
    return !/live updates|live|crypto|bitcoin fields|new research|artificial intelligence|crypto market|united states|south korea|wall street journal/i.test(entity)
      && lower.length > 2;
  });
  if (preferred) return preferred;
  if (/^crypto exchange\b/i.test(text)) return "The exchange";
  const match = text.match(/^([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/);
  return match?.[1] || "Crypto firms";
}

function detectAction(title, firstSentence) {
  const text = `${title}. ${firstSentence}`;
  const rules = [
    [/enable|allow|lets|let/i, "enables"],
    [/test|trial|pilot|proof-of-concept/i, "tests"],
    [/stuck|near|pressure|outflow/i, "stays near"],
    [/launch|program/i, "launches"],
    [/fund|funding|rewards/i, "could fund"],
    [/paid|funded|spent/i, "paid"],
    [/beat|beats|outperform|tops/i, "beats"],
    [/drop|fell|slid|plung/i, "falls"],
    [/rise|rally|jump|surge/i, "rises"],
    [/sue|lawsuit|court|charge|ban|fine|sec|cftc/i, "faces"],
    [/hack|exploit|drain|stolen|breach/i, "faces"],
    [/study|research|suggest|warn/i, "warns of"],
    [/launch|file|seek|apply/i, "seeks"],
    [/buy|acquire|invest/i, "buys"]
  ];
  return rules.find(([rule]) => rule.test(text))?.[1] || "puts";
}

function detectObject(title, firstSentence, subject) {
  const source = sanitizeHeadline(firstSentence) || sanitizeHeadline(title);
  let object = source.replace(new RegExp(`^${escapeRegExp(subject)}\\s+`, "i"), "");
  object = object.replace(/^(paid|beats|beat|faces|puts|warns of|seeks|buys|falls|rises)\s+/i, "");
  if (/governance proposal/i.test(object) && /staking rewards|ecosystem funding|fund/i.test(object)) {
    return "ecosystem projects with staking rewards";
  }
  object = object.replace(/\s*,?\s+according to.+$/i, "");
  object = object.replace(/\s*,?\s+(raising|prompting|sparking|fueling|stoking)\s+.+$/i, "");
  object = object.replace(/\s*,?\s+(as|while|after|because|amid|with)\s+.+$/i, "");
  object = object.replace(/\s+\b(and who|who gets|why it|what it)\b.+$/i, "");
  object = object.replace(/\.$/, "").trim();
  object = trimHeadlineCore(object);
  if (!object || object.length < 12) return "fresh scrutiny in crypto";
  return object;
}

function buildWhyItMattersHeadline(subject, category) {
  if (category.id === "regulation") return `${subject} tests crypto’s regulatory mood`;
  if (category.id === "hacks") return `${subject} puts crypto security back on alert`;
  if (category.id === "scam") return `${subject} puts crypto fraud risks back in focus`;
  if (category.id === "defi") return `${subject} raises a new DeFi question`;
  if (category.id === "crypto-etf") return `${subject} raises a new crypto ETF question`;
  if (category.id === "trading") return `${subject} gives crypto traders a new signal`;
  if (category.id === "bitcoin-mining") return `${subject} puts Bitcoin mining economics in focus`;
  if (category.id === "stablecoins") return `${subject} raises a new stablecoin question`;
  if (category.id === "cex") return `${subject} puts centralized exchanges back in focus`;
  if (category.id === "dex") return `${subject} puts decentralized trading back in focus`;
  return `${subject} puts crypto trust back in focus`;
}

function joinHeadline(subject, action, object) {
  const cleanObject = object.replace(/\.$/, "").trim();
  return `${subject} ${action} ${cleanObject}`;
}

function trimHeadline(value) {
  const text = cleanSentence(value).replace(/\.$/, "");
  if (text.length <= MAX_HEADLINE_CHARS) return text;
  const naturalBreak = text.slice(0, MAX_HEADLINE_CHARS + 1).match(/^(.+?)(?:,\s+|\s+-\s+|\s+as\s+|\s+amid\s+|\s+after\s+|\s+while\s+|\s+with\s+)/i);
  if (naturalBreak?.[1] && naturalBreak[1].length >= 18) return naturalBreak[1].trim();
  return text.slice(0, MAX_HEADLINE_CHARS).replace(/\s+\S*$/, "").trim();
}

function trimHeadlineCore(value) {
  const text = cleanSentence(value).replace(/\.$/, "");
  if (text.length <= MAX_HEADLINE_CORE_CHARS) return text;
  const naturalBreak = text.slice(0, MAX_HEADLINE_CORE_CHARS + 1).match(/^(.+?)(?:,\s+|\s+-\s+|\s+as\s+|\s+amid\s+|\s+after\s+|\s+while\s+|\s+with\s+|\s+about\s+)/i);
  if (naturalBreak?.[1] && naturalBreak[1].length >= 12) return naturalBreak[1].trim();
  return text.slice(0, MAX_HEADLINE_CORE_CHARS).replace(/\s+\S*$/, "").trim();
}

function trimLead(value) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= MAX_LEAD_WORDS) return words.join(" ");
  return words.slice(0, MAX_LEAD_WORDS).join(" ").replace(/[,:;]$/, "").trim() + ".";
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function extractFirst(text, pattern) {
  return cleanText(text).match(pattern)?.[0] || "";
}

function hasHeadlineVerb(value) {
  return /\b(Paid|Planned|Weighed|Put|Lost|Drove|Recovered|Amended|Amends|Disclosed|Updated|Says|Faces|Puts|Links|Warns|Challenges|Claims|Falls|Rises|Buys|Seeks|Test|Tests|Moved|Got|Faced|Funds|Fund|Lets|Allows|Enables|Adds|Taps|Plan|Plans|Opens|Expands|Brings|Stays|Struggles|Hits|Keep|Keeps|Redirects|Give|Gives|Draws|Raises|Grows|Pressures|Slashes|Escalates|Reveals|Undercuts|Launches|Launched|Will|Could)\b/i.test(value);
}

function asSentence(value) {
  const text = cleanSentence(value).replace(/\.$/, "").trim();
  return text ? `${text}.` : "";
}

function escapeRegExp(value) {
  return cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeHeadline(value) {
  return cleanSentence(value)
    .replace(/\s*:\s*(WSJ|FT|CNBC|Reuters|Bloomberg|AP)\.?$/i, (_, outlet) => ` after ${outlet.toUpperCase()} report`)
    .replace(/\s*[-–—|:]\s*(Cointelegraph|Decrypt|CoinDesk|The Block)\.?$/i, "")
    .replace(/\s*:\s*(Cointelegraph|Decrypt|CoinDesk|The Block)\.?$/i, "")
    .replace(/^([^:]{2,40}):\s+\1\b/i, "$1")
    .replace(/^([A-Z][A-Za-z0-9&.'-]{2,30}):\s+\1\s+/i, "$1 ")
    .replace(/\s+[-–—]\s+/g, " ")
    .replace(/\s*:\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceToHeadline(sentence) {
  const clean = sanitizeHeadline(sentence);
  if (!clean || looksLikeTickerStrip(clean)) return "";
  return clean.replace(/\.$/, "");
}

function addFigureIfNatural(headline, figure) {
  if (!figure || headline.includes(figure) || /^\d/.test(figure)) return headline;
  return `${headline} as ${figure} Comes Into Focus`;
}

function cleanSentence(value) {
  return cleanText(value)
    .replace(/^Search\s*\/\s*News\s+Video\s+Prices\s+Research\s+Events\s+Data\s*&\s*Indices\s+Sponsored\s+Search\s*\/\s*en\s+/i, "")
    .replace(/^.*?\biframe\][^>]*>\s*/i, "")
    .replace(/^.*?\b(Markets|Finance|Policy|Tech|Business|Bitcoin|Ethereum|DeFi|Crypto ETF)\s+(?=[A-Z0-9$])/i, "")
    .replace(/^By\s+.+?(?:Edited by\s+.+?)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}.*?\b(?:min read|Artificial intelligence|Bitcoin|Crypto|Markets?)\.?\s*/i, "")
    .replace(/^By\s+.+?(?:\d{1,2},\s+\d{4}|\d+\s+min read)\s*/i, "")
    .replace(/\s*[-–—|]\s*(Cointelegraph|Decrypt|CoinDesk|The Block)\.?$/i, "")
    .replace(/^(Cointelegraph|Decrypt|CoinDesk|The Block)\.?\s*/i, "")
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/\s+\.\s*$/g, ".")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulSentence(sentence) {
  const text = cleanSentence(sentence);
  return text.length > 35
    && !/^(Cointelegraph|Decrypt|CoinDesk|The Block)\.?$/i.test(text)
    && !looksLikeByline(text)
    && !looksLikeTickerStrip(text)
    && !looksLikePageChrome(text)
    && !/sign up|subscribe|newsletter|advertisement|read more|related:/i.test(text);
}

function looksLikePageChrome(sentence) {
  return /Search\s*\/\s*News\s+Video\s+Prices\s+Research\s+Events|Sponsored\s+Search|iframe\]|--ad-width|--ad-height|items-center|var\(--|Data\s*&\s*Indices/i.test(sentence)
    || /^Search\s*\/\s*/i.test(sentence);
}

function looksLikeByline(sentence) {
  return /^By\s+.+?(Edited by|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d+\s+min read)/i.test(sentence)
    || /Edited by\s+.+?\d{4}/i.test(sentence);
}

function looksLikeTickerStrip(sentence) {
  const tickerHits = sentence.match(/\b[A-Z]{2,6}\s+\$?\d+(?:[.,]\d+)?\s+\d+(?:[.,]\d+)?%/g) || [];
  const percentHits = sentence.match(/\d+(?:[.,]\d+)?%/g) || [];
  return tickerHits.length >= 3 || percentHits.length >= 5;
}

function sameSentence(left, right) {
  const normalize = (value) => cleanText(value).toLowerCase().replace(/[.!?:;"'“”‘’]+$/g, "").trim();
  return normalize(left) === normalize(right);
}

function tooSimilar(left, right) {
  const words = (value) => new Set(cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 3));
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return false;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / Math.min(leftWords.size, rightWords.size) > 0.72;
}

function normalizeLead(sentence, title) {
  let lead = cleanText(sentence);
  const cleanTitle = cleanText(title);
  if (cleanTitle && lead.toLowerCase().startsWith(`${cleanTitle} ${cleanTitle}`.toLowerCase())) {
    lead = lead.slice(cleanTitle.length).trim();
  }
  if (cleanTitle && lead.toLowerCase().startsWith(`${cleanTitle} `.toLowerCase())) {
    lead = lead.slice(cleanTitle.length).replace(/^[.\s]+/, "").trim();
  }
  if (cleanTitle && lead.toLowerCase() === cleanTitle.toLowerCase()) {
    return cleanTitle;
  }
  return lead;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/news") {
    try {
      return json(res, 200, await getNews());
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (url.pathname === "/api/analyze-url") {
    const target = url.searchParams.get("url");
    if (!target) return json(res, 400, { error: "Missing url" });
    try {
      const html = await fetchText(target);
      const article = extractArticle(html);
      return json(res, 200, { article, drafts: buildDrafts(article) });
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/analyze-text" && req.method === "POST") {
    const body = await readRequest(req);
    const input = JSON.parse(body || "{}");
    const article = { title: input.title || "", description: input.description || "", body: input.text || "" };
    return json(res, 200, { article, drafts: buildDrafts(article) });
  }

  return json(res, 404, { error: "Not found" });
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(ROOT, pathname.replace(/^\/+/, ""));
  try {
    const data = await readFile(file);
    return send(res, 200, data, mime[extname(file)] || "application/octet-stream");
  } catch {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
});

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
  server.listen(PORT, HOST, () => {
    const visibleHost = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`Crypto news desk running at http://${visibleHost}:${PORT}`);
  });
}

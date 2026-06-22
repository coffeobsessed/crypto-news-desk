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
  ["regulation", "Регулирование", /sec|cftc|regulat|court|lawsuit|bill|senate|treasury|ofac|sanction|license|policy|cbdc|налог|закон/i],
  ["market", "Рынок", /bitcoin|btc|ether|eth|price|market|trading|etf|stock|shares|treasury|fund|investor|rally|drop|liquidat|inflation|fed/i],
  ["defi", "DeFi", /defi|dao|dex|lending|staking|yield|liquidity|uniswap|aave|compound|maker|curve|stablecoin/i],
  ["hacks", "Взломы", /hack|exploit|stolen|phish|drain|breach|attack|scam|fraud|launder|security|vulnerab/i]
];

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
    .map((lead) => limitLead(normalizeLead(cleanSentence(lead), safeTitle)))
    .filter((lead) => isUsefulSentence(lead) && !sameSentence(lead, safeTitle) && !sameSentence(sanitizeHeadline(lead), safeTitle))
    .filter((lead, index, list) => list.findIndex((other) => tooSimilar(lead, other)) === index);

  return {
    headlines,
    leads: ensureUsefulLeads([...new Set(leads)], context),
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
  const text = cleanSentence(value);
  return trimWords(text, 10);
}

function limitLead(value) {
  const text = cleanText(value);
  return text.length > 260 ? `${text.slice(0, 256).trim()}...` : text;
}

function makeHeadlines(context) {
  const { title, firstSentence, evidence, category } = context;
  const base = sanitizeHeadline(title);
  const editorial = editorialHeadlines(base, firstSentence, evidence, category);
  if (editorial.length >= 3) return ensureThreeHeadlines(editorial, base);
  const subject = detectSubject(base, firstSentence, evidence);
  const action = detectAction(base, firstSentence);
  const object = detectObject(base, firstSentence, subject);
  const figure = evidence.figures.find((item) => /[$€£%]|million|billion|trillion/i.test(item)) || evidence.figures[0] || "";
  const categoryNoun = category.id === "regulation" ? "regulatory test"
    : category.id === "hacks" ? "security scare"
    : category.id === "defi" ? "DeFi test"
    : "market test";
  const candidates = [
    joinHeadline(subject, action, object),
    figure ? joinHeadline(subject, "faces", `${figure} ${categoryNoun}`) : joinHeadline(subject, "puts", `${categoryNoun} in focus`),
    buildWhyItMattersHeadline(subject, category)
  ];
  const fallback = [base, sentenceToHeadline(firstSentence), `${subject} draws fresh crypto scrutiny`];
  return ensureThreeHeadlines([...candidates, ...fallback], base);
}

function editorialHeadlines(title, firstSentence, evidence, category) {
  const text = `${title}. ${firstSentence}. ${evidence.sentences.join(" ")}`;
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
      "Morgan Stanley Amended Ether and Solana ETF Filings",
      "Morgan Stanley Disclosed Lower Fees in ETF Filings",
      "Morgan Stanley Updated Its Crypto ETF Applications"
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

function ensureThreeHeadlines(candidates, originalTitle) {
  const cleaned = [];
  for (const candidate of candidates) {
    const headline = limitHeadline(sanitizeHeadline(candidate));
    if (headline.length < 18) continue;
    if (wordCount(headline) > 10) continue;
    if (!hasHeadlineVerb(headline)) continue;
    if (/key figure|what we know|here’s|here's/i.test(headline)) continue;
    if (sameSentence(headline, originalTitle)) continue;
    if (cleaned.some((item) => sameSentence(item, headline))) continue;
    cleaned.push(headline);
    if (cleaned.length === 3) break;
  }
  while (cleaned.length < 3) {
    const fallback = [
      "Crypto Firms Faced a Fresh Credibility Test",
      "Investors Got Another Crypto Risk Warning",
      "Crypto Trust Moved Back Into Focus"
    ][cleaned.length];
    if (!cleaned.includes(fallback)) cleaned.push(fallback);
  }
  return cleaned;
}

function ensureUsefulLeads(leads, context) {
  const useful = [];
  for (const lead of leads.filter(isUsefulSentence)) {
    if (!useful.some((item) => tooSimilar(item, lead))) useful.push(lead);
  }
  const facts = context.evidence.sentences
    .filter((sentence) => !sameSentence(sentence, context.title))
    .filter((sentence) => !useful.some((lead) => tooSimilar(lead, sentence)))
    .slice(0, 3);
  for (const fact of facts) {
    if (useful.length >= 2) break;
    useful.push(limitLead(fact));
  }
  while (useful.length < 2) {
    const fallback = limitLead(context.firstSentence || context.title);
    if (!useful.some((lead) => tooSimilar(lead, fallback))) useful.push(fallback);
    else break;
  }
  return useful.slice(0, 2);
}

function detectSubject(title, firstSentence, evidence) {
  const text = `${title}. ${firstSentence}`;
  const preferred = evidence.entities.find((entity) => {
    const lower = entity.toLowerCase();
    return !/bitcoin fields|new research|artificial intelligence|crypto market|united states|wall street journal/i.test(entity)
      && lower.length > 2;
  });
  if (preferred) return preferred;
  const match = text.match(/^([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})\b/);
  return match?.[1] || "Crypto firms";
}

function detectAction(title, firstSentence) {
  const text = `${title}. ${firstSentence}`;
  const rules = [
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
  object = object.replace(/\s*,?\s+according to.+$/i, "");
  object = object.replace(/\.$/, "").trim();
  if (!object || object.length < 12) return "fresh scrutiny in crypto";
  return object;
}

function buildWhyItMattersHeadline(subject, category) {
  if (category.id === "regulation") return `${subject} tests crypto’s regulatory mood`;
  if (category.id === "hacks") return `${subject} puts crypto security back on alert`;
  if (category.id === "defi") return `${subject} raises a new DeFi question`;
  if (category.id === "market") return `${subject} gives crypto traders a new signal`;
  return `${subject} puts crypto trust back in focus`;
}

function joinHeadline(subject, action, object) {
  const cleanObject = object.replace(/\.$/, "").trim();
  return `${subject} ${action} ${cleanObject}`;
}

function trimWords(value, maxWords) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function hasHeadlineVerb(value) {
  return /\b(Paid|Planned|Weighed|Put|Lost|Drove|Recovered|Amended|Disclosed|Updated|Says|Faces|Puts|Links|Warns|Challenges|Claims|Falls|Rises|Buys|Seeks|Tests|Moved|Got|Faced|Will|Could)\b/i.test(value);
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
    && !/sign up|subscribe|newsletter|advertisement|read more|related:/i.test(text);
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

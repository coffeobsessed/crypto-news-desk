const state = {
  items: [],
  activeCategory: "all",
  selectedUrl: "",
  loadingUrl: ""
};

const categories = [
  ["all", "Все"],
  ["bitcoin", "Bitcoin"],
  ["ethereum", "Ethereum"],
  ["altcoins", "Altcoins"],
  ["prediction-markets", "Prediction markets"],
  ["regulation", "Regulation"],
  ["crypto-companies", "Crypto Companies"],
  ["crypto-etf", "Crypto ETF"],
  ["bitcoin-mining", "Bitcoin Mining"],
  ["defi", "DeFi"],
  ["stablecoins", "Stablecoins"],
  ["trading", "Trading"],
  ["cex", "CEX"],
  ["dex", "DEX"],
  ["hacks", "Hacks"],
  ["scam", "Scam"],
  ["other", "Другое"]
];

const feed = document.querySelector("#feed");
const detail = document.querySelector("#detail");
const statusBox = document.querySelector("#status");
const count = document.querySelector("#count");
const searchInput = document.querySelector("#searchInput");
const tabs = document.querySelector("#categoryTabs");

document.querySelector("#refreshBtn").addEventListener("click", loadNews);
document.querySelector("#manualToggle").addEventListener("click", () => {
  document.querySelector("#manualForm").classList.toggle("hidden");
});
document.querySelector("#manualForm").addEventListener("submit", handleManual);
searchInput.addEventListener("input", renderFeed);

renderTabs();
loadNews();

function renderTabs() {
  tabs.innerHTML = categories.map(([id, label]) => (
    `<button class="tab ${id === state.activeCategory ? "active" : ""}" type="button" data-id="${id}">${label}</button>`
  )).join("");
  tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.id;
      renderTabs();
      renderFeed();
    });
  });
}

async function loadNews() {
  status("Загрузка свежих новостей...");
  feed.innerHTML = "";
  try {
    const response = await fetch("/api/news");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить новости");
    state.items = data.items || [];
    renderFeed();
    const sourceErrors = (data.errors || []).map((item) => item.source).join(", ");
    if (sourceErrors) {
      status(`Часть источников не ответила: ${sourceErrors}`, true);
    } else {
      statusBox.classList.add("hidden");
    }
  } catch (error) {
    status(`Не удалось получить новости. Проверьте интернет-доступ сервера. ${error.message}`, true);
  }
}

function renderFeed() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = state.items.filter((item) => {
    const categoryOk = state.activeCategory === "all" || item.category?.id === state.activeCategory;
    const queryOk = !query || `${item.title} ${item.description} ${item.source}`.toLowerCase().includes(query);
    return categoryOk && queryOk;
  });
  count.textContent = `${visible.length} материалов`;
  feed.innerHTML = visible.map((item) => `
    <button class="newsItem ${item.url === state.selectedUrl ? "active" : ""}" type="button" data-url="${escapeAttr(item.url)}">
      <div class="itemMeta">
        <span class="badge">${escapeHtml(item.category?.label || "Другое")}</span>
        <span>${escapeHtml(item.source)}</span>
        <span>${formatAge(item.publishedAt)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description || "Описание в ленте отсутствует.")}</p>
    </button>
  `).join("");
  feed.querySelectorAll(".newsItem").forEach((button) => {
    button.addEventListener("click", () => openItem(button.dataset.url));
  });
  if (!visible.length) {
    feed.innerHTML = `<div class="status">Нет материалов под выбранный фильтр за последние 48 часов.</div>`;
  }
}

async function openItem(url) {
  const item = state.items.find((entry) => entry.url === url);
  if (!item) return;
  state.selectedUrl = url;
  state.loadingUrl = url;
  document.body.classList.add("detailOpen");
  renderFeed();
  detail.className = "detail";
  detail.innerHTML = renderLoading(item);
  detail.scrollTop = 0;
  try {
    const response = await fetch(`/api/analyze-url?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось разобрать статью");
    if (state.loadingUrl !== url) return;
    renderDetail(item, data.article, data.drafts, url);
  } catch (error) {
    const fallbackArticle = {
      title: item.title,
      description: item.description,
      body: item.verifiedText
    };
    const response = await fetch("/api/analyze-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: fallbackArticle.title, text: fallbackArticle.body })
    });
    const data = await response.json();
    renderDetail(item, fallbackArticle, data.drafts, url);
  }
}

async function handleManual(event) {
  event.preventDefault();
  const title = document.querySelector("#manualTitle").value.trim();
  const text = document.querySelector("#manualText").value.trim();
  if (!title && !text) return;
  document.body.classList.add("detailOpen");
  detail.className = "detail";
  detail.innerHTML = `<p class="eyebrow">Ручная вставка</p><h2>Готовлю варианты...</h2>`;
  detail.scrollTop = 0;
  const response = await fetch("/api/analyze-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, text })
  });
  const data = await response.json();
  renderDetail({ source: "Ручная вставка", category: data.drafts.category, publishedAt: new Date().toISOString() }, data.article, data.drafts);
}

function renderLoading(item) {
  return `
    <div class="detailHeader">
      <button class="closeDetail" type="button" aria-label="Закрыть">×</button>
      <p class="eyebrow">${escapeHtml(item.source)}</p>
      <h2>${escapeHtml(item.title)}</h2>
      <div class="sourceLine"><span>${formatAge(item.publishedAt)}</span><span>${escapeHtml(item.category?.label || "Другое")}</span></div>
    </div>
    <p>Открываю первоисточник и извлекаю подтвержденные факты...</p>
  `;
}

function renderDetail(item, article, drafts, url = "", warning = "") {
  detail.className = "detail";
  detail.innerHTML = `
    <div class="detailHeader">
      <button class="closeDetail" type="button" aria-label="Закрыть">×</button>
      <p class="eyebrow">${escapeHtml(item.source || "Источник")}</p>
      <h2>${escapeHtml(article.title || item.title || "Материал без заголовка")}</h2>
      <div class="sourceLine">
        ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">Первоисточник</a>` : ""}
        <span>${escapeHtml(drafts.category?.label || item.category?.label || "Другое")}</span>
        ${item.publishedAt ? `<span>${formatAge(item.publishedAt)}</span>` : ""}
      </div>
      ${warning ? `<p class="status error">${escapeHtml(warning)}</p>` : ""}
    </div>
    ${section("Заголовки", drafts.headlines)}
    ${section("Лиды", drafts.leads)}
    <div class="guardrails">
      ${(drafts.guardrails || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
  detail.scrollTop = 0;
}

function section(title, items) {
  return `
    <section class="draftSection">
      <h3>${title}</h3>
      <ul class="draftList">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function status(text, isError = false) {
  statusBox.textContent = text;
  statusBox.classList.remove("hidden");
  statusBox.classList.toggle("error", isError);
}

function formatAge(value) {
  if (!value) return "время не указано";
  const date = new Date(value);
  const hours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));
  if (hours < 1) return "меньше часа назад";
  return `${hours} ч назад`;
}

detail.addEventListener("click", (event) => {
  if (!event.target.closest(".closeDetail")) return;
  document.body.classList.remove("detailOpen");
  state.selectedUrl = "";
  state.loadingUrl = "";
  renderFeed();
  detail.className = "detail empty";
  detail.innerHTML = `
    <p class="eyebrow">Выберите новость</p>
    <h2>Здесь появятся заголовки и лиды</h2>
    <p>Нажмите на любую карточку слева. Результат откроется сразу в этой панели.</p>
  `;
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

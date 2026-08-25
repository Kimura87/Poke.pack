const BOOSTER_PRICE = 2;
const INITIAL_MOONS = 20;
const STORAGE_KEYS = { coins: "pokepack_moons_v1", inventory: "pokepack_inventory_me04", history: "pokepack_history_me04" };
const SELL_VALUES = {
  "Comum": 1, "Incomum": 1, "Rara": 3, "Rara Dupla": 5,
  "Ilustração Rara": 7, "Rara Ultra": 10,
  "Ilustração Rara Especial": 18, "Mega Attack Rare": 30
};

let cards = [];
let coins = INITIAL_MOONS;
let inventory = [];
let history = [];
let currentWinningCard = null;
let isOpening = false;

const elements = {
  coinsValue: document.querySelector("#coinsValue"), cardCount: document.querySelector("#cardCount"),
  openButton: document.querySelector("#openBoosterButton"), resetButton: document.querySelector("#resetCoinsButton"),
  status: document.querySelector("#statusMessage"), rouletteSection: document.querySelector("#rouletteSection"),
  rouletteTrack: document.querySelector("#rouletteTrack"), resultSection: document.querySelector("#resultSection"),
  resultName: document.querySelector("#resultName"), resultCardWrap: document.querySelector("#resultCardWrap"),
  resultNumber: document.querySelector("#resultNumber"), resultRarity: document.querySelector("#resultRarity"),
  addButton: document.querySelector("#addInventoryButton"), againButton: document.querySelector("#openAgainButton"),
  inventoryGrid: document.querySelector("#inventoryGrid"), inventoryEmpty: document.querySelector("#inventoryEmpty"),
  inventoryCount: document.querySelector("#inventoryCount"), historyList: document.querySelector("#historyList"),
  historyEmpty: document.querySelector("#historyEmpty"), menuToggle: document.querySelector(".menu-toggle"), nav: document.querySelector(".nav-links")
};

async function loadCards() {
  try {
    const response = await fetch("cards.json");
    if (!response.ok) throw new Error("Não foi possível carregar as cartas.");
    cards = await response.json();
    elements.cardCount.textContent = cards.length;
  } catch (error) {
    elements.status.textContent = "Erro ao carregar cards.json. Execute o projeto em um servidor local.";
    elements.openButton.disabled = true;
    console.error(error);
  }
}

function readStorage(key, fallback) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
  catch { return fallback; }
}

function loadCoins() { coins = Number(readStorage(STORAGE_KEYS.coins, INITIAL_MOONS)); updateCoinsDisplay(); }
function saveCoins() { localStorage.setItem(STORAGE_KEYS.coins, JSON.stringify(coins)); updateCoinsDisplay(); }
function updateCoinsDisplay() { elements.coinsValue.textContent = coins.toLocaleString("pt-BR"); }
function loadInventory() { inventory = readStorage(STORAGE_KEYS.inventory, []); }
function saveInventory() { localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify(inventory)); }
function loadHistory() { history = readStorage(STORAGE_KEYS.history, []); }
function saveHistory() { localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history)); }

function getRandomCard(cardList) {
  const totalWeight = cardList.reduce((sum, card) => sum + card.weight, 0);
  let draw = Math.random() * totalWeight;
  for (const card of cardList) { draw -= card.weight; if (draw <= 0) return card; }
  return cardList.at(-1);
}

function getRarityClass(rarity) {
  return {
    "Comum":"rarity-common", "Incomum":"rarity-uncommon", "Rara":"rarity-rare",
    "Rara Dupla":"rarity-double", "Rara Ultra":"rarity-ultra",
    "Ilustração Rara":"rarity-illustration",
    "Ilustração Rara Especial":"rarity-special",
    "Mega Attack Rare":"rarity-mega"
  }[rarity] || "rarity-common";
}

function createCardImage(card) {
  const img = document.createElement("img"); img.src = card.image; img.alt = card.name; img.loading = "lazy"; return img;
}

async function openBooster() {
  if (isOpening || !cards.length) return;
  if (coins < BOOSTER_PRICE) {
    elements.status.textContent = "Moon insuficiente. Venda cartas ou use “Resetar Moon” para continuar testando.";
    elements.openButton.classList.add("shake"); setTimeout(() => elements.openButton.classList.remove("shake"), 400); return;
  }
  isOpening = true; coins -= BOOSTER_PRICE; saveCoins();
  elements.status.textContent = ""; elements.openButton.disabled = true; elements.resultSection.hidden = true;
  currentWinningCard = getRandomCard(cards);
  addHistory(currentWinningCard);
  elements.rouletteSection.hidden = false;
  elements.rouletteSection.scrollIntoView({ behavior: "smooth", block: "center" });
  await startRoulette(currentWinningCard);
  showResult(currentWinningCard); isOpening = false; elements.openButton.disabled = false;
}

function startRoulette(winningCard) {
  const itemCount = 34, winnerIndex = 29, sequence = [];
  for (let index = 0; index < itemCount; index++) sequence.push(index === winnerIndex ? winningCard : cards[Math.floor(Math.random() * cards.length)]);
  elements.rouletteTrack.replaceChildren(...sequence.map((card, index) => {
    const item = document.createElement("div"); item.className = `roulette-item ${getRarityClass(card.rarity)}${index === winnerIndex ? " winner" : ""}`;
    item.append(createCardImage(card)); return item;
  }));
  elements.rouletteTrack.style.transition = "none"; elements.rouletteTrack.style.transform = "translateX(0px)";
  const cardWidth = elements.rouletteTrack.firstElementChild.getBoundingClientRect().width;
  const gap = parseFloat(getComputedStyle(elements.rouletteTrack).gap);
  const viewportCenter = window.innerWidth / 2;
  const winnerCenter = winnerIndex * (cardWidth + gap) + cardWidth / 2;
  const target = viewportCenter - winnerCenter;
  void elements.rouletteTrack.offsetWidth;
  elements.rouletteTrack.style.transition = "transform 5s cubic-bezier(.08,.72,.12,1)";
  elements.rouletteTrack.style.transform = `translateX(${target}px)`;
  return new Promise(resolve => setTimeout(resolve, 5200));
}

function showResult(card) {
  elements.rouletteSection.hidden = true; elements.resultSection.hidden = false;
  elements.resultName.textContent = card.name; elements.resultNumber.textContent = card.number; elements.resultRarity.textContent = card.rarity;
  const wrapper = document.createElement("div"); wrapper.className = `result-card ${getRarityClass(card.rarity)}`; wrapper.append(createCardImage(card));
  elements.resultCardWrap.replaceChildren(wrapper); elements.addButton.disabled = false; elements.addButton.textContent = "ADICIONAR AO INVENTÁRIO";
  elements.resultSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

function addToInventory() {
  if (!currentWinningCard || elements.addButton.disabled) return;
  const existing = inventory.find(item => item.cardId === currentWinningCard.id);
  if (existing) existing.quantity += 1; else inventory.push({ cardId: currentWinningCard.id, quantity: 1 });
  saveInventory(); renderInventory(); elements.addButton.disabled = true; elements.addButton.textContent = "ADICIONADA ✓";
}

function addHistory(card) { history.unshift({ cardId: card.id, date: new Date().toISOString() }); history = history.slice(0, 50); saveHistory(); renderHistory(); }

function renderInventory() {
  const validItems = inventory.map(item => ({ ...item, card: cards.find(card => card.id === item.cardId) })).filter(item => item.card);
  elements.inventoryGrid.replaceChildren(...validItems.map(item => {
    const article = document.createElement("article"); article.className = `inventory-card ${getRarityClass(item.card.rarity)}`;
    const quantity = document.createElement("span"); quantity.className = "quantity"; quantity.textContent = `×${item.quantity}`;
    const title = document.createElement("h3"); title.textContent = item.card.name;
    const number = document.createElement("p"); number.textContent = item.card.number;
    const rarity = document.createElement("p"); rarity.className = "rarity-label"; rarity.textContent = item.card.rarity;
    const sellButton = document.createElement("button"); sellButton.className = "sell-button";
    sellButton.type = "button"; sellButton.textContent = `Vender por ${getSellValue(item.card)} Moon`;
    sellButton.addEventListener("click", () => sellCard(item.card.id));
    article.append(createCardImage(item.card), quantity, title, number, rarity, sellButton); return article;
  }));
  const total = validItems.reduce((sum, item) => sum + item.quantity, 0);
  elements.inventoryCount.textContent = `${total} ${total === 1 ? "carta" : "cartas"}`; elements.inventoryEmpty.hidden = validItems.length > 0;
}

function renderHistory() {
  const validItems = history.map(entry => ({ ...entry, card: cards.find(card => card.id === entry.cardId) })).filter(entry => entry.card);
  elements.historyList.replaceChildren(...validItems.map(entry => {
    const row = document.createElement("article"); row.className = `history-item ${getRarityClass(entry.card.rarity)}`;
    const dot = document.createElement("i"); dot.className = "history-dot";
    const path = document.createElement("div"); path.className = "history-path";
    path.append("Caos Ascendente ", Object.assign(document.createElement("span"), { textContent: "→" }), ` ${entry.card.name} `, Object.assign(document.createElement("strong"), { textContent: `• ${entry.card.rarity}` }));
    const date = document.createElement("time"); date.className = "history-date"; date.dateTime = entry.date; date.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle:"short", timeStyle:"short" }).format(new Date(entry.date));
    row.append(dot, path, date); return row;
  }));
  elements.historyEmpty.hidden = validItems.length > 0;
}

function getSellValue(card) { return SELL_VALUES[card.rarity] || 1; }

function sellCard(cardId) {
  const itemIndex = inventory.findIndex(item => item.cardId === cardId);
  if (itemIndex < 0) return;
  const card = cards.find(card => card.id === cardId);
  if (!card) return;
  const saleValue = getSellValue(card);
  inventory[itemIndex].quantity -= 1;
  if (inventory[itemIndex].quantity <= 0) inventory.splice(itemIndex, 1);
  coins += saleValue;
  saveInventory(); saveCoins(); renderInventory();
  elements.status.textContent = `${card.name} vendida por ${saleValue} Moon.`;
}

function resetCoins() { coins = INITIAL_MOONS; saveCoins(); elements.status.textContent = `Moon restaurada para ${INITIAL_MOONS}.`; }

async function initialize() {
  loadCoins(); loadInventory(); loadHistory(); await loadCards(); renderInventory(); renderHistory();
  elements.openButton.addEventListener("click", openBooster); elements.resetButton.addEventListener("click", resetCoins);
  elements.addButton.addEventListener("click", addToInventory); elements.againButton.addEventListener("click", openBooster);
  elements.menuToggle.addEventListener("click", () => { const open = elements.nav.classList.toggle("open"); elements.menuToggle.setAttribute("aria-expanded", open); });
  document.querySelectorAll(".nav-links a").forEach(link => link.addEventListener("click", () => elements.nav.classList.remove("open")));
}

initialize();


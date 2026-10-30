// ── State ────────────────────────────────────────────────────────────────────
let transactions   = JSON.parse(localStorage.getItem("txns")       || "[]");
let customCats     = JSON.parse(localStorage.getItem("customCats") || "[]");
let spendingLimit  = parseFloat(localStorage.getItem("spendingLimit") || "0");
let chartInstance  = null;
let activeFilter   = "All";
let activeChart    = "expense"; // "expense" | "income"

// Default categories (always present)
const DEFAULT_CATEGORIES = [
  { value: "Food",      label: "🍔 Food" },
  { value: "Transport", label: "🚌 Transport" },
  { value: "Fun",       label: "🎮 Fun" },
  { value: "Income",    label: "💼 Income" },
  { value: "Other",     label: "📦 Other" },
];

// Color palette — defaults + auto-generated for custom cats
const BASE_COLORS = {
  Food:      "#2f80ed",
  Transport: "#27ae60",
  Fun:       "#f2994a",
  Income:    "#9b51e0",
  Other:     "#eb5757",
};
// Extra colors for custom categories (cycles if more than palette length)
const EXTRA_PALETTE = [
  "#00b4d8","#e63946","#2dc653","#ff6b6b","#ffd166",
  "#06d6a0","#118ab2","#ef476f","#8ecae6","#a8dadc",
];

function getCategoryColor(catValue) {
  if (BASE_COLORS[catValue]) return BASE_COLORS[catValue];
  const idx = customCats.indexOf(catValue);
  return EXTRA_PALETTE[idx % EXTRA_PALETTE.length] || "#aaa";
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const balanceEl       = document.getElementById("total-balance");
const listEl          = document.getElementById("transaction-list");
const formEl          = document.getElementById("transaction-form");
const errorEl         = document.getElementById("form-error");
const chartCanvas     = document.getElementById("spending-chart");
const chartToggleBtns = document.querySelectorAll(".chart-toggle-btn");
const chartTitleEl    = document.getElementById("chart-title");
const incomeEl        = document.getElementById("summary-income");
const expenseEl       = document.getElementById("summary-expense");
const themeToggle     = document.getElementById("theme-toggle");
const filterNav       = document.getElementById("filter-nav");
const categorySelect  = document.getElementById("category");

// Spending Limit DOM
const limitForm           = document.getElementById("limit-form");
const limitInput          = document.getElementById("spending-limit");
const limitDisplay        = document.getElementById("current-limit-display");
const limitWarningEl      = document.getElementById("limit-warning");
const limitWarningTextEl  = document.getElementById("limit-warning-text");
const balanceCard         = document.querySelector(".balance-card");

// Custom Category DOM
const catForm      = document.getElementById("category-form");
const newCatInput  = document.getElementById("new-category");
const catErrorEl   = document.getElementById("cat-error");
const customCatList = document.getElementById("custom-category-list");

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // Migrate: drop old data without 'datetime' field
  const hasOldData = transactions.some(t => !t.datetime);
  if (hasOldData) {
    transactions = [];
    localStorage.removeItem("txns");
  }
  // Apply saved theme
  if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark");
    if (themeToggle) themeToggle.textContent = "☀️ Light Mode";
  }
  // Populate category dropdown & filter buttons
  rebuildCategoryUI();
  // Show current limit
  renderLimitDisplay();
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  renderBalance();
  renderSummary();
  renderList();
  renderChart();
  renderLimitWarning();
}

function renderBalance() {
  const total     = transactions.reduce((sum, t) => sum + t.amount, 0);
  const formatted = formatCurrency(total);
  balanceEl.textContent = formatted;
  balanceEl.classList.remove("pulse");
  void balanceEl.offsetWidth;
  balanceEl.classList.add("pulse");
  balanceEl.classList.toggle("balance-negative", total < 0);
}

function renderSummary() {
  const income  = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  if (incomeEl)  incomeEl.textContent  = formatCurrency(income);
  if (expenseEl) expenseEl.textContent = formatCurrency(expense);
}

function renderList() {
  const visible = activeFilter === "All"
    ? transactions
    : transactions.filter(t => t.category === activeFilter);
  listEl.innerHTML = "";
  if (visible.length === 0) {
    listEl.innerHTML = `<li class="empty">No transactions yet.</li>`;
    return;
  }
  visible.slice().reverse().forEach((t, idx) => {
    const li       = document.createElement("li");
    li.className   = "tx-item";
    li.style.animationDelay = `${idx * 40}ms`;
    const isIncome = t.amount > 0;

    // Highlight: mark expense items that alone exceed the limit
    const overLimit = spendingLimit > 0 && !isIncome && Math.abs(t.amount) > spendingLimit;

    li.innerHTML = `
      <div class="tx-info">
        <span class="tx-name">${escapeHtml(t.name)}</span>
        <span class="tx-amount ${isIncome ? "income" : "expense"}${overLimit ? " over-limit-amount" : ""}">
          ${isIncome ? "+" : ""}${formatCurrency(t.amount)}
        </span>
        <span class="tx-category">${escapeHtml(t.category)}</span>
      </div>
      <div class="tx-actions">
        <span class="tx-date">${t.date}</span>
        <button class="delete-btn" data-id="${t.id}" title="Delete">✕</button>
      </div>
    `;
    listEl.appendChild(li);
    requestAnimationFrame(() => li.classList.add("visible"));
  });
}

function renderChart() {
  const isExpense = activeChart === "expense";
  const grouped   = {};
  transactions.forEach(t => {
    if (isExpense ? t.amount < 0 : t.amount > 0) {
      grouped[t.category] = (grouped[t.category] || 0) + Math.abs(t.amount);
    }
  });
  const labels = Object.keys(grouped);
  const data   = Object.values(grouped);
  const colors = labels.map(l => getCategoryColor(l));

  if (chartTitleEl) {
    chartTitleEl.textContent = isExpense ? "Spending by Category" : "Income by Category";
  }
  if (chartInstance) chartInstance.destroy();

  const emptySlot = chartCanvas.parentElement.querySelector(".chart-empty");
  if (labels.length === 0) {
    if (!emptySlot) {
      const msg       = document.createElement("p");
      msg.className   = "empty chart-empty";
      msg.textContent = isExpense ? "No spending data yet." : "No income data yet.";
      chartCanvas.parentElement.appendChild(msg);
    } else {
      emptySlot.textContent = isExpense ? "No spending data yet." : "No income data yet.";
    }
    chartCanvas.style.display = "none";
    return;
  }
  chartCanvas.style.display = "";
  if (emptySlot) emptySlot.remove();

  chartInstance = new Chart(chartCanvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: document.body.classList.contains("dark") ? "#1e1e2e" : "#fff",
        hoverOffset: 8,
      }],
    },
    options: {
      animation: { animateRotate: true, duration: 600, easing: "easeInOutQuart" },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: document.body.classList.contains("dark") ? "#ccc" : "#444",
            padding: 12,
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

// ── Spending Limit ────────────────────────────────────────────────────────────
function renderLimitDisplay() {
  if (!limitDisplay) return;
  if (spendingLimit > 0) {
    limitDisplay.textContent = `Current limit: ${formatCurrency(spendingLimit)}`;
    if (limitInput) limitInput.value = spendingLimit;
  } else {
    limitDisplay.textContent = "No limit set.";
  }
}

function renderLimitWarning() {
  if (!limitWarningEl || !limitWarningTextEl || !balanceCard) return;
  const totalExpense = transactions
    .filter(t => t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  if (spendingLimit <= 0) {
    limitWarningEl.hidden = true;
    balanceCard.classList.remove("over-limit", "near-limit");
    return;
  }

  const ratio = totalExpense / spendingLimit;

  if (ratio >= 1) {
    // Over limit
    limitWarningEl.hidden = false;
    limitWarningTextEl.textContent =
      `Over limit! Total spending ${formatCurrency(totalExpense)} exceeds limit of ${formatCurrency(spendingLimit)}.`;
    balanceCard.classList.add("over-limit");
    balanceCard.classList.remove("near-limit");
  } else if (ratio >= 0.8) {
    // Near limit (≥80%)
    limitWarningEl.hidden = false;
    limitWarningTextEl.textContent =
      `Heads up! You've used ${Math.round(ratio * 100)}% of your ${formatCurrency(spendingLimit)} limit.`;
    balanceCard.classList.add("near-limit");
    balanceCard.classList.remove("over-limit");
  } else {
    limitWarningEl.hidden = true;
    balanceCard.classList.remove("over-limit", "near-limit");
  }
}

if (limitForm) {
  limitForm.addEventListener("submit", e => {
    e.preventDefault();
    const val = parseFloat(limitInput.value);
    if (isNaN(val) || val < 0) {
      limitInput.value = "";
      return;
    }
    spendingLimit = val;
    localStorage.setItem("spendingLimit", spendingLimit);
    renderLimitDisplay();
    renderLimitWarning();
    showToast(val === 0 ? "Spending limit cleared." : `Limit set to ${formatCurrency(val)}!`);
  });
}

// ── Custom Categories ─────────────────────────────────────────────────────────

/** Build all category options in the <select> and filter buttons */
function rebuildCategoryUI() {
  const allCats = getAllCategories();

  // --- Category <select> ---
  if (categorySelect) {
    const prev = categorySelect.value;
    categorySelect.innerHTML = `<option value="">-- Select --</option>`;
    allCats.forEach(cat => {
      const opt = document.createElement("option");
      opt.value       = cat.value;
      opt.textContent = cat.label;
      categorySelect.appendChild(opt);
    });
    // Restore selection if still valid
    if (prev && allCats.some(c => c.value === prev)) {
      categorySelect.value = prev;
    }
  }

  // --- Filter buttons ---
  if (filterNav) {
    filterNav.innerHTML = "";
    // "All" button
    const allBtn = makeFilterBtn("All", activeFilter === "All");
    filterNav.appendChild(allBtn);
    allCats.forEach(cat => {
      const btn = makeFilterBtn(cat.value, activeFilter === cat.value);
      filterNav.appendChild(btn);
    });
  }

  // --- Custom category list (manage panel) ---
  renderCustomCatList();
}

function makeFilterBtn(label, isActive) {
  const btn = document.createElement("button");
  btn.className   = "filter-btn" + (isActive ? " active" : "");
  btn.dataset.filter = label;
  btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  btn.textContent = label;
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    activeFilter = label;
    renderList();
  });
  return btn;
}

function renderCustomCatList() {
  if (!customCatList) return;
  customCatList.innerHTML = "";
  if (customCats.length === 0) {
    customCatList.innerHTML = `<li class="empty">No custom categories yet.</li>`;
    return;
  }
  customCats.forEach((cat, idx) => {
    const li = document.createElement("li");
    li.className = "custom-cat-item";
    const color = EXTRA_PALETTE[idx % EXTRA_PALETTE.length];
    li.innerHTML = `
      <span class="cat-dot" style="background:${color}"></span>
      <span class="cat-name">${escapeHtml(cat)}</span>
      <button class="delete-btn delete-cat-btn" data-cat="${escapeHtml(cat)}" title="Delete category">✕</button>
    `;
    customCatList.appendChild(li);
  });
}

// Add custom category
if (catForm) {
  catForm.addEventListener("submit", e => {
    e.preventDefault();
    catErrorEl.textContent = "";
    const raw  = newCatInput.value.trim();
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);

    if (!name) return;
    // Check duplicate (case-insensitive)
    const all = getAllCategories().map(c => c.value.toLowerCase());
    if (all.includes(name.toLowerCase())) {
      catErrorEl.textContent = `"${name}" already exists.`;
      catErrorEl.classList.remove("shake");
      void catErrorEl.offsetWidth;
      catErrorEl.classList.add("shake");
      return;
    }
    customCats.push(name);
    saveCustomCats();
    newCatInput.value = "";
    rebuildCategoryUI();
    showToast(`Category "${name}" added!`);
  });
}

// Delete custom category (event delegation on the list)
if (customCatList) {
  customCatList.addEventListener("click", e => {
    const btn = e.target.closest(".delete-cat-btn");
    if (!btn) return;
    const cat = btn.dataset.cat;
    // If transactions use this category, warn first
    const inUse = transactions.some(t => t.category === cat);
    if (inUse) {
      const confirmed = confirm(
        `"${cat}" is used by existing transactions. Deleting it won't remove those transactions, but the category will no longer appear in filters. Delete anyway?`
      );
      if (!confirmed) return;
    }
    customCats = customCats.filter(c => c !== cat);
    if (activeFilter === cat) activeFilter = "All";
    saveCustomCats();
    rebuildCategoryUI();
    renderList();
    renderChart();
    showToast(`Category "${cat}" deleted.`);
  });
}

function getAllCategories() {
  const customs = customCats.map(c => ({ value: c, label: c }));
  return [...DEFAULT_CATEGORIES, ...customs];
}

function saveCustomCats() {
  localStorage.setItem("customCats", JSON.stringify(customCats));
}

// ── Add Transaction ───────────────────────────────────────────────────────────
formEl.addEventListener("submit", e => {
  e.preventDefault();
  errorEl.textContent = "";
  const nameInput     = document.getElementById("item-name");
  const amountInput   = document.getElementById("amount");
  const typeInput     = document.getElementById("tx-type");

  const name     = nameInput.value.trim();
  const amount   = parseFloat(amountInput.value);
  const category = categorySelect.value;
  const type     = typeInput ? typeInput.value : "expense";

  if (!name)                        return showError("Please enter an item name.");
  if (isNaN(amount) || amount <= 0) return showError("Please enter a valid amount.");
  if (!category)                    return showError("Please select a category.");

  const finalAmount = type === "income" ? Math.abs(amount) : -Math.abs(amount);
  const now = new Date();
  const tx = {
    id:       now.getTime(),
    name,
    amount:   finalAmount,
    category,
    datetime: now.toISOString(),
    date: now.toLocaleString("id-ID", {
      day:    "2-digit",
      month:  "short",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
  transactions.push(tx);
  save();
  render();
  formEl.reset();
  showToast(`"${name}" added!`);
});

// ── Delete Transaction ────────────────────────────────────────────────────────
listEl.addEventListener("click", e => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const li = btn.closest(".tx-item");
  li.classList.add("removing");
  li.addEventListener("animationend", () => {
    transactions = transactions.filter(t => t.id !== id);
    save();
    render();
  }, { once: true });
});

// ── Chart Toggle (Expense / Income) ──────────────────────────────────────────
chartToggleBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    chartToggleBtns.forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
    activeChart = btn.dataset.chart;
    renderChart();
  });
});

// ── Dark Mode ─────────────────────────────────────────────────────────────────
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    themeToggle.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
    themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    renderChart();
  });
}

// ── Toast Notification ────────────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast       = document.createElement("div");
  toast.className   = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 2400);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("shake");
  void errorEl.offsetWidth;
  errorEl.classList.add("shake");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCurrency(val) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(val);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function save() {
  localStorage.setItem("txns", JSON.stringify(transactions));
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();

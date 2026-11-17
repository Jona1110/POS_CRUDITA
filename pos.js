// =========================================================================
// CONFIGURACIÓN DE CONEXIÓN CON GOOGLE SHEETS (APPS SCRIPT)
// =========================================================================
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysr4bbuBKbkaTNRYuUpe4P1OsuC_qpLAebi-_r_C0NPG9VJwIc4MKbHtmcGh158cBYYQ/exec";

// =========================================================================
// MESAS BASE DEL SALÓN (COMPATIBLE 100% CON KDS.JS)
// =========================================================================
const defaultTables = [
    { id: 1, name: "Mesa 1", zone: "Salón Principal", capacity: 4, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 2, name: "Mesa 2", zone: "Salón Principal", capacity: 4, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 3, name: "Mesa 3", zone: "Salón Principal", capacity: 6, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 4, name: "Mesa 4", zone: "Salón Principal", capacity: 6, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 5, name: "Mesa 5", zone: "Terraza", capacity: 4, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 6, name: "Mesa 6", zone: "Terraza", capacity: 4, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 7, name: "Mesa 7", zone: "Terraza Familiar", capacity: 8, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 8, name: "Mesa 8", zone: "Terraza Familiar", capacity: 8, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 9, name: "Barra 1", zone: "Barra Mariscos", capacity: 2, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] },
    { id: 10, name: "Barra 2", zone: "Barra Mariscos", capacity: 2, status: "libre", waiter: "", guests: 0, clientNote: "", openedAt: null, items: [] }
];

function normalizeTableStatus(rawStatus) {
    const s = String(rawStatus || "libre").toLowerCase().trim();
    if (s === "ocupada") return "ocupada";
    if (s === "cuenta" || s === "cuenta solicitada") return "cuenta";
    return "libre";
}

// El menú inicia vacío y se alimenta directamente desde Google Sheets (Catalogo_Menu)
let state = {
    products: JSON.parse(localStorage.getItem("crudita_products")) || [],
    tables: JSON.parse(localStorage.getItem("crudita_tables")) || defaultTables,
    orders: JSON.parse(localStorage.getItem("crudita_orders")) || [],
    expenses: JSON.parse(localStorage.getItem("crudita_expenses")) || [],
    coupons: JSON.parse(localStorage.getItem("crudita_coupons")) || [
        { code: "CRUDITA10", user: "Promo Bienvenida", prize: "10% de Descuento", type: "percent", value: 10, used: false }
    ],
    shift: JSON.parse(localStorage.getItem("crudita_shift")) || { isOpen: false, openingCash: 0, openedAt: null },
    kdsTickets: JSON.parse(localStorage.getItem("crudita_kds")) || []
};

let cart = [];
let linkedTableId = null;
let currentCategory = "Todos";
let currentTableZone = "Todas";
let currentMode = "Mostrador";
let currentPayment = "Efectivo";
let appliedCoupon = null;
let weeklyChartInstance = null;
let paymentChartInstance = null;
let isSyncingMenu = true;

function saveState() {
    localStorage.setItem("crudita_products", JSON.stringify(state.products));
    localStorage.setItem("crudita_tables", JSON.stringify(state.tables));
    localStorage.setItem("crudita_orders", JSON.stringify(state.orders));
    localStorage.setItem("crudita_expenses", JSON.stringify(state.expenses));
    localStorage.setItem("crudita_coupons", JSON.stringify(state.coupons));
    localStorage.setItem("crudita_shift", JSON.stringify(state.shift));
    localStorage.setItem("crudita_kds", JSON.stringify(state.kdsTickets));
}

// =========================================================================
// INICIALIZACIÓN, NAVEGACIÓN Y SINCRONIZACIÓN EN TIEMPO REAL CON SHEETS
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    setupFilters();
    renderCategoryPillsPOS();
    renderCatalogPOS();
    renderPOSTables();
    renderDeliveries();
    renderCashControl();
    renderCatalogAdmin();
    renderCouponsTable();
    updateDashboard("semana");

    // Descargar catálogo, mesas y comandas desde Google Sheets al iniciar
    syncCloudState();

    // Sincronización automática cada 6 segundos
    setInterval(syncCloudState, 6000);

    // Sincronización instantánea entre pestañas del mismo navegador
    window.addEventListener("storage", (e) => {
        if (e.key === "crudita_tables" || e.key === "crudita_kds" || e.key === "crudita_products") {
            state.tables = JSON.parse(localStorage.getItem("crudita_tables")) || defaultTables;
            state.kdsTickets = JSON.parse(localStorage.getItem("crudita_kds")) || [];
            state.products = JSON.parse(localStorage.getItem("crudita_products")) || [];
            renderPOSTables();
            renderCategoryPillsPOS();
            renderCatalogPOS();
            renderCatalogAdmin();
        }
    });
});

async function syncCloudState() {
    if (!GOOGLE_SCRIPT_URL) return;
    const syncBadge = document.getElementById("sync-status");
    try {
        const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getEstadoCompleto&t=${Date.now()}`);
        const data = await res.json();
        if (data.status === "ok") {
            isSyncingMenu = false;

            // 1. Catálogo 100% desde la pestaña Catalogo_Menu de Google Sheets
            if (Array.isArray(data.products)) {
                state.products = data.products;
            }

            // 2. Mesas abiertas y cuentas solicitadas desde KDS / Meseros
            if (Array.isArray(data.tables) && data.tables.length > 0) {
                state.tables = defaultTables.map(defT => {
                    const cloudT = data.tables.find(ct => Number(ct.id) === Number(defT.id) || String(ct.name).trim() === defT.name);
                    if (!cloudT) return defT;
                    return {
                        ...defT,
                        ...cloudT,
                        id: defT.id,
                        status: normalizeTableStatus(cloudT.status),
                        items: Array.isArray(cloudT.items) ? cloudT.items : []
                    };
                });
            }

            saveState();
            renderCategoryPillsPOS();
            renderCatalogPOS();
            renderCatalogAdmin();
            renderPOSTables();
            if (syncBadge) syncBadge.innerHTML = `<i class="fa-solid fa-cloud-check"></i> Sincronizado`;
        }
    } catch (err) {
        isSyncingMenu = false;
        console.warn("Error sincronizando con Google Sheets:", err);
        if (syncBadge) syncBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sin conexión a Sheets`;
    }
}

function setupNavigation() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!btn.dataset.tab) return;
            document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
            btn.classList.add("active");
            const target = btn.dataset.tab;
            document.getElementById(`tab-${target}`).classList.add("active");

            if (target === "mesas") {
                renderPOSTables();
                syncCloudState();
            }
            if (target === "dashboard") updateDashboard("semana");
            if (target === "caja") renderCashControl();
            if (target === "domicilio") renderDeliveries();
            if (target === "catalogo") renderCatalogAdmin();
        });
    });
}

// =========================================================================
// MÓDULO 1A: PUNTO DE VENTA RÁPIDO (POS)
// =========================================================================
function setupFilters() {
    document.querySelectorAll("#pos-zone-filters .cat-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll("#pos-zone-filters .cat-pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            currentTableZone = pill.dataset.zone;
            renderPOSTables();
        });
    });

    document.getElementById("pos-search").addEventListener("input", renderCatalogPOS);
}

function renderCategoryPillsPOS() {
    const container = document.getElementById("category-filters");
    if (!container) return;

    const categories = ["Todos", ...new Set(state.products.map(p => p.category).filter(Boolean))];
    if (!categories.includes(currentCategory)) currentCategory = "Todos";

    container.innerHTML = categories.map(cat => `
        <button class="cat-pill ${currentCategory === cat ? 'active' : ''}" onclick="setPOSCategory('${cat}')">${cat}</button>
    `).join("");
}

function setPOSCategory(cat) {
    currentCategory = cat;
    renderCategoryPillsPOS();
    renderCatalogPOS();
}

function renderCatalogPOS() {
    const query = document.getElementById("pos-search").value.toLowerCase();
    const grid = document.getElementById("pos-products-grid");

    if (state.products.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fa-solid fa-cloud-arrow-down"></i><p>${isSyncingMenu ? 'Cargando menú desde Google Sheets...' : 'No hay platillos registrados en la hoja Catalogo_Menu.'}</p></div>`;
        return;
    }

    const filtered = state.products.filter(p => {
        const matchCat = currentCategory === "Todos" || p.category === currentCategory;
        const matchText = p.name.toLowerCase().includes(query) || (p.desc || "").toLowerCase().includes(query);
        return matchCat && matchText;
    });

    grid.innerHTML = filtered.map(p => `
        <div class="prod-card ${p.active ? '' : 'sold-out'}" onclick="addToCart(${p.id})">
            <div>
                <span class="prod-cat-tag">${p.category} ${!p.active ? '• AGOTADO' : ''}</span>
                <h4>${p.name}</h4>
                <p>${p.desc || ''}</p>
            </div>
            <div class="prod-footer">
                <span class="prod-price">$${Number(p.price).toFixed(2)}</span>
                <i class="fa-solid fa-circle-plus" style="color: var(--primary); font-size: 1.2rem;"></i>
            </div>
        </div>
    `).join("");
}

function selectOrderMode(mode, btn) {
    currentMode = mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    if (btn) {
        btn.classList.add("active");
    } else {
        const targetBtn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
        if (targetBtn) targetBtn.classList.add("active");
    }

    const deliveryBox = document.getElementById("delivery-extra-fields");
    const deliveryRow = document.getElementById("t-delivery-row");
    if (mode === "Domicilio") {
        deliveryBox.classList.remove("hidden");
        deliveryRow.style.display = "flex";
    } else {
        deliveryBox.classList.add("hidden");
        deliveryRow.style.display = "none";
    }
    updateCartTotals();
}

function selectPayment(method, btn) {
    currentPayment = method;
    document.querySelectorAll(".pay-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("cash-calculator").style.display = method === "Efectivo" ? "flex" : "none";
}

function addToCart(productId) {
    const prod = state.products.find(p => Number(p.id) === Number(productId));
    if (!prod || !prod.active) return;

    const existing = cart.find(item => Number(item.id) === Number(productId));
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ id: prod.id, name: prod.name, price: Number(prod.price), qty: 1, note: "" });
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cart-items-list");
    const banner = document.getElementById("linked-table-banner");
    const btnProcess = document.getElementById("btn-process-order");

    if (linkedTableId !== null) {
        const tbl = state.tables.find(t => Number(t.id) === Number(linkedTableId));
        banner.classList.remove("hidden");
        document.getElementById("linked-table-text").innerText = `Cobrando ${tbl ? tbl.name : 'Mesa ' + linkedTableId} (${tbl?.waiter || 'Salón'})`;
        btnProcess.innerHTML = `<i class="fa-solid fa-check-circle"></i> Cobrar y Liberar Mesa`;
    } else {
        banner.classList.add("hidden");
        btnProcess.innerHTML = `<i class="fa-solid fa-check-circle"></i> Cobrar y Enviar a Cocina`;
    }

    if (cart.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-basket-shopping"></i><p>Selecciona platillos o carga una mesa abierta</p></div>`;
        updateCartTotals();
        return;
    }

    container.innerHTML = cart.map((item, idx) => `
        <div class="cart-row">
            <div class="cart-row-info">
                <strong>${item.name}</strong>
                <small>$${Number(item.price).toFixed(2)} c/u • Subtotal: $${(Number(item.price) * item.qty).toFixed(2)}</small>
                <input type="text" class="note-input" placeholder="Nota cocina (ej. sin cebolla, salsa aparte)" 
                    value="${item.note || ''}" onchange="updateItemNote(${idx}, this.value)">
            </div>
            <div class="qty-controls">
                <button onclick="changeCartQty(${idx}, -1)">-</button>
                <span>${item.qty}</span>
                <button onclick="changeCartQty(${idx}, 1)">+</button>
            </div>
        </div>
    `).join("");

    updateCartTotals();
}

function updateItemNote(index, val) {
    cart[index].note = val;
}

function changeCartQty(index, delta) {
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    renderCart();
}

function unlinkTableFromCart() {
    linkedTableId = null;
    document.getElementById("order-customer-name").value = "";
    renderCart();
}

function clearCart() {
    cart = [];
    linkedTableId = null;
    appliedCoupon = null;
    document.getElementById("order-customer-name").value = "";
    document.getElementById("coupon-input").value = "";
    document.getElementById("coupon-feedback").innerText = "";
    document.getElementById("cash-received").value = "";
    renderCart();
}

function applyCoupon() {
    const code = document.getElementById("coupon-input").value.trim().toUpperCase();
    const feedback = document.getElementById("coupon-feedback");
    const found = state.coupons.find(c => c.code === code);

    if (!found) {
        feedback.style.color = "var(--danger)";
        feedback.innerText = "Cupón no válido o inexistente.";
        appliedCoupon = null;
    } else if (found.used) {
        feedback.style.color = "var(--danger)";
        feedback.innerText = "Este cupón ya fue canjeado anteriormente.";
        appliedCoupon = null;
    } else {
        appliedCoupon = found;
        feedback.style.color = "var(--success)";
        feedback.innerText = `¡Aplicado! ${found.prize}`;
    }
    updateCartTotals();
}

function getCartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (Number(item.price) * item.qty), 0);
    const deliveryFee = currentMode === "Domicilio" ? parseFloat(document.getElementById("order-delivery-zone").value || 0) : 0;
    let discount = 0;

    if (appliedCoupon && subtotal > 0) {
        if (appliedCoupon.type === "percent") discount = subtotal * (appliedCoupon.value / 100);
        if (appliedCoupon.type === "fixed") discount = Math.min(subtotal, appliedCoupon.value);
    }

    const total = Math.max(0, subtotal + deliveryFee - discount);
    return { subtotal, deliveryFee, discount, total };
}

function updateCartTotals() {
    const { subtotal, deliveryFee, discount, total } = getCartTotals();
    document.getElementById("t-subtotal").innerText = `$${subtotal.toFixed(2)}`;
    document.getElementById("t-delivery").innerText = `$${deliveryFee.toFixed(2)}`;
    
    const discRow = document.getElementById("t-discount-row");
    if (discount > 0) {
        discRow.style.display = "flex";
        document.getElementById("t-discount").innerText = `-$${discount.toFixed(2)}`;
    } else {
        discRow.style.display = "none";
    }

    document.getElementById("t-total").innerText = `$${total.toFixed(2)}`;
    calculateChange();
    updateMobileCartFab();
}

function calculateChange() {
    const { total } = getCartTotals();
    const received = parseFloat(document.getElementById("cash-received").value || 0);
    const change = Math.max(0, received - total);
    document.getElementById("cash-change").innerText = `$${change.toFixed(2)}`;
}

function pushTicketToKDS({ source, reference, waiter, items }) {
    const ticket = {
        id: "KDS-" + Date.now().toString().slice(-6),
        source,
        reference,
        waiter,
        items,
        status: "Pendiente",
        createdAt: new Date().toISOString()
    };
    state.kdsTickets.push(ticket);
    saveState();
    syncToGoogleSheets("crearTicketKDS", ticket);
}

function processOrder() {
    if (cart.length === 0) return alert("Agrega al menos un platillo a la orden.");
    
    const { subtotal, deliveryFee, discount, total } = getCartTotals();
    const customerName = document.getElementById("order-customer-name").value.trim() || "Cliente Mostrador";
    const phone = document.getElementById("order-customer-phone").value.trim();
    const address = document.getElementById("order-customer-address").value.trim();
    const driver = document.getElementById("order-driver").value;
    const cashReceived = parseFloat(document.getElementById("cash-received").value || total);

    if (currentMode === "Domicilio" && !address) {
        return alert("Por favor ingresa la dirección de entrega en El Salto.");
    }

    const isTableCheckout = linkedTableId !== null;
    const linkedTableObj = isTableCheckout ? state.tables.find(t => Number(t.id) === Number(linkedTableId)) : null;

    const newOrder = {
        folio: "TC-" + String(state.orders.length + 101),
        timestamp: new Date().toISOString(),
        dateReadable: new Date().toLocaleString("es-MX"),
        dayOfWeek: new Date().toLocaleDateString("es-MX", { weekday: "long" }),
        mode: isTableCheckout ? `Salón (${linkedTableObj?.name || 'Mesa ' + linkedTableId})` : currentMode,
        customer: customerName,
        phone,
        address,
        driver: currentMode === "Domicilio" ? driver : "N/A",
        deliveryStatus: currentMode === "Domicilio" ? "En Ruta" : "Completado",
        changeCarried: currentMode === "Domicilio" && currentPayment === "Efectivo" ? Math.max(0, cashReceived - total) : 0,
        items: [...cart],
        subtotal,
        deliveryFee,
        discount,
        total,
        paymentMethod: currentPayment
    };

    if (appliedCoupon) {
        const cIndex = state.coupons.findIndex(c => c.code === appliedCoupon.code);
        if (cIndex !== -1) state.coupons[cIndex].used = true;
    }

    state.orders.unshift(newOrder);
    saveState();
    syncToGoogleSheets("registrarVenta", newOrder);

    if (isTableCheckout && linkedTableObj) {
        releaseTableAfterCheckout(linkedTableObj.id);
    } else {
        pushTicketToKDS({
            source: newOrder.mode,
            reference: `${newOrder.folio} • ${newOrder.customer}`,
            waiter: "Caja POS",
            items: newOrder.items
        });
    }

    showReceipt(newOrder, cashReceived);
    clearCart();
    renderDeliveries();
    renderCouponsTable();
}

function showReceipt(order, cashReceived) {
    const box = document.getElementById("receipt-printable");
    box.innerHTML = `
        <div style="text-align:center; border-bottom:1px dashed #000; padding-bottom:8px; margin-bottom:8px;">
            <img src="img/logo.jpeg" alt="Logo Tostaderia La Crudita" style="width:75px; height:75px; border-radius:50%; object-fit:cover; margin-bottom:4px;" onerror="this.style.display='none'"><br>
            <strong>TOSTADERIA LA CRUDITA</strong><br>
            <small>Emiliano Zapata #72, El Salto, Jal.</small><br>
            <small>Tel: 33 1330 1961</small><br>
            <small>Folio: ${order.folio} | ${order.dateReadable}</small>
        </div>
        <div style="font-size:0.82rem; margin-bottom:8px;">
            <strong>Modalidad:</strong> ${order.mode}<br>
            <strong>Cliente:</strong> ${order.customer}<br>
            ${order.mode === "Domicilio" ? `<strong>Dir:</strong> ${order.address}<br><strong>Repartidor:</strong> ${order.driver}<br>` : ''}
        </div>
        <div style="border-top:1px dashed #000; border-bottom:1px dashed #000; padding:6px 0; font-size:0.82rem;">
            ${order.items.map(i => `
                <div style="display:flex; justify-content:space-between;">
                    <span>${i.qty}x ${i.name}</span>
                    <span>$${(i.qty * Number(i.price)).toFixed(2)}</span>
                </div>
                ${i.note ? `<small style="color:#555;">  * ${i.note}</small><br>` : ''}
            `).join("")}
        </div>
        <div style="font-size:0.85rem; margin-top:8px; text-align:right;">
            <div>Subtotal: $${order.subtotal.toFixed(2)}</div>
            ${order.deliveryFee > 0 ? `<div>Envío: $${order.deliveryFee.toFixed(2)}</div>` : ''}
            ${order.discount > 0 ? `<div>Descuento: -$${order.discount.toFixed(2)}</div>` : ''}
            <strong style="font-size:1.05rem;">TOTAL: $${order.total.toFixed(2)}</strong><br>
            <small>Pago: ${order.paymentMethod} ${order.paymentMethod === 'Efectivo' ? `(Cambio: $${Math.max(0, cashReceived - order.total).toFixed(2)})` : ''}</small>
        </div>
        <div style="text-align:center; margin-top:12px; font-size:0.75rem;">
            ¡Gracias por tu preferencia!<br>
            Etiquétanos en FB/IG @TostaderiaLaCrudita
        </div>
    `;
    document.getElementById("receipt-modal").classList.remove("hidden");
}

function closeReceiptModal() {
    document.getElementById("receipt-modal").classList.add("hidden");
}

// =========================================================================
// MÓDULO DE MESAS EN SALÓN (SINCRONIZADO CON PANEL DE MESEROS KDS)
// =========================================================================
function renderPOSTables() {
    const occupiedTables = state.tables.filter(t => normalizeTableStatus(t.status) !== "libre");
    const billRequestedTables = state.tables.filter(t => normalizeTableStatus(t.status) === "cuenta");

    const badge = document.getElementById("tables-badge");
    if (badge) {
        badge.innerText = occupiedTables.length;
        if (billRequestedTables.length > 0) {
            badge.classList.add("alert-pulse");
        } else {
            badge.classList.remove("alert-pulse");
        }
    }

    const kpiOcupadas = document.getElementById("kpi-mesas-ocupadas");
    const kpiCuentas = document.getElementById("kpi-cuentas-pedidas");
    const kpiSalon = document.getElementById("kpi-consumo-salon");

    if (kpiOcupadas) kpiOcupadas.innerText = occupiedTables.length;
    if (kpiCuentas) kpiCuentas.innerText = billRequestedTables.length;
    if (kpiSalon) {
        const salonSum = occupiedTables.reduce((sum, t) => {
            return sum + (t.items || []).reduce((s, i) => s + (Number(i.price) * i.qty), 0);
        }, 0);
        kpiSalon.innerText = `$${salonSum.toFixed(2)}`;
    }

    const grid = document.getElementById("pos-tables-grid");
    if (!grid) return;

    const filtered = state.tables.filter(t => currentTableZone === "Todas" || t.zone === currentTableZone);

    grid.innerHTML = filtered.map(table => {
        const st = normalizeTableStatus(table.status);
        const items = Array.isArray(table.items) ? table.items : [];
        const total = items.reduce((s, i) => s + (Number(i.price) * i.qty), 0);

        let cardClass = "free";
        let badgeClass = "free";
        let badgeText = "Libre";

        if (st === "ocupada") {
            cardClass = "occupied";
            badgeClass = "occupied";
            badgeText = "Ocupada";
        } else if (st === "cuenta") {
            cardClass = "bill-requested";
            badgeClass = "bill-requested";
            badgeText = "Cuenta Solicitada";
        }

        return `
            <div class="pos-table-card ${cardClass}">
                <div>
                    <div class="pt-header">
                        <div>
                            <h3>${table.name}</h3>
                            <span class="pt-zone">${table.zone} • Cap. ${table.capacity} pers.</span>
                        </div>
                        <span class="pt-badge ${badgeClass}">${badgeText}</span>
                    </div>

                    ${st === "libre" ? `
                        <p class="muted-text" style="margin: 18px 0;">Mesa disponible para asignar en salón.</p>
                    ` : `
                        <div class="pt-meta">
                            <div><i class="fa-solid fa-user-tie"></i> Mesero: <strong>${table.waiter || 'Sin asignar'}</strong> • ${table.guests || 1} comensales</div>
                            ${table.clientNote ? `<div style="margin-top:3px;"><i class="fa-solid fa-comment"></i> Ref: ${table.clientNote}</div>` : ''}
                        </div>

                        <ul class="pt-items-list">
                            ${items.length > 0 ? items.map(it => `
                                <li>
                                    <span><strong>${it.qty}x</strong> ${it.name}</span>
                                    <span>$${(it.qty * Number(it.price)).toFixed(2)}</span>
                                </li>
                            `).join("") : `<li class="muted-text">Sin platillos cargados aún</li>`}
                        </ul>
                    `}
                </div>

                ${st !== "libre" ? `
                    <div class="pt-footer">
                        <span class="pt-total">$${total.toFixed(2)}</span>
                        <button class="${st === 'cuenta' ? 'btn-success' : 'btn-primary'}" onclick="loadTableToPOS(${table.id})">
                            <i class="fa-solid fa-cash-register"></i> Cargar a Caja y Cobrar
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join("");
}

function loadTableToPOS(tableId) {
    const table = state.tables.find(t => Number(t.id) === Number(tableId));
    if (!table) return;

    if (!table.items || table.items.length === 0) {
        if (!confirm(`${table.name} no tiene platillos registrados aún. ¿Deseas abrirla en Caja de todas formas?`)) return;
    }

    cart = (table.items || []).map(it => ({
        id: it.id,
        name: it.name,
        price: Number(it.price),
        qty: it.qty,
        note: it.note || ""
    }));

    linkedTableId = Number(table.id);
    selectOrderMode("Mostrador");

    const refLabel = table.clientNote ? `${table.name} - ${table.clientNote}` : `${table.name} (Mesero: ${table.waiter || 'Salón'})`;
    document.getElementById("order-customer-name").value = refLabel;

    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
    document.querySelector('.nav-btn[data-tab="pos"]').classList.add("active");
    document.getElementById("tab-pos").classList.add("active");

    renderCart();
    setTimeout(scrollToTicketMobile, 120);
}

function releaseTableAfterCheckout(tableId) {
    const idx = state.tables.findIndex(t => Number(t.id) === Number(tableId));
    if (idx === -1) return;

    state.tables[idx] = {
        ...state.tables[idx],
        status: "libre",
        waiter: "",
        guests: 0,
        clientNote: "",
        openedAt: null,
        items: []
    };

    saveState();
    renderPOSTables();
    syncToGoogleSheets("guardarEstadoMesa", state.tables[idx]);
}

// =========================================================================
// MÓDULO 1B: GESTIÓN DE SERVICIO A DOMICILIO Y REPARTIDORES
// =========================================================================
function renderDeliveries() {
    const deliveries = state.orders.filter(o => o.mode === "Domicilio");
    const activeDeliveries = deliveries.filter(d => d.deliveryStatus === "En Ruta");

    document.getElementById("delivery-badge").innerText = activeDeliveries.length;
    document.getElementById("kpi-en-ruta").innerText = activeDeliveries.length;

    const pendingAmount = activeDeliveries.reduce((sum, d) => sum + d.total, 0);
    document.getElementById("kpi-por-liquidar").innerText = `$${pendingAmount.toFixed(2)}`;

    const grid = document.getElementById("deliveries-list");
    if (deliveries.length === 0) {
        grid.innerHTML = `<div class="panel-card"><p class="muted-text">No hay pedidos a domicilio registrados aún.</p></div>`;
        return;
    }

    grid.innerHTML = deliveries.map(d => `
        <div class="delivery-card ${d.deliveryStatus === 'Liquidado' ? 'delivered' : ''}">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <strong>${d.folio} • ${d.customer}</strong>
                <span class="status-pill ${d.deliveryStatus === 'Liquidado' ? 'open' : 'closed'}">${d.deliveryStatus}</span>
            </div>
            <p style="font-size:0.85rem; margin-bottom:4px;"><i class="fa-solid fa-location-dot"></i> ${d.address}</p>
            <p style="font-size:0.85rem; margin-bottom:4px;"><i class="fa-solid fa-phone"></i> ${d.phone || 'Sin teléfono'}</p>
            <p style="font-size:0.85rem; margin-bottom:8px;"><i class="fa-solid fa-helmet-safety"></i> <strong>${d.driver}</strong> | Cambio enviado: $${d.changeCarried.toFixed(2)}</p>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:8px;">
                <strong style="color:var(--primary); font-size:1.05rem;">Cobrar: $${d.total.toFixed(2)} (${d.paymentMethod})</strong>
                ${d.deliveryStatus === 'En Ruta' ? `<button class="btn-primary" onclick="markDeliverySettled('${d.folio}')">Confirmar Liquidación</button>` : '<small>Entregado ✓</small>'}
            </div>
        </div>
    `).join("");
}

function markDeliverySettled(folio) {
    const idx = state.orders.findIndex(o => o.folio === folio);
    if (idx !== -1) {
        state.orders[idx].deliveryStatus = "Liquidado";
        saveState();
        renderDeliveries();
    }
}

// =========================================================================
// MÓDULO 1C: DASHBOARD FINANCIERO COMPLETO (SEMANAL Y MENSUAL)
// =========================================================================
function updateDashboard(period, btn) {
    if (btn) {
        document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }

    const now = new Date();
    const daysLimit = period === "semana" ? 7 : 30;
    const filteredOrders = state.orders.filter(o => {
        const diffDays = (now - new Date(o.timestamp)) / (1000 * 60 * 60 * 24);
        return diffDays <= daysLimit;
    });

    const totalSales = filteredOrders.reduce((s, o) => s + o.total, 0);
    const avgTicket = filteredOrders.length ? totalSales / filteredOrders.length : 0;

    document.getElementById("dash-total-sales").innerText = `$${totalSales.toFixed(2)}`;
    document.getElementById("dash-orders-count").innerText = `${filteredOrders.length} órdenes completadas`;
    document.getElementById("dash-avg-ticket").innerText = `$${avgTicket.toFixed(2)}`;

    const productCounts = {};
    filteredOrders.forEach(o => {
        o.items.forEach(i => {
            productCounts[i.name] = (productCounts[i.name] || 0) + i.qty;
        });
    });

    const sortedProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]);
    if (sortedProducts.length > 0) {
        document.getElementById("dash-top-product").innerText = sortedProducts[0][0];
        document.getElementById("dash-top-product-qty").innerText = `${sortedProducts[0][1]} unidades vendidas`;
    }

    const rankingList = document.getElementById("top-products-ranking");
    rankingList.innerHTML = sortedProducts.slice(0, 5).map(([name, qty], i) => `
        <li><span><strong>#${i + 1}</strong> ${name}</span><strong>${qty} vendidos</strong></li>
    `).join("") || "<li>Sin ventas registradas en este periodo</li>";

    const recentTable = document.getElementById("recent-sales-table");
    recentTable.innerHTML = filteredOrders.slice(0, 10).map(o => `
        <tr>
            <td><strong>${o.folio}</strong></td>
            <td>${o.dateReadable}</td>
            <td>${o.mode}</td>
            <td>${o.customer}</td>
            <td>${o.paymentMethod}</td>
            <td><strong>$${o.total.toFixed(2)}</strong></td>
        </tr>
    `).join("");

    renderCharts(filteredOrders);
}

function renderCharts(orders) {
    const daysLabels = ["Lunes", "Martes", "Miércoles", "Jueves (Juebebes)", "Viernes", "Sábado", "Domingo"];
    const daysTotals = [0, 0, 0, 0, 0, 0, 0];

    orders.forEach(o => {
        const d = new Date(o.timestamp).getDay();
        const mappedIndex = d === 0 ? 6 : d - 1;
        daysTotals[mappedIndex] += o.total;
    });

    const ctxWeekly = document.getElementById("weeklySalesChart").getContext("2d");
    if (weeklyChartInstance) weeklyChartInstance.destroy();
    weeklyChartInstance = new Chart(ctxWeekly, {
        type: "bar",
        data: {
            labels: daysLabels,
            datasets: [{
                label: "Ventas ($ MXN)",
                data: daysTotals,
                backgroundColor: ["#0096c7", "#0096c7", "#0096c7", "#e85d04", "#023e8a", "#023e8a", "#023e8a"],
                borderRadius: 6
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });

    const payTotals = { Efectivo: 0, Transferencia: 0, Tarjeta: 0 };
    orders.forEach(o => {
        payTotals[o.paymentMethod] = (payTotals[o.paymentMethod] || 0) + o.total;
    });

    const ctxPay = document.getElementById("paymentMethodsChart").getContext("2d");
    if (paymentChartInstance) paymentChartInstance.destroy();
    paymentChartInstance = new Chart(ctxPay, {
        type: "doughnut",
        data: {
            labels: ["Efectivo", "Transferencia", "Tarjeta"],
            datasets: [{
                data: [payTotals.Efectivo, payTotals.Transferencia, payTotals.Tarjeta],
                backgroundColor: ["#16a34a", "#023e8a", "#e85d04"]
            }]
        },
        options: { responsive: true }
    });
}

// =========================================================================
// MÓDULO 1D: CONTROL DE CAJA, ARQUEO Y GASTOS
// =========================================================================
function openShift() {
    const amount = parseFloat(document.getElementById("opening-cash-input").value || 0);
    state.shift = { isOpen: true, openingCash: amount, openedAt: new Date().toLocaleString("es-MX") };
    saveState();
    renderCashControl();
}

function closeShift() {
    if (!state.shift.isOpen) return alert("No hay un turno abierto actualmente.");
    if (confirm("¿Confirmas realizar el corte de caja y cerrar el turno actual?")) {
        state.shift = { isOpen: false, openingCash: 0, openedAt: null };
        saveState();
        renderCashControl();
        alert("Corte de caja realizado correctamente.");
    }
}

function addExpense(e) {
    e.preventDefault();
    const concept = document.getElementById("exp-concept").value.trim();
    const category = document.getElementById("exp-category").value;
    const amount = parseFloat(document.getElementById("exp-amount").value);

    const newExp = { id: Date.now(), concept, category, amount, date: new Date().toLocaleTimeString("es-MX") };
    state.expenses.unshift(newExp);
    saveState();
    syncToGoogleSheets("registrarGasto", newExp);

    e.target.reset();
    renderCashControl();
}

function renderCashControl() {
    const indicator = document.getElementById("shift-indicator");
    if (state.shift.isOpen) {
        indicator.className = "status-pill open";
        indicator.innerHTML = `<i class="fa-solid fa-circle"></i> Turno Abierto`;
    } else {
        indicator.className = "status-pill closed";
        indicator.innerHTML = `<i class="fa-solid fa-circle"></i> Turno Cerrado`;
    }

    const cashSales = state.orders.filter(o => o.paymentMethod === "Efectivo").reduce((s, o) => s + o.total, 0);
    const digitalSales = state.orders.filter(o => o.paymentMethod !== "Efectivo").reduce((s, o) => s + o.total, 0);
    const totalExpenses = state.expenses.reduce((s, e) => s + e.amount, 0);
    const expectedCash = state.shift.openingCash + cashSales - totalExpenses;

    document.getElementById("arq-fondo").innerText = `$${state.shift.openingCash.toFixed(2)}`;
    document.getElementById("arq-ventas-efectivo").innerText = `$${cashSales.toFixed(2)}`;
    document.getElementById("arq-ventas-digital").innerText = `$${digitalSales.toFixed(2)}`;
    document.getElementById("arq-gastos").innerText = `-$${totalExpenses.toFixed(2)}`;
    document.getElementById("arq-esperado").innerText = `$${expectedCash.toFixed(2)}`;

    const expList = document.getElementById("expenses-list");
    expList.innerHTML = state.expenses.map(ex => `
        <li><span><strong>[${ex.category}]</strong> ${ex.concept} <small>(${ex.date})</small></span><strong style="color:var(--danger);">-$${ex.amount.toFixed(2)}</strong></li>
    `).join("") || "<li class='muted-text'>Sin gastos registrados hoy</li>";
}

// =========================================================================
// MÓDULO 1E: ADMINISTRADOR DE MENÚ Y DISPONIBILIDAD (CRUD EN SHEETS)
// =========================================================================
function renderCatalogAdmin() {
    const tbody = document.getElementById("catalog-admin-table");
    if (state.products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">No hay platillos registrados en Google Sheets. Haz clic en "+ Nuevo Platillo".</td></tr>`;
        return;
    }

    tbody.innerHTML = state.products.map(p => `
        <tr>
            <td><strong>${p.name}</strong><br><small style="color:var(--text-muted);">${p.desc || 'Sin descripción'}</small></td>
            <td>${p.category}</td>
            <td><strong>$${Number(p.price).toFixed(2)}</strong></td>
            <td>
                <button class="status-pill ${p.active ? 'open' : 'closed'}" style="border:none; cursor:pointer;" onclick="toggleProductStatus(${p.id})">
                    ${p.active ? 'Disponible ✓' : 'Agotado ✕'}
                </button>
            </td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button class="btn-secondary" onclick="editProduct(${p.id})" title="Editar platillo"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon-danger" onclick="deleteProduct(${p.id})" title="Eliminar platillo"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
        </tr>
    `).join("");
}

function toggleProductStatus(id) {
    const idx = state.products.findIndex(p => Number(p.id) === Number(id));
    if (idx !== -1) {
        state.products[idx].active = !state.products[idx].active;
        saveState();
        renderCatalogAdmin();
        renderCatalogPOS();
        syncToGoogleSheets("guardarProducto", state.products[idx]);
    }
}

function openNewProductModal() {
    document.getElementById("modal-title").innerText = "Agregar Nuevo Platillo";
    document.getElementById("edit-prod-id").value = "";
    document.getElementById("edit-prod-name").value = "";
    document.getElementById("edit-prod-cat").value = "Aguachiles";
    document.getElementById("edit-prod-price").value = "";
    document.getElementById("edit-prod-desc").value = "";
    document.getElementById("product-modal").classList.remove("hidden");
}

function editProduct(id) {
    const p = state.products.find(item => Number(item.id) === Number(id));
    if (!p) return;
    document.getElementById("modal-title").innerText = "Editar Platillo";
    document.getElementById("edit-prod-id").value = p.id;
    document.getElementById("edit-prod-name").value = p.name;
    document.getElementById("edit-prod-cat").value = p.category;
    document.getElementById("edit-prod-price").value = p.price;
    document.getElementById("edit-prod-desc").value = p.desc || "";
    document.getElementById("product-modal").classList.remove("hidden");
}

function closeProductModal() {
    document.getElementById("product-modal").classList.add("hidden");
}

function saveProduct(e) {
    e.preventDefault();
    const id = document.getElementById("edit-prod-id").value;
    const name = document.getElementById("edit-prod-name").value.trim();
    const category = document.getElementById("edit-prod-cat").value;
    const price = parseFloat(document.getElementById("edit-prod-price").value);
    const desc = document.getElementById("edit-prod-desc").value.trim();

    let productRecord;

    if (id) {
        const idx = state.products.findIndex(p => Number(p.id) === Number(id));
        if (idx !== -1) {
            state.products[idx] = { ...state.products[idx], name, category, price, desc };
            productRecord = state.products[idx];
        }
    } else {
        productRecord = { id: Date.now(), name, category, price, desc, active: true };
        state.products.push(productRecord);
    }

    saveState();
    closeProductModal();
    renderCategoryPillsPOS();
    renderCatalogAdmin();
    renderCatalogPOS();

    if (productRecord) {
        syncToGoogleSheets("guardarProducto", productRecord);
    }
}

function deleteProduct(id) {
    const prod = state.products.find(p => Number(p.id) === Number(id));
    if (!prod) return;

    if (!confirm(`¿Seguro que deseas eliminar "${prod.name}" del menú permanentemente?`)) return;

    state.products = state.products.filter(p => Number(p.id) !== Number(id));
    saveState();
    renderCategoryPillsPOS();
    renderCatalogAdmin();
    renderCatalogPOS();
    syncToGoogleSheets("eliminarProducto", { id });
}

// =========================================================================
// MÓDULO 1F: RULETA VIRTUAL Y CUPONES ("PRESUME TU CRUDITA")
// =========================================================================
const prizesPool = [
    { prize: "15% de Descuento en tu orden", type: "percent", value: 15 },
    { prize: "Tostada de Ceviche Gratis ($65)", type: "fixed", value: 65 },
    { prize: "10% de Descuento en Charolas", type: "percent", value: 10 },
    { prize: "Bebida Preparada Gratis ($55)", type: "fixed", value: 55 },
    { prize: "$50 MXN de regalo en tu compra", type: "fixed", value: 50 }
];

function spinPrizeWheel() {
    const handle = document.getElementById("winner-handle").value.trim();
    if (!handle) return alert("Escribe el nombre o @usuario del participante antes de girar.");

    const display = document.getElementById("wheel-result-box");
    display.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Girando ruleta...`;

    setTimeout(() => {
        const selected = prizesPool[Math.floor(Math.random() * prizesPool.length)];
        const randomCode = "CRUDITA-" + Math.floor(1000 + Math.random() * 9000);

        const newCoupon = {
            code: randomCode,
            user: handle,
            prize: selected.prize,
            type: selected.type,
            value: selected.value,
            used: false
        };

        state.coupons.unshift(newCoupon);
        saveState();
        renderCouponsTable();

        display.innerHTML = `
            🎉 ¡Ganador: ${handle}!<br>
            <span style="color:var(--primary);">${selected.prize}</span><br>
            <small>Cupón único generado: <strong>${randomCode}</strong></small>
        `;
        document.getElementById("winner-handle").value = "";
    }, 900);
}

function renderCouponsTable() {
    const tbody = document.getElementById("coupons-table");
    tbody.innerHTML = state.coupons.map(c => `
        <tr>
            <td><strong>${c.code}</strong></td>
            <td>${c.user}</td>
            <td>${c.prize}</td>
            <td><span class="status-pill ${c.used ? 'closed' : 'open'}">${c.used ? 'Canjeado' : 'Activo'}</span></td>
        </tr>
    `).join("");
}

// =========================================================================
// CONTROLES TÁCTILES PARA CELULAR (SCROLL A TICKET / CATÁLOGO)
// =========================================================================
function updateMobileCartFab() {
    const fab = document.getElementById("mobile-cart-fab");
    if (!fab) return;

    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const { total } = getCartTotals();

    if (totalItems > 0) {
        fab.classList.remove("hidden-fab");
        document.getElementById("fab-items-count").innerText = `${totalItems} art.`;
        document.getElementById("fab-total-amount").innerText = `$${total.toFixed(2)}`;
    } else {
        fab.classList.add("hidden-fab");
    }
}

function scrollToTicketMobile() {
    const ticket = document.querySelector(".pos-ticket");
    if (ticket) ticket.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToCatalogMobile() {
    const catalog = document.querySelector(".pos-catalog");
    if (catalog) catalog.scrollIntoView({ behavior: "smooth", block: "start" });
}

// =========================================================================
// SINCRONIZACIÓN CON GOOGLE SHEETS (APPS SCRIPT)
// =========================================================================
async function syncToGoogleSheets(action, payload) {
    if (!GOOGLE_SCRIPT_URL) return;
    const syncBadge = document.getElementById("sync-status");
    syncBadge.innerHTML = `<i class="fa-solid fa-rotate fa-spin"></i> Guardando...`;

    try {
        await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({ action, payload })
        });
        syncBadge.innerHTML = `<i class="fa-solid fa-cloud-check"></i> Sincronizado`;
    } catch (err) {
        console.error("Error al sincronizar con Google Sheets:", err);
        syncBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Error de Red`;
    }
}

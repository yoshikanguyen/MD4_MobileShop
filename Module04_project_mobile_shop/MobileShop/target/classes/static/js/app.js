'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const money = value => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
}).format(Number(value || 0));
const dateTime = value => value ? new Date(value).toLocaleString('vi-VN') : '';
const statusNames = {
    ACTIVE: 'Active',
    INACTIVE: 'Deactivate',
    PENDING: 'Chờ xác nhận',
    CONFIRMING: 'Đã xác nhận',
    SHIPPING: 'Đang giao',
    COMPLETED: 'Hoàn tất',
    CANCELED: 'Đã hủy'
};
const invoiceSteps = {PENDING: 'CONFIRMING', CONFIRMING: 'SHIPPING', SHIPPING: 'COMPLETED'};
const nav = {dashboard: 'Dashboard', customers: 'Customer', products: 'Products', invoices: 'Invoices'};
const main = $('#main-content');
const csrfToken = $('meta[name="_csrf"]')?.content;
const csrfHeader = $('meta[name="_csrf_header"]')?.content || 'X-CSRF-TOKEN';
const state = {
    products: {page: 0, size: 10, brand: '', minPrice: '', maxPrice: '', minStock: '', sortBy: 'id', direction: 'desc'},
    customers: {page: 0, size: 10, keyword: ''},
    invoices: {page: 0, size: 10, customer: '', date: ''}
};
let currentView = 'dashboard', revenueGroup = 'month', products = [], customers = [], invoices = [];
let productOptions = [], customerOptions = [], draft = [], draftCustomerId = '', tempPreviewUrl = null;
let pages = {products: null, customers: null, invoices: null}, toastTimer;

async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {...(options.headers || {})};
    if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
        headers['Content-Type'] = 'application/json';
        options = {...options, body: JSON.stringify(options.body)};
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers[csrfHeader] = csrfToken;
    const response = await fetch(url, {...options, headers, credentials: 'same-origin'});
    if (response.redirected && response.url.includes('/login')) {
        location.href = '/login';
        throw new Error('Phiên đăng nhập đã hết hạn');
    }
    if (!response.ok) {
        let data = {};
        try {
            data = await response.json();
        } catch {
        }
        throw new Error(data.message || data.detail || `Yêu cầu thất bại: HTTP ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
}

function toast(message, isError = false) {
    const t = $('#toast');
    t.textContent = message;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = '', 4500);
}

const badge = s => `<span class="pill ${s === 'ACTIVE' || s === 'COMPLETED' ? 'pill-green' : s === 'INACTIVE' || s === 'CANCELED' ? 'pill-red' : s === 'PENDING' ? 'pill-amber' : 'pill-blue'}">${esc(statusNames[s] || s)}</span>`;
const heading = (title, subtitle) => `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1><p class="sub-title">${esc(subtitle)}</p></div></div>`;
const empty = cols => `<tr><td class="empty" colspan="${cols}">Không có dữ liệu phù hợp.</td></tr>`;
const table = (heads, rows) => `<div class="panel table-wrap"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
const btn = (action, id, text, variant = 'secondary') => `<button class="${variant} btn-small" data-action="${action}" data-id="${id}">${text}</button>`;
const chosen = (id, match) => String(id) === String(match) ? 'selected' : '';
const productIcon = p => `<div class="mini-product">${p.imageUrl?.startsWith('/uploads/') ? `<img src="${esc(p.imageUrl)}" alt="Ảnh điện thoại" loading="lazy">` : '☎'}</div>`;
const field = (label, name, type = 'text', value = '', required = true, extra = '') => `<label class="field"><span>${esc(label)} ${required ? '*' : ''}</span><input name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></label>`;
const renderFormBtns = () => '<div class="form-actions"><button class="secondary" type="button" data-action="close-modal">Hủy</button><button class="primary" type="submit">Lưu</button></div>';
const paramsOf = obj => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
        if (v !== '' && v !== null && v !== undefined) p.set(k, v);
    }
    return p.toString();
};

function pagination(meta, view) {
    if (!meta) return '';
    const n = meta.number, pagesCount = meta.totalPages;
    const start = meta.totalElements ? n * meta.size + 1 : 0;
    const end = Math.min((n + 1) * meta.size, meta.totalElements);
    return `<div class="pagination panel"><span>Hiển thị <b>${start}–${end}</b> / <b>${meta.totalElements}</b> bản ghi</span>
   <div class="button-group"><button class="secondary btn-small" data-action="page-prev" ${n === 0 ? 'disabled' : ''}>← Trước</button>
   <span>Trang ${pagesCount ? n + 1 : 0}/${pagesCount}</span>
   <button class="secondary btn-small" data-action="page-next" ${n >= pagesCount - 1 ? 'disabled' : ''}>Sau →</button></div></div>`;
}

async function go(view) {
    currentView = view;
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    main.innerHTML = heading(nav[view], 'Đang tải dữ liệu...');
    await refresh();
}

async function refresh() {
    try {
        if (currentView === 'dashboard') await loadDashboard();
        if (currentView === 'products') {
            const data = await api('/api/products?' + paramsOf(state.products));
            if (data.totalPages > 0 && state.products.page >= data.totalPages) {
                state.products.page = data.totalPages - 1;
                return refresh();
            }
            products = data.content;
            pages.products = data;
            renderProducts();
        }
        if (currentView === 'customers') {
            const data = await api('/api/customers?' + paramsOf(state.customers));
            if (data.totalPages > 0 && state.customers.page >= data.totalPages) {
                state.customers.page = data.totalPages - 1;
                return refresh();
            }
            customers = data.content;
            pages.customers = data;
            renderCustomers();
        }
        if (currentView === 'invoices') {
            const data = await api('/api/invoices?' + paramsOf(state.invoices));
            if (data.totalPages > 0 && state.invoices.page >= data.totalPages) {
                state.invoices.page = data.totalPages - 1;
                return refresh();
            }
            invoices = data.content;
            pages.invoices = data;
            renderInvoices();
        }
    } catch (e) {
        main.innerHTML = heading('Lỗi tải dữ liệu', e.message);
        toast(e.message, true);
    }
}

function renderProducts() {
    const s = state.products;
    const rows = products.map((p, i) => `<tr>
   <td>${s.page * s.size + i + 1}</td><td><div class="product-cell">${productIcon(p)}<span class="cell-main">${esc(p.name)}</span></div></td>
   <td>${esc(p.brand)}</td><td>${money(p.price)}</td><td>${Number(p.stock)}</td><td>${badge(p.status)}</td>
   <td><div class="button-group">${btn('edit-product', p.id, 'Sửa')}${btn('toggle-product', p.id, p.status === 'ACTIVE' ? 'Ngừng bán' : 'Kích hoạt')}${btn('delete-product', p.id, 'Xóa', 'danger')}</div></td></tr>`).join('');
    main.innerHTML = heading('Products', 'Quản lý điện thoại, giá bán và hàng tồn') +
        `<form class="filter-panel panel" id="product-filter-form">
    <label>Brand (tìm gần đúng)<input name="brand" placeholder="Ví dụ: Sam" value="${esc(s.brand)}"></label>
    <label>Giá từ (VNĐ)<input name="minPrice" type="number" min="0" step="1000" value="${esc(s.minPrice)}" placeholder="Min"></label>
    <label>Giá đến (VNĐ)<input name="maxPrice" type="number" min="0" step="1000" value="${esc(s.maxPrice)}" placeholder="Max"></label>
    <label>Tồn kho tối thiểu<input name="minStock" type="number" min="0" step="1" value="${esc(s.minStock)}" placeholder="VD: 5"></label>
    <label>Sắp xếp<select name="sortBy"><option value="id" ${chosen('id', s.sortBy)}>Mới nhất</option><option value="name" ${chosen('name', s.sortBy)}>Tên</option><option value="price" ${chosen('price', s.sortBy)}>Giá</option><option value="stock" ${chosen('stock', s.sortBy)}>Tồn kho</option></select></label>
    <label>Chiều<select name="direction"><option value="desc" ${chosen('desc', s.direction)}>Giảm dần</option><option value="asc" ${chosen('asc', s.direction)}>Tăng dần</option></select></label>
    <button class="secondary" type="submit">Tìm kiếm / Lọc</button><button class="secondary" type="button" data-action="reset-products">Đặt lại</button>
  </form><div class="list-actions"><span>Danh sách điện thoại</span><button class="primary" data-action="add-product">+ Add Product</button></div>` +
        table(['STT', 'Name', 'Brand', 'Price', 'Stock', 'Status', 'Actions'], rows || empty(7)) + pagination(pages.products, 'products');
}

function renderCustomers() {
    const s = state.customers;
    const rows = customers.map((c, i) => `<tr><td>${s.page * s.size + i + 1}</td><td><span class="cell-main">${esc(c.name)}</span></td>
    <td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td>${badge(c.active ? 'ACTIVE' : 'INACTIVE')}</td>
    <td><div class="button-group">${btn('edit-customer', c.id, 'Sửa')}${btn('toggle-customer', c.id, c.active ? 'Khóa' : 'Mở')}${btn('delete-customer', c.id, 'Xóa', 'danger')}</div></td></tr>`).join('');
    main.innerHTML = heading('Customer', 'Danh sách và hồ sơ khách hàng') +
        `<form class="toolbar" id="customer-filter-form"><input class="search" type="search" name="keyword" value="${esc(s.keyword)}" placeholder="Tìm tên, email, số điện thoại..." aria-label="Tìm khách hàng"><button class="secondary" type="submit">Tìm kiếm</button><button class="primary" type="button" data-action="add-customer">+ Add User</button></form>` +
        table(['STT', 'Name', 'Email', 'Phone', 'Address', 'Status', 'Actions'], rows || empty(7)) + pagination(pages.customers, 'customers');
}

function renderInvoices() {
    const s = state.invoices;
    const rows = invoices.map((i, k) => `<tr><td>${s.page * s.size + k + 1}</td><td>#${i.id}</td><td><span class="cell-main">${esc(i.customerName)}</span></td>
    <td>${dateTime(i.createdAt)}</td><td>${money(i.totalAmount)}</td><td>${badge(i.status)}</td><td><div class="button-group">${btn('view-invoice', i.id, 'Chi tiết')}${invoiceSteps[i.status] ? btn('advance-invoice', i.id, 'Tiếp theo') : ''}${i.status !== 'CANCELED' ? btn('cancel-invoice', i.id, 'Hủy', 'danger') : ''}</div></td></tr>`).join('');
    main.innerHTML = heading('Invoices', 'Theo dõi hóa đơn và trạng thái đơn hàng') +
        `<form class="toolbar invoice-filter" id="invoice-filter-form"><input class="search" type="search" name="customer" value="${esc(s.customer)}" placeholder="Tên khách hàng (gần đúng)..."><input type="date" name="date" value="${esc(s.date)}" aria-label="Ngày lập hóa đơn"><button class="secondary" type="submit">Tìm kiếm</button><button type="button" class="secondary" data-action="reset-invoices">Xóa lọc</button><button class="primary" type="button" data-action="add-invoice">+ Add Invoice</button></form>` +
        table(['STT', 'Mã hóa đơn', 'Customer Name', 'Created At', 'Total Amount', 'Status', 'Actions'], rows || empty(7)) + pagination(pages.invoices, 'invoices');
}

async function loadDashboard() {
    const [summary, revenue, cs, is] = await Promise.all([
        api('/api/dashboard'), api('/api/dashboard/revenue?groupBy=' + revenueGroup),
        api('/api/customers?size=5'), api('/api/invoices?size=5')]);
    const recent = cs.content.map(c => `<div class="recent-row"><span><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></span>${badge(c.active ? 'ACTIVE' : 'INACTIVE')}</div>`).join('');
    const recentInvoice = is.content.map(i => `<div class="recent-row"><span><strong>Hóa đơn #${i.id} · ${esc(i.customerName)}</strong><small>${new Date(i.createdAt).toLocaleDateString('vi-VN')}</small></span>${money(i.totalAmount)}</div>`).join('');
    const series = revenue.series || [], last = series.slice(-12),
        max = Math.max(1, ...last.map(x => Number(x.revenue)));
    const chart = last.map(x => `<div class="bar" style="height:${Math.max(3, Number(x.revenue) / max * 100)}%" title="${esc(x.period)}: ${money(x.revenue)}"><span>${esc(x.period)}</span></div>`).join('');
    main.innerHTML = heading('Dashboard', 'Tổng quan hoạt động của cửa hàng Mobile SHOP') +
        `<section class="stat-grid">
    <div class="panel stat"><span class="stat-icon">♙</span><div class="muted">Customers</div><div class="stat-value">${summary.customers}</div></div>
    <div class="panel stat"><span class="stat-icon">▣</span><div class="muted">Products</div><div class="stat-value">${summary.products}</div></div>
    <div class="panel stat"><span class="stat-icon">▤</span><div class="muted">Invoices</div><div class="stat-value">${summary.invoices}</div></div>
    <div class="panel stat"><span class="stat-icon">₫</span><div class="muted">Doanh thu đã hoàn thành</div><div class="stat-value">${money(summary.revenue)}</div></div>
  </section><div class="dashboard-grid">
    <section class="panel dash-panel"><h2>Sales Report</h2>
      <div class="revenue-actions"><label>Thống kê doanh thu
        <select id="revenue-group"><option value="day" ${chosen('day', revenueGroup)}>Theo ngày</option><option value="month" ${chosen('month', revenueGroup)}>Theo tháng</option><option value="year" ${chosen('year', revenueGroup)}>Theo năm</option></select></label></div>
      ${last.length ? `<div class="bar-chart">${chart}</div>` : '<p class="muted">Chưa có hóa đơn hoàn thành.</p>'}
      <p class="footer-note">Doanh thu thực tế từ hóa đơn hoàn thành. Biểu đồ hiển thị tối đa 12 kỳ gần nhất.</p>
      <div class="revenue-table"><table><thead><tr><th>Kỳ</th><th class="number">Doanh thu (VNĐ)</th></tr></thead><tbody>
      ${series.length ? series.map(x => `<tr><td>${esc(x.period)}</td><td class="number">${money(x.revenue)}</td></tr>`).join('') : empty(2)}</tbody></table></div>
    </section>
    <section class="panel dash-panel"><h2>Recent Customers</h2><div class="recent-list">${recent || '<p class="muted">Chưa có khách hàng.</p>'}</div></section>
    <section class="panel dash-panel"><h2>Transactions</h2><div class="recent-list">${recentInvoice || '<p class="muted">Chưa có hóa đơn.</p>'}</div></section>
  </div>`;
}

function openModal(title, body, wide = false) {
    closeModal();
    $('#modal-root').innerHTML = `<div class="modal-overlay"><div class="modal ${wide ? 'wide-modal' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="close-modal" data-action="close-modal" aria-label="Đóng">×</button></div><div class="modal-body">${body}</div></div></div>`;
    $('.modal input:not([type=hidden]):not([type=file]),.modal select')?.focus();
}

function closeModal() {
    if (tempPreviewUrl) {
        URL.revokeObjectURL(tempPreviewUrl);
        tempPreviewUrl = null;
    }
    $('#modal-root').innerHTML = '';
}

function productModal(id) {
    const p = id ? products.find(x => x.id === Number(id)) : null;
    const img = p?.imageUrl?.startsWith('/uploads/') ? p.imageUrl : '';
    openModal(p ? 'Edit Product' : 'Add Product', `<form id="product-form" data-id="${p?.id || ''}"><div class="form-grid">
    ${field('Name', 'name', 'text', p?.name || '', true, 'maxlength="160"')}
    ${field('Brand', 'brand', 'text', p?.brand || '', true, 'maxlength="90"')}
    ${field('Price (VNĐ)', 'price', 'number', p?.price ?? '', true, 'min="0" step="1000"')}
    ${field('Stock', 'stock', 'number', p?.stock ?? 0, true, 'min="0" step="1"')}
    <label class="field wide"><span>Ảnh sản phẩm — chọn từ máy tính</span>
      <input name="image" id="product-image" type="file" accept="image/jpeg,image/png">
      <small class="hint">Chọn ảnh JPG hoặc PNG, tối đa 5 MB. Để trống khi sửa nếu muốn giữ ảnh cũ.</small>
      <img id="image-preview" class="image-preview" src="${esc(img)}" alt="Xem trước ảnh sản phẩm" ${img ? '' : 'hidden'}>
    </label>
    <label class="field wide"><span>Status</span><select name="status"><option value="ACTIVE" ${chosen('ACTIVE', p?.status || 'ACTIVE')}>Active</option><option value="INACTIVE" ${chosen('INACTIVE', p?.status)}>Deactivate</option></select></label>
    </div>${renderFormBtns()}</form>`);
}

function customerModal(id) {
    const c = id ? customers.find(x => x.id === Number(id)) : null;
    openModal(c ? 'Edit Customer' : 'Add Customer', `<form id="customer-form" data-id="${c?.id || ''}"><div class="form-grid">
    ${field('Name', 'name', 'text', c?.name || '', true, 'maxlength="120"')}
    ${field('Email', 'email', 'email', c?.email || '', true, 'maxlength="160"')}
    ${field('Phone', 'phone', 'tel', c?.phone || '', true, 'maxlength="20"')}
    ${field('Address', 'address', 'text', c?.address || '', true, 'maxlength="255"')}
    <label class="field wide"><span>Status</span><select name="active"><option value="true" ${chosen('true', c?.active === false ? 'false' : 'true')}>Active</option><option value="false" ${chosen('false', c?.active === false ? 'false' : 'true')}>Deactivate</option></select></label>
    </div>${renderFormBtns()}</form>`);
}

function confirmDelete(kind, id) {
    openModal('Xác nhận xóa', `<p>Bạn có chắc chắn muốn xóa ${kind === 'product' ? 'điện thoại' : 'khách hàng'} này?</p>
    <p class="hint">Dữ liệu đã được sử dụng trong hóa đơn sẽ không được xóa để giữ lịch sử bán hàng.</p>
    <div class="form-actions"><button class="secondary" data-action="close-modal">Hủy</button><button class="danger" data-action="confirm-delete" data-kind="${kind}" data-id="${id}">OK — Xóa</button></div>`);
}

function invoiceModal() {
    const selectCustomer = `<label class="field"><span>Customer *</span><select id="invoice-customer" required><option value="">-- Chọn khách hàng --</option>${customerOptions.filter(c => c.active).map(c => `<option value="${c.id}" ${chosen(c.id, draftCustomerId)}>${esc(c.name)} (${esc(c.phone)})</option>`).join('')}</select></label>`;
    const rows = draft.map((it, i) => {
        const p = productOptions.find(p => p.id === Number(it.productId));
        return `<tr><td>${i + 1}</td><td>${esc(p?.name || 'Không tồn tại')}</td><td>${esc(p?.brand || '')}</td><td>${it.quantity}</td><td>${money(p?.price)}</td><td>${money(Number(p?.price || 0) * it.quantity)}</td><td><div class="button-group">${btn('edit-line', i, 'Sửa')}${btn('remove-line', i, 'Xóa', 'danger')}</div></td></tr>`;
    }).join('');
    const total = draft.reduce((sum, it) => sum + Number(productOptions.find(p => p.id === Number(it.productId))?.price || 0) * it.quantity, 0);
    openModal('FORM INVOICE', `<div class="form-grid">${selectCustomer}</div><div class="draft-actions"><h3 style="margin:0">INVOICE DETAIL</h3><button class="secondary" data-action="add-line">+ Add Invoice detail</button></div>
    ${table(['STT', 'Product Name', 'Brand', 'Quantity', 'Price', 'Total', 'Actions'], rows || empty(7))}
    <div class="draft-total">Total Amount: ${money(total)}</div><div class="form-actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" data-action="save-invoice">Save</button></div>`, true);
}

function lineModal(index = null) {
    const line = index === null ? null : draft[index];
    const options = productOptions.filter(p => (p.status === 'ACTIVE' && p.stock > 0) || p.id === Number(line?.productId)).map(p => `<option value="${p.id}" ${chosen(p.id, line?.productId)}>${esc(p.name)} · Tồn ${p.stock}</option>`).join('');
    openModal(index === null ? 'Add Invoice detail' : 'Edit Invoice detail', `<form id="line-form" data-index="${index ?? ''}"><div class="form-grid"><label class="field"><span>Product Name *</span><select required name="productId"><option value="">-- Chọn điện thoại --</option>${options}</select></label>
    ${field('Quantity', 'quantity', 'number', line?.quantity ?? 1, true, 'min="1" step="1"')}</div><div class="form-actions"><button class="secondary" type="button" data-action="back-invoice">Quay lại hóa đơn</button><button class="primary" type="submit">Save</button></div></form>`);
}

async function viewInvoice(id) {
    const i = await api('/api/invoices/' + id);
    const rows = i.items.map((it, k) => `<tr><td>${k + 1}</td><td>${esc(it.productName)}</td><td>${esc(it.brand)}</td><td>${it.quantity}</td><td>${money(it.unitPrice)}</td><td>${money(it.lineTotal)}</td></tr>`).join('');
    openModal(`Invoice detail #${i.id}`, `<p><b>Khách hàng:</b> ${esc(i.customerName)} · <b>Ngày:</b> ${dateTime(i.createdAt)}</p><p><b>Trạng thái:</b> ${badge(i.status)}</p>
    ${table(['STT', 'Product Name', 'Brand', 'Quantity', 'Price', 'Total'], rows || empty(6))}<div class="draft-total">Total Amount: ${money(i.totalAmount)}</div><div class="form-actions"><button class="secondary" data-action="close-modal">Đóng</button></div>`, true);
}

async function run(action) {
    try {
        await action();
    } catch (e) {
        toast(e.message, true);
    }
}

async function handleAction(b) {
    const a = b.dataset.action, id = b.dataset.id;
    if (a === 'close-modal') {
        closeModal();
        return;
    }
    if (a === 'back-invoice') {
        invoiceModal();
        return;
    }
    if (a === 'page-prev' || a === 'page-next') {
        const s = state[currentView];
        s.page = Math.max(0, s.page + (a === 'page-next' ? 1 : -1));
        await refresh();
        return;
    }
    if (a === 'reset-products') {
        state.products = {
            page: 0,
            size: 10,
            brand: '',
            minPrice: '',
            maxPrice: '',
            minStock: '',
            sortBy: 'id',
            direction: 'desc'
        };
        await refresh();
        return;
    }
    if (a === 'reset-invoices') {
        state.invoices = {page: 0, size: 10, customer: '', date: ''};
        await refresh();
        return;
    }
    if (a === 'add-product') {
        productModal();
        return;
    }
    if (a === 'edit-product') {
        productModal(id);
        return;
    }
    if (a === 'delete-product') {
        confirmDelete('product', id);
        return;
    }
    if (a === 'add-customer') {
        customerModal();
        return;
    }
    if (a === 'edit-customer') {
        customerModal(id);
        return;
    }
    if (a === 'delete-customer') {
        confirmDelete('customer', id);
        return;
    }
    if (a === 'view-invoice') {
        await run(() => viewInvoice(id));
        return;
    }
    if (a === 'add-invoice') {
        await run(async () => {
            [customerOptions, productOptions] = await Promise.all([api('/api/customers/options'), api('/api/products/options')]);
            draft = [];
            draftCustomerId = '';
            invoiceModal();
        });
        return;
    }
    if (a === 'add-line') {
        draftCustomerId = $('#invoice-customer')?.value || draftCustomerId;
        lineModal();
        return;
    }
    if (a === 'edit-line') {
        draftCustomerId = $('#invoice-customer')?.value || draftCustomerId;
        lineModal(Number(id));
        return;
    }
    if (a === 'remove-line') {
        draftCustomerId = $('#invoice-customer')?.value || draftCustomerId;
        draft.splice(Number(id), 1);
        invoiceModal();
        return;
    }
    if (a === 'save-invoice') {
        await run(async () => {
            const customerId = Number($('#invoice-customer')?.value);
            if (!customerId) throw new Error('Vui lòng chọn khách hàng');
            if (!draft.length) throw new Error('Hóa đơn cần ít nhất một sản phẩm');
            const data = await api('/api/invoices', {method: 'POST', body: {customerId, items: draft}});
            closeModal();
            toast(`Đã lưu hóa đơn #${data.id} và trừ tồn kho`);
            state.invoices.page = 0;
            await go('invoices');
        });
        return;
    }
    if (a === 'toggle-product') {
        await run(async () => {
            const p = products.find(x => x.id === Number(id));
            await api(`/api/products/${id}`, {
                method: 'PUT',
                body: {...p, status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
            });
            toast('Đã thay đổi trạng thái');
            await refresh();
        });
        return;
    }
    if (a === 'toggle-customer') {
        await run(async () => {
            const c = customers.find(x => x.id === Number(id));
            await api(`/api/customers/${id}`, {method: 'PUT', body: {...c, active: !c.active}});
            toast('Đã thay đổi trạng thái');
            await refresh();
        });
        return;
    }
    if (a === 'confirm-delete') {
        await run(async () => {
            await api(`/api/${b.dataset.kind === 'product' ? 'products' : 'customers'}/${id}`, {method: 'DELETE'});
            closeModal();
            toast('Đã xóa');
            await refresh();
        });
        return;
    }
    if (a === 'cancel-invoice') {
        openModal('Xác nhận hủy hóa đơn', `<p>Hủy hóa đơn #${Number(id)}? Hệ thống sẽ hoàn lại số lượng tồn kho.</p>
      <div class="form-actions"><button class="secondary" data-action="close-modal">Không</button><button class="danger" data-action="confirm-cancel-invoice" data-id="${Number(id)}">OK — Hủy đơn</button></div>`);
        return;
    }
    if (a === 'advance-invoice' || a === 'confirm-cancel-invoice') {
        await run(async () => {
            const i = invoices.find(x => x.id === Number(id));
            const status = a === 'confirm-cancel-invoice' ? 'CANCELED' : invoiceSteps[i.status];
            await api(`/api/invoices/${id}/status`, {method: 'PATCH', body: {status}});
            closeModal();
            toast(status === 'CANCELED' ? 'Đã hủy hóa đơn và hoàn tồn kho' : 'Đã cập nhật trạng thái');
            await refresh();
        });
        return;
    }
}

document.addEventListener('click', e => {
    const navItem = e.target.closest('[data-view]');
    if (navItem) {
        go(navItem.dataset.view);
        return;
    }
    const action = e.target.closest('[data-action]');
    if (action) {
        e.preventDefault();
        handleAction(action);
        return;
    }
    if (e.target.classList.contains('modal-overlay')) closeModal();
});
document.addEventListener('change', e => {
    if (e.target.id === 'revenue-group') {
        revenueGroup = e.target.value;
        refresh();
    }
    if (e.target.id === 'product-image') {
        const file = e.target.files?.[0], preview = $('#image-preview');
        if (!preview) return;
        if (tempPreviewUrl) {
            URL.revokeObjectURL(tempPreviewUrl);
            tempPreviewUrl = null;
        }
        if (!file) {
            preview.hidden = true;
            return;
        }
        if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            e.target.value = '';
            toast('Chỉ chọn JPG/PNG tối đa 5 MB', true);
            preview.hidden = true;
            return;
        }
        tempPreviewUrl = URL.createObjectURL(file);
        preview.src = tempPreviewUrl;
        preview.hidden = false;
    }
});
document.addEventListener('submit', async e => {
    const f = e.target;
    if (!['product-filter-form', 'customer-filter-form', 'invoice-filter-form', 'product-form', 'customer-form', 'line-form'].includes(f.id)) return;
    e.preventDefault();
    const form = Object.fromEntries(new FormData(f));
    if (f.id === 'product-filter-form') {
        const s = state.products;
        if (form.minPrice !== '' && form.maxPrice !== '' && Number(form.minPrice) > Number(form.maxPrice)) {
            toast('Giá từ phải nhỏ hơn hoặc bằng giá đến', true);
            return;
        }
        Object.assign(s, {
            page: 0,
            brand: form.brand.trim(),
            minPrice: form.minPrice,
            maxPrice: form.maxPrice,
            minStock: form.minStock,
            sortBy: form.sortBy,
            direction: form.direction
        });
        await refresh();
        return;
    }
    if (f.id === 'customer-filter-form') {
        state.customers.keyword = form.keyword.trim();
        state.customers.page = 0;
        await refresh();
        return;
    }
    if (f.id === 'invoice-filter-form') {
        state.invoices.customer = form.customer.trim();
        state.invoices.date = form.date;
        state.invoices.page = 0;
        await refresh();
        return;
    }
    if (f.id === 'product-form') await run(async () => {
        const id = f.dataset.id, file = $('#product-image')?.files?.[0];
        const existing = id ? products.find(p => p.id === Number(id)) : null;
        let imageUrl = existing?.imageUrl || '';
        if (file) {
            const upload = new FormData();
            upload.append('file', file);
            const stored = await api('/api/uploads/images', {method: 'POST', body: upload});
            imageUrl = stored.imageUrl;
        }
        const payload = {
            name: form.name,
            brand: form.brand,
            price: Number(form.price),
            stock: Number(form.stock),
            imageUrl,
            status: form.status
        };
        await api(id ? `/api/products/${id}` : '/api/products', {method: id ? 'PUT' : 'POST', body: payload});
        closeModal();
        toast(id ? 'Đã cập nhật điện thoại' : 'Đã thêm điện thoại');
        await refresh();
    });
    if (f.id === 'customer-form') await run(async () => {
        const id = f.dataset.id;
        const payload = {
            name: form.name,
            email: form.email,
            phone: form.phone,
            address: form.address,
            active: form.active === 'true'
        };
        await api(id ? `/api/customers/${id}` : '/api/customers', {method: id ? 'PUT' : 'POST', body: payload});
        closeModal();
        toast(id ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng');
        await refresh();
    });
    if (f.id === 'line-form') await run(async () => {
        const productId = Number(form.productId), quantity = Number(form.quantity),
            index = f.dataset.index === '' ? null : Number(f.dataset.index);
        const p = productOptions.find(p => p.id === productId);
        if (!p) throw new Error('Vui lòng chọn sản phẩm');
        const other = draft.reduce((n, it, k) => n + (k === index ? 0 : it.productId === productId ? it.quantity : 0), 0);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity + other > p.stock) throw new Error(`Số lượng không hợp lệ; tồn ${p.stock}`);
        if (index === null) draft.push({productId, quantity}); else draft[index] = {productId, quantity};
        invoiceModal();
    });
});
go('dashboard');

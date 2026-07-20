function formatMK(amount) {
  return new Intl.NumberFormat("en-MW", {
    style: "currency",
    currency: "MWK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof supabase === "undefined") {
    console.error("Supabase library not loaded. Check your script order!");
    return;
  }

  const supabaseUrl = "https://nhyucbgjocmwrkqbjjme.supabase.co";
  const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeXVjYmdqb2Ntd3JrcWJqam1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0OTQzNjAsImV4cCI6MjA3OTA3MDM2MH0.uu5ZzSf1CHnt_l4TKNIxWoVN_2YCCoxEZiilB1Xz0eE";

  // Correct way to create client
  const { createClient } = supabase;
  window.supabase = createClient(supabaseUrl, supabaseKey);

  // Detect current page
  const PAGE = location.pathname.split("/").pop();
  if (PAGE === "landing.html" || PAGE === "") loadDashboard();
  if (PAGE === "customers.html") loadCustomers();
  if (PAGE === "products.html") loadProducts();
  if (PAGE === "orders.html") loadOrders();
  if (PAGE === "analytics.html") loadAnalytics();
});


// =====================================
// UTILITY FUNCTIONS
// =====================================
function fmtDate(d) {
  return new Date(d).toLocaleDateString();
}

function closeAllModals() {
  document.querySelectorAll(".modal-bg").forEach(m => m.style.display = "none");
}

document.getElementById("closeModal")?.addEventListener("click", closeAllModals);
document.getElementById("closeCustomerModal")?.addEventListener("click", closeAllModals);

// =====================================
// DASHBOARD
// =====================================
async function loadDashboard() {
  const [{ data: orders }, { data: products }, { data: profiles }] = await Promise.all([
    supabase.from("orders").select("total"),
    supabase.from("products").select("id"),
    supabase.from("profiles").select("id")
  ]);

  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  
  document.getElementById("sales").textContent = formatMK(revenue);
  document.getElementById("orders").textContent = orders.length;
  document.getElementById("products").textContent = products.length;
  document.getElementById("profiles").textContent = profiles.length;

  loadRecentOrders();
}

async function loadRecentOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, customers(name)")
    .order("id", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Orders load error:", error);
    return;
  }

  document.getElementById("ordersTableBody").innerHTML = data.map(o => `
    <tr>
      <td>#${o.id}</td>
      <td>${o.customers?.name || "Guest"}</td>
      <td>${fmtDate(o.created_at)}</td>
      <td>${formatMK(o.total)}</td>
      <td class="status ${o.status}">${o.status}</td>
    </tr>
  `).join("");
}


// =====================================
async function loadCustomers() {
  // ----- 1. Pull orders -----
  const { data: orders, error } = await supabase
    .from("orders")
    .select("customer_id, shipping_address, total, created_at")
    .not("shipping_address", "is", null);

  if (error) { console.error(error); return; }
  if (!orders?.length) {
    document.getElementById("totalCustomers").textContent = "0";
    document.getElementById("customersTableBody").innerHTML =
      "<tr><td colspan='7' class='text-center'>No customers found</td></tr>";
    return;
  }

  // ----- 2. Aggregate per customer -----
  const map = {};
  orders.forEach(o => {
    const id = o.customer_id;

    // Parse JSON string
    let sa = o.shipping_address;
    if (typeof sa === "string") {
      try { sa = JSON.parse(sa); } catch { sa = {}; }
    }
    sa = sa || {};

    if (!map[id]) {
      map[id] = {
        id,
        name: sa.name || "",
        email: sa.email || "",
        phone: sa.phone || "",
        address: [sa.address, sa.apt, sa.city, sa.country]
                  .filter(Boolean).join(", "),
        joined: o.created_at,
        orders: 0,
        spent: 0,
      };
    }

    map[id].orders += 1;
    map[id].spent += Number(o.total) || 0;
  });

  const derived = Object.values(map);

  // ----- 3. Enrich with profiles -----
  const ids = derived.map(c => c.id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, created_at")
    .in("id", ids);

  const pMap = {};
  profiles?.forEach(p => pMap[p.id] = p);

  // ----- 4. Final list -----
  const list = derived.map(c => {
    const p = pMap[c.id];
    return {
      id: c.id,
      name: p?.full_name || c.name || "–",
      email: p?.email || c.email || "–",
      phone: c.phone || "–",
      address: c.address || "–",
      orders: c.orders,
      spent: c.spent.toFixed(2),
      joined: fmtDate(p?.created_at || c.joined),
    };
  });

  // ----- 5. Render -----
  document.getElementById("totalCustomers").textContent = list.length;

  document.getElementById("customersTableBody").innerHTML = list
    .map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.email}</td>
        <td>${c.phone}</td>
        <td>${c.orders}</td>
        <td>${formatMK(c.spent)}</td>
        <td>${c.joined}</td>
        <td>
          <button class="btn view" onclick="openCustomer(${c.id})">
            <i class="fa fa-eye"></i> View
          </button>
        </td>
      </tr>
    `).join("");
}



// =====================================
async function openCustomer(id) {
  // Profile (optional)
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, created_at")
    .eq("id", id)
    .single()
    .catch(() => ({ data: null }));

  // All orders
  const { data: orders } = await supabase
    .from("orders")
    .select("id, total, status, shipping_address, created_at")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  if (!orders?.length) { alert("No orders"); return; }

  // Parse JSON shipping address
  let sa = orders[0].shipping_address;
  if (typeof sa === "string") {
    try { sa = JSON.parse(sa); } catch { sa = {}; }
  }
  sa = sa || {};

  // Fill modal
  document.getElementById("customerModalName").textContent =
    profile?.full_name || sa.name || "–";

  document.getElementById("customerModalEmail").textContent =
    profile?.email || sa.email || "–";

  document.getElementById("customerModalPhone").textContent =
    sa.phone || "–";

  document.getElementById("customerModalAddress").textContent =
    [sa.address, sa.apt, sa.city, sa.country].filter(Boolean).join(", ") || "–";

  document.getElementById("customerModalJoined").textContent =
    fmtDate(profile?.created_at || orders[0].created_at);

  const spent = orders.reduce((s, o) => s + Number(o.total), 0).toFixed(2);
  document.getElementById("customerModalOrders").textContent = orders.length;
  document.getElementById("customerModalSpent").textContent = "$" + spent;

  document.getElementById("customerOrdersList").innerHTML = orders
    .map(o => `<div>#${o.id} — $MWK{o.total} (${o.status}) – ${fmtDate(o.created_at)}</div>`)
    .join("") || "<div>No orders</div>";

  document.getElementById("customerModalBg").style.display = "flex";
}
// =====================================
// PRODUCTS (with image upload)
// =====================================
let editingProductId = null; // track if we're editing

async function loadProducts() {
  const [{ data: categories }, { data: brands }, { data: products }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("brands").select("*"),
    supabase.from("products").select("*, categories(name), brands(name)").order("id")
  ]);

  const categorySelect = document.getElementById("category");
  categorySelect.innerHTML =
    '<option value="">Select Category</option>' +
    categories.map(c =>
      `<option value="${c.id}" data-size-type="${c.size_type}">${c.name}</option>`
    ).join("");

  document.getElementById("brand").innerHTML =
    '<option value="">Select Brand</option>' +
    brands.map(b => `<option value="${b.id}">${b.name}</option>`).join("");

  // Fetch sizes for all products
  const { data: productSizes } = await supabase
    .from("product_sizes")
    .select("*");

  document.getElementById("productTableBody").innerHTML = products.map(p => {
    // Filter sizes for this product
    const sizes = productSizes.filter(s => s.product_id === p.id);
    // Sum stock
    const totalStock = sizes.reduce((sum, s) => sum + (s.stock || 0), 0);

    return `
      <tr>
        <td>${p.id}</td>
        <td>
          ${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;margin-right:8px;vertical-align:middle;">` : ''}
          ${p.name}
        </td>
        <td>${p.categories?.name || "-"}</td>
        <td>${p.brands?.name || "-"}</td>
        <td>${formatMK(p.price)}</td>
        <td>${totalStock}</td>
        <td>${sizes.map(s => `${s.size}: ${s.stock}`).join(", ")}</td>
        <td>
          <button class="btn edit" onclick="editProduct(${p.id})">
            <i class="fa fa-edit"></i>
          </button>
          <button class="btn delete" onclick="deleteProduct(${p.id})">
            <i class="fa fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  document.getElementById("addProductBtn")?.addEventListener("click", openAddProduct);
}

function openAddProduct() {
  editingProductId = null;
  document.getElementById("modalTitle").textContent = "Add Product";
  document.getElementById("name").value = "";
  document.getElementById("price").value = "";
  document.getElementById("category").value = "";
  document.getElementById("brand").value = "";
  document.getElementById("productImage").value = "";
  document.getElementById("imagePreview").style.display = "none";
  document.getElementById("imagePreview").src = "";

  // Reset all sizes
  document.querySelectorAll("#sizeWrapper input[type=checkbox]").forEach(cb => cb.checked = false);
  handleSizeVisibility(); // adjust visibility based on category

  document.getElementById("saveProductBtn").onclick = saveProduct;
  document.getElementById("modalBg").style.display = "flex";
}

async function saveProduct() {
  const file = document.getElementById("productImage").files[0];

  // 1️⃣ Build product object (no stock yet)
  const productBody = {
    name: document.getElementById("name").value.trim(),
    category_id: document.getElementById("category").value,
    brand_id: document.getElementById("brand").value,
    price: Number(document.getElementById("price").value),
  };

  if (!productBody.name || !productBody.category_id || !productBody.price) {
    alert("Please fill all required fields");
    return;
  }

  // 2️⃣ Upload image if exists
  if (file) {
    const fileName = `${Date.now()}_${crypto.randomUUID()}.${file.name.split(".").pop()}`;
    const { error: uploadError } = await supabase.storage.from("products").upload(fileName, file);
    if (uploadError) {
      console.error(uploadError);
      alert("Image upload failed: " + uploadError.message);
      return;
    }
    const { data } = supabase.storage.from("products").getPublicUrl(fileName);
    productBody.image_url = data.publicUrl;
  }

  // 3️⃣ Insert product
  const { data: product, error } = await supabase
    .from("products")
    .insert([productBody])
    .select()
    .single();

  if (error) {
    console.error(error);
    alert("Failed to save product");
    return;
  }

  // 4️⃣ Handle inventory / sizes
  const sizeWrapper = document.getElementById("sizeWrapper");
  const sizeRows = [];

  if (sizeWrapper && sizeWrapper.style.display === "block") {
    // Product WITH sizes
    document.querySelectorAll(".size-row").forEach(row => {
      const checkbox = row.querySelector("input[type=checkbox]");
      const qtyInput = row.querySelector("input[type=number]");
      if (checkbox.checked) {
        sizeRows.push({
          product_id: product.id,
          size: checkbox.value,
          stock: Number(qtyInput.value || 0)
        });
      }
    });
  } else {
    const generalStockInput = document.getElementById("generalStock");
    const defaultStock = generalStockInput ? Number(generalStockInput.value || 0) : 0;

    sizeRows.push({
    product_id: product.id,
    size: "DEFAULT",
    stock: defaultStock
   });
  }

  // 5️⃣ Insert stock into product_sizes table
  if (sizeRows.length > 0) {
    const { error: stockError } = await supabase.from("product_sizes").insert(sizeRows);
    if (stockError) {
      console.error(stockError);
      alert("Failed to save stock: " + stockError.message);
      return;
    }
  }

  closeAllModals();
  loadProducts();
  alert("Product saved successfully!");
}
async function editProduct(id) {
  /* ---------- LOAD PRODUCT ---------- */
  const { data: p, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !p) {
    alert("Failed to load product");
    return;
  }

  editingProductId = id;

  /* ---------- BASIC FIELDS ---------- */
  document.getElementById("modalTitle").textContent = "Edit Product";
  document.getElementById("name").value = p.name || "";
  document.getElementById("price").value = p.price || "";
  document.getElementById("brand").value = p.brand_id || "";
  document.getElementById("category").value = p.category_id || "";

  /* ---------- IMAGE ---------- */
  const preview = document.getElementById("imagePreview");
  if (p.image_url) {
    preview.src = p.image_url; // ✅ FIX HERE
    preview.style.display = "block";
  } else {
    preview.style.display = "none";
  }

  /* ---------- LOAD STOCK ---------- */
  const { data: sizesData } = await supabase
    .from("product_sizes")
    .select("size, stock")
    .eq("product_id", id);

  /* ---------- RESET UI ---------- */
  document.querySelectorAll(".size-row input[type=checkbox]").forEach(cb => cb.checked = false);
  document.querySelectorAll(".size-row input[type=number]").forEach(i => i.value = "");
  const generalStockInput = document.getElementById("generalStock");
  if (generalStockInput) generalStockInput.value = "";

  /* ---------- APPLY STOCK ---------- */
  sizesData?.forEach(row => {
    if (row.size === "DEFAULT") {
      if (generalStockInput) generalStockInput.value = row.stock;
    } else {
      const checkbox = document.querySelector(`input[type=checkbox][value="${row.size}"]`);
      if (checkbox) {
        checkbox.checked = true;
        const qtyInput = checkbox.closest(".size-row")?.querySelector("input[type=number]");
        if (qtyInput) qtyInput.value = row.stock;
      }
    }
  });

  /* ---------- SHOW CORRECT FIELDS ---------- */
  setTimeout(handleSizeVisibility, 0);

  /* ---------- OPEN MODAL ---------- */
  document.getElementById("saveProductBtn").onclick = saveProduct;
  document.getElementById("modalBg").style.display = "flex";
}

async function deleteProduct(id) {
  if (!confirm("Delete this product permanently?")) return;

  // Optional: delete image from storage too
  const { data: product } = await supabase.from("products").select("image_url").eq("id", id).single();
  if (product?.image_url) {
    const fileName = product.image_url.split("/").pop();
    await supabase.storage.from("products").remove([fileName]);
  }

  await supabase.from("products").delete().eq("id", id);
  loadProducts();
}
async function loadOrders() {
  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id,
      total,
      status,
      payment_method,
      shipping_address,
      created_at,

      customers:customer_id (
        full_name,
        email
      ),

      order_items (
        quantity,
        price,
        size,
        products:product_id (
          name
        )
      )
    `)
    .order("id", { ascending: false });

  if (error) {
    console.error("Failed to load orders:", error);
    return { orders: [], error };
  }

  return { orders, error: null };
}

async function renderOrders() {
  const { orders, error } = await loadOrders();

  const tbody = document.getElementById("ordersTableBody");
  if (!tbody) return;

  const table = tbody.closest("table");
  const headerCols = table.querySelectorAll("thead th").length;

  // Handle error
  if (error) {
    tbody.innerHTML = `<tr><td colspan="${headerCols}" style="text-align:center; color:#ef4444;">Error loading orders: ${error.message}</td></tr>`;
    return;
  }

  const safeOrders = orders || [];

  // Update total count
  const totalEl = document.getElementById("totalOrders");
  if (totalEl) totalEl.textContent = safeOrders.length;

  // DASHBOARD view (5 columns)
  if (headerCols === 5) {
    tbody.innerHTML = safeOrders.slice(0, 5).map(o => `
      <tr>
        <td>#${o.id}</td>
        <td>${o.customers?.full_name || '—'}</td>
        <td>${fmtDate(o.created_at)}</td>
        <td>${formatMK(o.total)}</td>
        <td><span class="status ${o.status}">${o.status || 'unknown'}</span></td>
      </tr>
    `).join("");
    return;
  }

  // FULL ORDERS PAGE (8 columns)
  const theadRow = table.querySelector("thead tr");
  while (theadRow.children.length < 8) {
    if (theadRow.children.length === 6) theadRow.insertAdjacentHTML("beforeend", "<th>Items</th><th>Actions</th>");
    else if (theadRow.children.length === 7) theadRow.insertAdjacentHTML("beforeend", "<th>Actions</th>");
  }

  tbody.innerHTML = safeOrders.map(o => {
    const items = (o.order_items || [])
      .map(i => `${i.products?.name || 'Unknown'} ×${i.quantity}`)
      .join("<br>") || "<em style='color:#999'>—</em>";

    return `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td>${fmtDate(o.created_at)}</td>
        <td>
          <div><strong>${o.customers?.full_name || '—'}</strong></div>
          <small style="color:#64748b;">${o.customers?.email || ''}</small>
        </td>
        <td style="font-size:13.5px; line-height:1.6;">${items}</td>
        <td>${formatMK(o.total)}</td>
        <td style="text-transform:capitalize;">${o.payment_method || '—'}</td>
        <td><span class="status ${o.status}">${o.status || 'pending'}</span></td>
<td>
  <button class="btn view" onclick="showAddressModal(${o.id})">
    View Invoice
  </button>
</td>
        <td class="actions">
          <button class="btn edit" onclick="editOrder(${o.id})"><i class="fa fa-edit"></i></button>
          <button class="btn delete" onclick="deleteOrder(${o.id})"><i class="fa fa-trash"></i></button>
        </td>
      </tr>
    `;
  }).join("");

  // No orders
  if (safeOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8;">No orders found</td></tr>`;
  }
}

// Call this on page load
document.addEventListener("DOMContentLoaded", renderOrders);

// Safe: returns null if no valid ID, never touches document.body
function getOrderIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get('orderId');
  if (id && /^\d+$/.test(id)) return parseInt(id, 10);

  const match = location.pathname.match(/\/(\d+)\/?$/);
  if (match) return parseInt(match[1], 10);

  return null;
}

// FINAL – WORKS 100% – NO FK NAMES, NO RLS ISSUES, NO [object Object]
async function fetchOrderDetails(orderId) {
  // 1. Get the order
  const { data: order, error: e1 } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (e1 || !order) return null;

  // 2. Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, phone, avatar_url')
    .eq('id', order.customer_id)
    .maybeSingle();

  // 3. Get items + products
 const { data: items } = await supabase
  .from("order_items")
  .select("quantity, price, size, products(name, image_url)")
  .eq("order_id", orderId);


  // Return exactly what your modal expects
  return {
    ...order,
    profiles: profile || { full_name: 'Customer', email: '' },
    order_items: items || []
  };
}
// Render full order page (only on order view page)
function renderSingleOrderPage(order) {
  let address = {};
  try {
    address = typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address || {};
  } catch (e) { /* ignore */ }

  const itemsHtml = (order.order_items || []).map(item => `
    <tr>
      <td style="padding:10px;">
        ${item.products?.image_url ? `<img src="${item.products.image_url}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:10px;">` : ''}
        ${item.products?.name || 'Unknown Product'}
      </td>
      <td style="padding:10px;">${item.quantity}</td>
      <td>${formatMK(o.total)}</td>
      <td style="padding:10px;">$${(item.quantity * item.price).toFixed(2)}</td>
    </tr>
  `).join('');

  document.body.innerHTML = `
    <div style="max-width:900px;margin:40px auto;padding:20px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.1);font-family:system-ui,sans-serif;">
      <h1 style="text-align:center;color:#1f2937;">Order #${order.id}</h1>
      <p style="text-align:center;color:#6b7280;">${new Date(order.created_at).toLocaleString()}</p>

      <div style="display:flex;justify-content:space-between;margin:30px 0;">
        <div>
          <strong>Status:</strong> 
          <span style="padding:6px 12px;background:#10b981;color:white;border-radius:20px;text-transform:capitalize;">
            ${order.status}
          </span>
        </div>
        <div style="text-align:right;">
          <strong>Total: <span style="font-size:1.8em;color:#6366f1;">$${Number(order.total).toFixed(2)}</span></strong>
        </div>
      </div>

      <h2>Shipping Address</h2>
      <div style="background:#f9fafb;padding:15px;border-radius:8px;">
        <strong>${address.name || '—'}</strong><br>
        ${address.address || ''}${address.apt ? ', ' + address.apt : ''}<br>
        ${address.city || ''}, ${address.postal || ''}, ${address.country || ''}
      </div>

      <h2 style="margin-top:30px;">Items</h2>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:12px;text-align:left;">Product</th>
            <th style="padding:12px;">Qty</th>
            <th style="padding:12px;">Price</th>
            <th style="padding:12px;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="text-align:center;margin-top:40px;">
        <button onclick="window.print()" style="padding:12px 30px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:1.1em;">
          Print Invoice
        </button>
      </div>
    </div>
  `;
}

async function showAddressModal(orderId) {
  const modal = document.getElementById("addressModalBg");
  const box = document.getElementById("invoiceAddressBox");

  const order = await fetchOrderDetails(orderId);
  if (!order) {
    box.innerHTML = "<p style='color:#ef4444;'>Order not found or access denied.</p>";
    modal.style.display = "flex";
    return;
  }

  // Parse shipping address (it's stored as JSON string)
  let address = {};
  try {
    address = typeof order.shipping_address === "string" 
      ? JSON.parse(order.shipping_address) 
      : order.shipping_address || {};
  } catch (e) {
    address = {};
  }

  const items = order.order_items || [];

const itemsHtml = (order.order_items || []).map(item => `
  <tr>
    <td>
      ${item.products?.image_url ? `<img src="${item.products.image_url}" style="width:50px;height:50px;">` : ""}
      ${item.products?.name || "Product"}
      ${item.size ? `<div style="font-size:12px;color:#6b7280;">Size: ${item.size}</div>` : ""}
    </td>
    <td>${item.quantity}</td>
    <td>${formatMK(item.quantity * item.price)}</td>
    <td>$${(item.quantity * item.price).toFixed(2)}</td>
  </tr>
`).join("");


  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const tax = (subtotal * 0.08).toFixed(2); // adjust tax rate if needed
  const total = (subtotal + parseFloat(tax)).toFixed(2);

  box.innerHTML = `
    <div style="font-family:system-ui,sans-serif;line-height:1.6;">
      <h3 style="margin:0 0 15px;">Invoice #${order.id}</h3>
      <div style="margin-bottom:20px;color:#374151;">
        <strong>${address.name || order.profiles?.full_name || 'Customer'}</strong><br>
        ${address.email || order.profiles?.email || ''}<br>
        ${address.phone || ''}<br><br>
        <strong>Shipping Address:</strong><br>
        ${address.address || ''}${address.apt ? ', ' + address.apt : ''}<br>
        ${address.city || ''}, ${address.postal || ''}<br>
        ${address.country || ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px;text-align:left;">Product</th>
            <th style="padding:10px;">Qty</th>
            <th style="padding:10px;">Price</th>
            <th style="padding:10px;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="text-align:right;font-size:15px;">
        <div>Subtotal: ${formatMK(subtotal)}</div>
        <div>Tax (8%): ${formatMK(tax)}</div>
        <div><strong>Total: ${formatMK(total)}</strong></div>
      </div>
    </div>
  `;

  modal.style.display = "flex";
}

window.downloadInvoicePDF = function() {
  const element = document.getElementById("invoiceArea");
  const images = element.querySelectorAll("img");

  // Wait for all images to load
  const promises = Array.from(images).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.onload = img.onerror = resolve;
    });
  });

  Promise.all(promises).then(() => {
    html2pdf()
      .set({ margin: 10, filename: 'invoice.pdf', html2canvas: { scale: 2, useCORS: true } })
      .from(element)
      .save();
  });
};

function closeAddressModal() {
  document.getElementById("addressModalBg").style.display = "none";
}

async function openOrder(id) {
  const { data: order } = await supabase.from("orders").select("*, customers(name,email)").eq("id",id).single();
  const { data: items } = await supabase.from("order_items").select("*, products(name)").eq("order_id",id);

  document.getElementById("modalOrderId").textContent = "#" + order.id;
  document.getElementById("modalCustomer").textContent = order.customers.name;
  document.getElementById("modalEmail").textContent = order.customers.email;
  document.getElementById("modalDate").textContent = fmtDate(order.created_at);
  document.getElementById("modalAddress").textContent = order.shipping_address;
  document.getElementById("modalItems").innerHTML = items.map(i => `<div>${i.products.name} × ${i.quantity} — $${i.price}</div>`).join("");
  document.getElementById("modalTotal").textContent = "$" + order.total;

  const select = document.getElementById("statusSelect");
  select.innerHTML = ["pending","processing","shipped","delivered","cancelled"]
    .map(s => `<option value="${s}" ${order.status===s?"selected":""}>${s}</option>`).join("");
  select.onchange = () => updateOrderStatus(id, select.value);

  document.getElementById("modalBg").style.display = "flex";
}

async function updateOrderStatus(id,status) {
  await supabase.from("orders").update({status}).eq("id",id);
  loadOrders();
}

// EDIT ORDER — FULLY FIXED FOR YOUR CURRENT HTML
async function editOrder(id) {
  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      *,
      customers:customer_id (full_name, email)
    `)
    .eq("id", id)
    .single();

  if (error || !order) {
    alert("Order not found!");
    console.error(error);
    return;
  }

  // Fill basic info
  document.getElementById("modalOrderId").textContent = `#${order.id}`;
  document.getElementById("modalCustomer").textContent = order.customers?.full_name || "Unknown";
  document.getElementById("modalEmail").textContent = order.customers?.email || "—";
  document.getElementById("modalDate").textContent = fmtDate(order.created_at);

  // Shipping Address → Editable Textarea
  const addr = typeof order.shipping_address === "string" 
    ? order.shipping_address 
    : JSON.stringify(order.shipping_address, null, 2);

  document.getElementById("modalAddress").innerHTML = `
    <strong>Shipping Address:</strong><br>
    <textarea id="editShippingAddress" style="width:100%; height:100px; margin-top:8px; padding:10px; border:1px solid #ddd; border-radius:6px; font-family: monospace;">
${addr.trim()}
    </textarea>
  `;

  // Status Select
  const statusSelect = document.getElementById("statusSelect");
  const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"];
  statusSelect.innerHTML = statuses.map(s => 
    `<option value="${s}" ${order.status === s ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
  ).join("");

  // === INJECT SAVE BUTTON (since you don't have .modal-footer) ===
  const modal = document.querySelector("#modalBg .modal");
  let saveBtn = modal.querySelector("#saveOrderBtn");
  if (!saveBtn) {
    saveBtn = document.createElement("button");
    saveBtn.id = "saveOrderBtn";
    saveBtn.className = "btn primary";
    saveBtn.textContent = "Save Changes";
    saveBtn.style.marginTop = "20px";
    modal.appendChild(saveBtn);
  }

  // Attach save logic
  saveBtn.onclick = async () => {
    const newStatus = statusSelect.value;
    const newAddress = document.getElementById("editShippingAddress").value.trim();

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: newStatus,
        shipping_address: newAddress || null
      })
      .eq("id", id);

    if (updateError) {
      alert("Update failed: " + updateError.message);
      return;
    }

    closeAllModals();
    renderOrders(); // Refresh table
    alert("Order updated successfully!");
  };

  // Show modal
  document.getElementById("modalBg").style.display = "flex";
}

function closeModal() {
  document.getElementById("modalBg").style.display = "none";
}
// Delete Order
async function deleteOrder(id) {
  if (!confirm(`Delete Order #${id} permanently? This cannot be undone.`)) return;

  await supabase.from("order_items").delete().eq("order_id", id);
  await supabase.from("orders").delete().eq("id", id);
  loadToast("Order deleted successfully", "success");
  loadOrders();
}

// ANALYTICS
async function loadAnalytics() {
  const days = Number(document.getElementById("dateRange").value);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Fetch orders + order_items
  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      *,
      order_items(id, order_id, product_id, quantity, price, name, subtotal)
    `)
    .gte("created_at", since);

  if (error) {
    console.error("Analytics load failed:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    document.getElementById("totalRevenue").textContent = "$0.00";
    document.getElementById("avgOrderValue").textContent = "$0.00";
    document.getElementById("conversionRate").textContent = "0%";
    document.getElementById("monthlyGrowth").textContent = "0%";
    document.getElementById("topCategory").textContent = "—";
    return;
  }

  // 1️⃣ Revenue
const revenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
document.getElementById("totalRevenue").textContent = formatMK(revenue);

// AOV
const aov = orders.length ? revenue / orders.length : 0;
document.getElementById("avgOrderValue").textContent = formatMK(aov);

  // 3️⃣ Conversion Rate
  const { data: visitors } = await supabase
    .from("visitors")
    .select("id")
    .gte("created_at", since);

  const conversion = visitors && visitors.length > 0 ? (orders.length / visitors.length) * 100 : 0;
  document.getElementById("conversionRate").textContent = `${conversion.toFixed(1)}%`;

  // 4️⃣ Monthly Growth
  const now = new Date();
  const thisMonth = now.getMonth();
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;

  const ordersThisMonth = orders.filter(o => new Date(o.created_at).getMonth() === thisMonth);
  const ordersLastMonth = orders.filter(o => new Date(o.created_at).getMonth() === lastMonth);

  const growth = ordersLastMonth.length === 0
    ? 100
    : ((ordersThisMonth.length - ordersLastMonth.length) / ordersLastMonth.length) * 100;

  document.getElementById("monthlyGrowth").textContent = `${growth.toFixed(1)}%`;

  // 5️⃣ Top Product (by quantity)
  const productCounts = {};
  orders.forEach(order => {
    order.order_items?.forEach(item => {
      const name = item.name || "Unnamed Product";
      productCounts[name] = (productCounts[name] || 0) + item.quantity;
    });
  });

  const topProduct = Object.entries(productCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "—";
  document.getElementById("topCategory").textContent = topProduct;

  // 6️⃣ Sales Chart
  new Chart(document.getElementById("salesChart"), {
    type: "line",
    data: {
      labels: orders.map(o => fmtDate(o.created_at)),
      datasets: [{
        label: "Sales",
        data: orders.map(o => Number(o.total)),
        borderColor: "#6366f1",
        tension: 0.4
      }]
    }
  });

  // 7️⃣ Status Chart
  const counts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  new Chart(document.getElementById("ordersChart"), {
    type: "bar",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#6B7280"]
      }]
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const logoutBtn = document.getElementById("logoutBtn");

  // ---------- PAGE PROTECTION ----------
  try {
    const { data: { session } } = await supabase.auth.getSession();
    // Only protect pages that require login (skip if logout page itself)
    if (!session && window.location.pathname !== "/adLogin.html") {
      window.location.replace("adLogin.html");
      return;
    }
  } catch (err) {
    console.error("Failed to check session:", err);
  }

  if (!logoutBtn) return;

  // ---------- LOGOUT ----------
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const span = logoutBtn.querySelector("span") || logoutBtn;
    const originalText = span.textContent;

    span.textContent = "Logging out...";
    logoutBtn.style.pointerEvents = "none";

    // Clear local/session storage
    localStorage.clear();
    sessionStorage.clear();

    // Sign out from Supabase
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert("Logout failed: " + error.message);
      span.textContent = originalText;
      logoutBtn.style.pointerEvents = "auto";
      return;
    }

    // Redirect after logout
    window.location.replace("../index.html");
  });
});


// GLOBAL SEARCH FOR ALL TABLES (Customers / Products / Orders)
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    const page = location.pathname.split("/").pop();

    // Determine which table to filter
    let tableBody;
    if (page === "customers.html") {
      tableBody = document.getElementById("customersTableBody");
    } else if (page === "products.html") {
      tableBody = document.getElementById("productTableBody");
    } else if (page === "orders.html") {
      tableBody = document.getElementById("ordersTableBody");
    } else {
      return;
    }

    if (!tableBody) return;

    const rows = tableBody.querySelectorAll("tr");

    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      const matches = text.includes(query);
      row.style.display = matches ? "" : "none";
    });

    // Optional: Show "No results" row if nothing matches
    const visibleRows = Array.from(rows).filter(r => r.style.display !== "none");
    if (visibleRows.length === 0 && query !== "") {
      // Remove existing "no results" row if exists
      const existing = tableBody.querySelector(".no-results-row");
      if (existing) existing.remove();

      const cols = tableBody.closest("table").querySelector("thead tr").children.length;
      const noResultsRow = document.createElement("tr");
      noResultsRow.className = "no-results-row";
      noResultsRow.innerHTML = `<td colspan="${cols}" style="text-align:center; color:#94a3b8; padding:40px 0; font-style:italic;">
        No results found for "<strong>${e.target.value}</strong>"
      </td>`;
      tableBody.appendChild(noResultsRow);
    } else {
      // Remove "no results" row when there are matches or query is cleared
      const noResultsRow = tableBody.querySelector(".no-results-row");
      if (noResultsRow) noResultsRow.remove();
    }
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const statusFilter = document.getElementById("statusFilter");

  if (!statusFilter) return; // not on the orders page or status filter doesn't exist

  const tableBody = document.getElementById("ordersTableBody");
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll("tr");

  // Main filter function (called on every change)
  function applyFilters() {
    const selectedStatus = statusFilter.value || "all";
    
    let visibleCount = 0;

    rows.forEach(row => {
      // Skip "no results" or "no orders" rows
      if (row.querySelector(".no-results-row, td[colspan]")) {
        row.style.display = "none";
        return;
      }

      // Status is in the 7th column (index 6)
      const statusCell = row.querySelector("td:nth-child(7)");
      const statusText = statusCell ? statusCell.textContent.trim().toLowerCase() : "";

      const matchesStatus = selectedStatus === "all" || statusText === selectedStatus;

      if (matchesStatus) {
        row.style.display = "";
        visibleCount++;
      } else {
        row.style.display = "none";
      }
    });

    // Show "No results" if nothing matches
    const existingNoResults = tableBody.querySelector(".no-results-row");
    if (existingNoResults) existingNoResults.remove();

    if (visibleCount === 0) {
      const headerCols = tableBody.closest("table").querySelector("thead th").length;
      const noResultsRow = document.createElement("tr");
      noResultsRow.className = "no-results-row";
      noResultsRow.innerHTML = ` 
        <td colspan="${headerCols}" style="text-align:center; padding:40px; color:#94a3b8; font-style:italic;">
          No orders found with status "${selectedStatus}"
        </td>`;
      tableBody.appendChild(noResultsRow);
    }
  }

  // Trigger filter on change
  statusFilter.addEventListener("change", applyFilters);

  // Run once on load (in case you pre-select a status via URL or something)
  applyFilters();
});

document.getElementById("category").addEventListener("change", handleSizeVisibility);

function handleSizeVisibility() {
  const categorySelect = document.getElementById("category");
  const selectedOption = categorySelect.options[categorySelect.selectedIndex];
  const sizeType = selectedOption?.dataset?.sizeType;

  const sizeWrapper = document.getElementById("sizeWrapper");
  const shoeSizes = document.getElementById("shoeSizes");
  const clothingSizes = document.getElementById("clothingSizes");
  const generalStock = document.getElementById("generalStock");

  if (sizeType === "shoes") {
    sizeWrapper.style.display = "block";
    shoeSizes.style.display = "block";
    clothingSizes.style.display = "none";
    generalStock.style.display = "none";
  } 
  else if (sizeType === "clothing") {
    sizeWrapper.style.display = "block";
    shoeSizes.style.display = "none";
    clothingSizes.style.display = "block";
    generalStock.style.display = "none";
  } 
  else {
    sizeWrapper.style.display = "none";
    shoeSizes.style.display = "none";
    clothingSizes.style.display = "none";
    generalStock.style.display = "block";
  }
}

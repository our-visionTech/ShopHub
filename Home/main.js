let wishlist = [];
let cart = JSON.parse(localStorage.getItem("shophub_cart")) || [];
let allProducts = [];
let pendingProduct = null;
let selectedSize = null;
let grid;
let isInitialized = false;
let authTimeout = null;

function formatMK(amount) {
  return `MK ${Number(amount).toLocaleString("en-MW")}`;
}

function getGrid() {
  return document.getElementById("productsGrid");
}

function getPublicImageUrl(path) {
  if (!path) return 'https://via.placeholder.com/300x400?text=No+Image';
  if (path.startsWith('http')) return path;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl || 'https://via.placeholder.com/300x400?text=Image+Error';
}

async function initializeApp(force = false) {
  if (isInitialized && !force) return;

  isInitialized = true;
  console.log("🚀 Initializing app...");

  try {
    // Make sure DOM is really ready
    if (document.readyState !== "complete") {
      await new Promise(resolve => window.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }

    showProductsLoading();

    await loadProducts();

    // Wishlist is less critical → fire and forget with UI refresh
    loadWishlist().catch(err => console.warn("Wishlist failed:", err));

    updateCartCount();
  } catch (err) {
    console.error("Initialization error:", err);
    showProductsError("Failed to initialize shop");
  }
}

function showProductsLoading() {
  const gridEl = getGrid();
  if (gridEl) {
    gridEl.innerHTML = `
      <div style="text-align:center; padding:5rem 1rem; color:#777;">
        <div style="font-size:2.5rem; margin-bottom:1rem;">🌀</div>
        Loading products...
      </div>
    `;
  }
}

function showProductsError(message) {
  const gridEl = getGrid();
  if (gridEl) {
    gridEl.innerHTML = `
      <div style="text-align:center; padding:4rem 1rem; color:#ff5555;">
        <h3>Error</h3>
        <p>${message}</p>
        <small>Please try refreshing the page</small>
      </div>
    `;
  }
}

// Auth state change with debounce
supabase.auth.onAuthStateChange((event, session) => {
  console.log("🔑 Auth event:", event);

  clearTimeout(authTimeout);
  authTimeout = setTimeout(async () => {
    const relevantEvents = ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'];
    if (relevantEvents.includes(event)) {
      await initializeApp(false);
    }
  }, 250);
});

// Handle page restored from bfcache (back/forward)
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    isInitialized = false;
    initializeApp(true);
  }
});

// ── WISHLIST ────────────────────────────────────────
async function loadWishlist() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      wishlist = [];
      return;
    }

    const { data, error } = await supabase
      .from("wishlist")
      .select("product_id")
      .eq("user_id", user.id);

    if (error) throw error;

    wishlist = (data || []).map(item => String(item.product_id));
    
    // Refresh UI if filter function exists
    if (typeof window.filterAndSort === "function") {
      window.filterAndSort();
    }
  } catch (err) {
    console.warn("Wishlist load failed:", err.message);
    wishlist = [];
  }
}

async function toggleWishlist(product) {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    alert("Please log in to use wishlist ❤️");
    window.location.href = "Admin/adLogin.html";
    return;
  }

  const idStr = String(product.id);
  const isLiked = wishlist.includes(idStr);

  let success = false;

  if (isLiked) {
    const { error } = await supabase
      .from("wishlist")
      .delete()
      .eq("user_id", user.id)
      .eq("product_id", product.id);
    if (!error) success = true;
  } else {
    const { error } = await supabase
      .from("wishlist")
      .insert({ user_id: user.id, product_id: product.id });
    if (!error) success = true;
  }

  if (success) {
    if (isLiked) {
      wishlist = wishlist.filter(id => id !== idStr);
    } else {
      wishlist.push(idStr);
    }
  }

  // Always try to refresh display
  if (typeof window.filterAndSort === "function") {
    window.filterAndSort();
  } else if (allProducts.length > 0) {
    renderProducts(allProducts);
  }
}

// ── PRODUCTS ────────────────────────────────────────
async function loadProducts() {
  console.log("loadProducts() called");

  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, price, image_url, has_sizes, categories(name)")
    .order("id");

  console.log("Products query result:", {
    count: products?.length ?? 0,
    error: error?.message ?? null
  });

  if (error) {
    console.error("Product load error:", error);
    showProductsError("Failed to load products. Please refresh.");
    allProducts = [];
    return;
  }

  allProducts = products || [];

  if (allProducts.length === 0) {
    const gridEl = getGrid();
    if (gridEl) {
      gridEl.innerHTML = `<p style="text-align:center;padding:3rem;color:#888;">
        No products available at the moment
      </p>`;
    }
    return;
  }

  console.log(`[PRODUCTS] Loaded ${allProducts.length} products`);

  // Update category filters
  const categories = [...new Set(allProducts.map(p => p.categories?.name).filter(Boolean))];
  const options = `<option value="all">All Items</option>` +
    categories.map(c => `<option value="${c.toLowerCase()}">${c}</option>`).join("");

  const filterSelectEl = document.getElementById("filterSelect");
  const mobileFilterEl = document.getElementById("mobileFilter");
  if (filterSelectEl) filterSelectEl.innerHTML = options;
  if (mobileFilterEl) mobileFilterEl.innerHTML = options;

  // Try to render using filterAndSort if available, otherwise fallback
  if (typeof window.filterAndSort === "function") {
    console.log("[LOAD] Running filterAndSort");
    window.filterAndSort();
  } else {
    console.log("[LOAD] filterAndSort not ready → fallback render");
    renderProducts(allProducts);
  }
}

function renderProducts(products) {
  const gridEl = getGrid();
  if (!gridEl) return;

  if (!products?.length) {
    gridEl.innerHTML = `<p style="text-align:center;padding:3rem;color:#888;">No products found</p>`;
    return;
  }

  gridEl.innerHTML = products.map(p => {
    const imgUrl = getPublicImageUrl(p.image_url);
    const isLiked = wishlist.includes(String(p.id));
    const heartClass = isLiked ? 'fas' : 'far';
    const likedClass = isLiked ? 'liked' : '';

    return `
      <a href="Home/viewproduct.html?id=${p.id}" class="product-card">
        <div class="product-image">
          <img src="${imgUrl}" alt="${p.name}" loading="lazy">
          <div class="like-btn ${likedClass}" data-product-id="${p.id}">
            <i class="${heartClass} fa-heart"></i>
          </div>
        </div>
        <div class="product-overlay">
          <div class="product-title">${p.name.toUpperCase()}</div>
          <div class="product-price">${formatMK(p.price)}</div>
          <div class="product-actions">
            <div class="action-btn view-btn">QUICK VIEW</div>
            <div class="action-btn cart-btn" data-product-id="${p.id}">
              <i class="fas fa-shopping-bag"></i> ADD TO CART
            </div>
          </div>
        </div>
        <div class="product-info">
          <div class="product-title">${p.name.toUpperCase()}</div>
          <div class="product-price">${formatMK(p.price)}</div>
          <div class="product-actions">
            <div class="action-btn view-btn">QUICK VIEW</div>
            <div class="action-btn cart-btn" data-product-id="${p.id}">
              <i class="fas fa-shopping-bag"></i> ADD TO CART
            </div>
          </div>
        </div>
      </a>
    `;
  }).join("");
}

// ── DOM READY ────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  console.log("[DOMContentLoaded] DOM is ready");

  grid = getGrid();
  if (!grid) {
    console.error("productsGrid element not found!");
    return;
  }

  // Define filter function early
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const sortSelect = document.getElementById("sortSelect");
  const mobileSearch = document.getElementById("mobileSearch");
  const mobileFilter = document.getElementById("mobileFilter");
  const mobileSort = document.getElementById("mobileSort");

  function filterAndSort() {
    if (!allProducts?.length) {
      renderProducts([]);
      return;
    }

    let filtered = [...allProducts];

    const query = (searchInput?.value || mobileSearch?.value || "").toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(query));
    }

    const cat = (filterSelect?.value || mobileFilter?.value || "all").toLowerCase();
    if (cat !== "all") {
      filtered = filtered.filter(p => (p.categories?.name || '').toLowerCase() === cat);
    }

    const sort = sortSelect?.value || mobileSort?.value || "";
    if (sort === "price-low") filtered.sort((a, b) => a.price - b.price);
    else if (sort === "price-high") filtered.sort((a, b) => b.price - a.price);
    else if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));

    renderProducts(filtered);
  }

  window.filterAndSort = filterAndSort;

  // Initial render attempt
  if (allProducts.length > 0) {
    console.log("[DOMContentLoaded] Products already loaded → rendering");
    filterAndSort();
  }

  // ── Event listeners ──────────────────────────────
  grid.addEventListener("click", (e) => {
    const likeBtn = e.target.closest(".like-btn");
    if (likeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const productId = likeBtn.dataset.productId;
      const product = allProducts.find(p => String(p.id) === productId);
      if (product) toggleWishlist(product);
      return;
    }

    const cartBtn = e.target.closest(".cart-btn");
    if (cartBtn) {
      e.preventDefault();
      e.stopPropagation();
      handleAddToCartClick(cartBtn.dataset.productId);
    }
  });

  // Filter events + mobile/desktop sync
  const filterElements = [
    { el: searchInput, mobile: mobileSearch, event: "input" },
    { el: filterSelect, mobile: mobileFilter, event: "change" },
    { el: sortSelect, mobile: mobileSort, event: "change" }
  ];

  filterElements.forEach(({ el, mobile, event: type }) => {
    if (!el) return;
    el.addEventListener(type, () => {
      if (mobile) mobile.value = el.value;
      filterAndSort();
    });
    if (mobile) {
      mobile.addEventListener(type, () => {
        if (el) el.value = mobile.value;
        filterAndSort();
      });
    }
  });

  // ... (rest of your listeners - bottom sheet, cart sidebar, size selector, mobile nav ...)
  // Bottom Sheet
  const trigger = document.getElementById('floatingTrigger');
  const overlay = document.getElementById('bottomSheetOverlay');
  const sheet = document.getElementById('bottomSheet');

  trigger?.addEventListener('click', () => {
    sheet?.classList.toggle('open');
    overlay?.classList.toggle('active');
  });
  overlay?.addEventListener('click', () => {
    sheet?.classList.remove('open');
    overlay?.classList.remove('active');
  });

  // Cart Sidebar
  const cartSidebar = document.getElementById("cartSidebar");
  const cartOverlay = document.getElementById("cartOverlay");
  const openCartBtn = document.getElementById("openCart");
  const closeCartBtn = document.getElementById("closeCart");

  openCartBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    cartSidebar?.classList.add("open");
    cartOverlay?.classList.add("active");
    renderCart();
  });
  closeCartBtn?.addEventListener("click", () => {
    cartSidebar?.classList.remove("open");
    cartOverlay?.classList.remove("active");
  });
  cartOverlay?.addEventListener("click", () => {
    cartSidebar?.classList.remove("open");
    cartOverlay?.classList.remove("active");
  });

  // Size Selector Confirm
  document.getElementById("confirmSizeBtn")?.addEventListener("click", () => {
    if (!selectedSize) {
      alert("Please select a size");
      return;
    }
    addToCart({ ...pendingProduct, size: selectedSize });
    closeSizeSelector();
  });

  // Mobile Nav
  const openMobileNavBtn = document.getElementById("openMobileNav");
  const closeMobileNavBtn = document.getElementById("closeMobileNav");
  const mobileNavOverlay = document.getElementById("mobileNavOverlay");
  const mobileNav = document.getElementById("mobileNav");
  const mobileCartLink = document.getElementById("mobileCartLink");

  openMobileNavBtn?.addEventListener("click", () => {
    mobileNav?.classList.add("open");
    mobileNavOverlay?.classList.add("active");
  });
  closeMobileNavBtn?.addEventListener("click", () => {
    mobileNav?.classList.remove("open");
    mobileNavOverlay?.classList.remove("active");
  });
  mobileNavOverlay?.addEventListener("click", () => {
    mobileNav?.classList.remove("open");
    mobileNavOverlay?.classList.remove("active");
  });
  mobileCartLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openCartBtn?.click();
    mobileNav?.classList.remove("open");
    mobileNavOverlay?.classList.remove("active");
  });
});

// The rest of your code (cart, size selector, visitor tracking) remains unchanged
// =============================================================================

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id && item.size === product.size);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  localStorage.setItem("shophub_cart", JSON.stringify(cart));
  updateCartCount();
  alert(`${product.name}${product.size ? " (Size " + product.size + ")" : ""} added to bag!`);
}

function handleAddToCartClick(productId) {
  const product = allProducts.find(p => p.id === Number(productId));
  if (!product) return;

  if (product.has_sizes) {
    pendingProduct = product;
    openSizeSelector(product);
  } else {
    addToCart(product);
  }
}

function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById("cartCount")?.textContent = count;
  document.getElementById("mobileCartCount")?.textContent = count;
}

v
function renderCart() {
  const itemsEl = document.getElementById("cartItems");
  const totalEl = document.getElementById("cartTotal");
  if (!itemsEl || !totalEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = `<p class="empty-cart">Your bag is empty</p>`;
    totalEl.textContent = "0.00";
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div style="display:flex; gap:1rem; padding:1rem 0; border-bottom:1px solid #222;">
      <img src="${getPublicImageUrl(item.image_url)}" style="width:80px;height:120px;object-fit:cover;border-radius:12px;">
      <div style="flex:1;">
        <div style="font-weight:700;">${item.name}</div>
        ${item.size ? `<div style="color:#aaa;font-size:0.9rem;">Size: ${item.size}</div>` : ''}
        <div style="color:#a78bfa;font-weight:800;">${formatMK(item.price)}</div>
        <div style="display:flex;align-items:center;gap:1rem;margin-top:0.5rem;">
          <button style="width:36px;height:36px;background:#222;border:none;border-radius:50%;color:white;" onclick="updateQuantity(${item.id},'${item.size || ''}',-1)">−</button>
          <span style="min-width:30px;text-align:center;font-weight:700;">${item.quantity}</span>
          <button style="width:36px;height:36px;background:#222;border:none;border-radius:50%;color:white;" onclick="updateQuantity(${item.id},'${item.size || ''}',1)">+</button>
        </div>
        <div style="color:#ff4444;font-size:0.9rem;cursor:pointer;margin-top:0.5rem;" onclick="removeFromCart(${item.id},'${item.size || ''}')">Remove</div>
      </div>
    </div>
  `).join("");

  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  totalEl.textContent = formatMK(total);
}

window.removeFromCart = (id, size) => {
  size = size === '' ? undefined : size;
  cart = cart.filter(i => !(i.id === id && i.size === size));
  localStorage.setItem("shophub_cart", JSON.stringify(cart));
  updateCartCount();
  renderCart();
};

window.updateQuantity = (id, size, change) => {
  size = size === '' ? undefined : size;
  const item = cart.find(i => i.id === id && i.size === size);
  if (item) {
    item.quantity = Math.max(1, item.quantity + change);
    localStorage.setItem("shophub_cart", JSON.stringify(cart));
    updateCartCount();
    renderCart();
  }
};

// === SIZE SELECTOR ===
async function openSizeSelector(product) {
  selectedSize = null;

  const { data: sizes } = await supabase
    .from("product_sizes")
    .select("size")
    .eq("product_id", product.id)
    .neq("size", "DEFAULT");

  const sizeOptions = document.getElementById("sizeOptions");
  if (sizeOptions) {
    if (sizes && sizes.length > 0) {
      sizeOptions.innerHTML = sizes.map(s => `
        <div class="size-btn" onclick="selectSize('${s.size}', this)">${s.size}</div>
      `).join("");
    } else {
      sizeOptions.innerHTML = "<p>No sizes available</p>";
    }
  }

  document.getElementById("sizeSheet")?.classList.add("open");
  document.getElementById("sizeSheetOverlay")?.classList.add("active");
}

function selectSize(size, el) {
  selectedSize = size;
  document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("active"));
  el.classList.add("active");
}

function closeSizeSelector() {
  document.getElementById("sizeSheet")?.classList.remove("open");
  document.getElementById("sizeSheetOverlay")?.classList.remove("active");
  pendingProduct = null;
  selectedSize = null;
}

// === VISITOR TRACKING ===
async function trackVisitor() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
    await supabase.from("visitors").insert({ ip, user_agent: navigator.userAgent });
  } catch (err) {
    console.error("Visitor tracking failed:", err);
  }
}

trackVisitor();
updateCartCount();

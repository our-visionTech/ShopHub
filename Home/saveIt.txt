
function formatMK(amount) {
  return `MK ${Number(amount).toLocaleString("en-MW")}`;
}

function getGrid() {
  return document.getElementById("productsGrid");
}

// === GLOBAL VARIABLES ===
let wishlist = [];
let cart = JSON.parse(localStorage.getItem("shophub_cart")) || [];
let allProducts = [];
let pendingProduct = null;
let selectedSize = null;
let grid;

// === INITIALIZATION ===
let isInitialized = false;

async function initializeApp(force = false) {
  if (isInitialized && !force) return;
  isInitialized = true;

  console.log("Initializing app");

  // Load wishlist in background
  loadWishlist().catch(err => {
    console.warn("Wishlist failed, continuing:", err);
    wishlist = [];
  });

  // Always load products
  await loadProducts();

  updateCartCount();
}

// Auth state listener
supabase.auth.onAuthStateChange(async (event, session) => {
  console.log("Auth event:", event, "User:", session?.user?.id || "none");

  if (
    event === 'INITIAL_SESSION' ||
    event === 'SIGNED_IN' ||
    event === 'SIGNED_OUT' ||
    event === 'TOKEN_REFRESHED'
  ) {
    isInitialized = false;
    await initializeApp(true);
  }
});

// Handle page cache restoration
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    isInitialized = false;
    initializeApp(true);
  }
});

// === WISHLIST ===
async function loadWishlist() {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      wishlist = [];
      return;
    }

    const { data, error } = await supabase
      .from("wishlist")
      .select("product_id")
      .eq("user_id", user.id);

    if (error) {
      console.warn("Wishlist error:", error.message);
      wishlist = [];
      return;
    }

    wishlist = (data || []).map(item => String(item.product_id));
  } catch (err) {
    console.error("Wishlist crashed:", err);
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

  if (isLiked) {
    const { error } = await supabase
      .from("wishlist")
      .delete()
      .eq("user_id", user.id)
      .eq("product_id", product.id);

    if (!error) {
      wishlist = wishlist.filter(id => id !== idStr);
    }
  } else {
    const { error } = await supabase
      .from("wishlist")
      .insert({ user_id: user.id, product_id: product.id });

    if (!error) {
      wishlist.push(idStr);
    }
  }

  // Always update UI — safe fallback
  if (typeof window.filterAndSort === "function") {
    window.filterAndSort();
  } else if (allProducts.length > 0) {
    renderProducts(allProducts);
  }
}

// === PRODUCT LOADING ===
async function loadProducts() {
  console.log("loadProducts() called");
  const gridEl = getGrid();
  if (!gridEl) {
    console.warn("productsGrid not found");
    return;
  }

  const { data: products, error } = await supabase
    .from("products")
    .select("id,name,price,image_url,has_sizes,categories(name)")
    .order("id");

  if (error) {
    console.error("Product load error:", error);
    gridEl.innerHTML = `<p style="text-align:center;color:#ff4444;padding:2rem;">Failed to load products. Please refresh.</p>`;
    allProducts = [];
    return;
  }

  if (!products || products.length === 0) {
    gridEl.innerHTML = `<p style="text-align:center;padding:2rem;">No products available at the moment.</p>`;
    allProducts = [];
    return;
  }

  allProducts = products;
  console.log(`[PRODUCTS] Loaded ${products.length} products`);

  // Update category filters
  const categories = [...new Set(allProducts.map(p => p.categories?.name).filter(Boolean))];
  const options = `<option value="all">All Items</option>` +
    categories.map(c => `<option value="${c.toLowerCase()}">${c}</option>`).join("");
  const filterSelectEl = document.getElementById("filterSelect");
  const mobileFilterEl = document.getElementById("mobileFilter");
  if (filterSelectEl) filterSelectEl.innerHTML = options;
  if (mobileFilterEl) mobileFilterEl.innerHTML = options;
  console.log("[CATEGORIES] Updated filters");

  // ── ROBUST RENDERING ───────────────────────────────────────────────
  const renderSafely = () => {
    if (typeof window.filterAndSort === "function") {
      console.log("[RENDER] Using filterAndSort");
      window.filterAndSort();
    } else {
      console.log("[RENDER] Fallback: direct renderProducts");
      renderProducts(allProducts);
    }
  };

  // Try immediately
  renderSafely();

  // If filterAndSort or grid isn't ready yet (common on login redirect), retry
  if (typeof window.filterAndSort !== "function" || !document.getElementById("productsGrid")) {
    console.log("[RENDER] filterAndSort or grid not ready → starting retry");
    let attempts = 0;
    const maxAttempts = 60; // ~6 seconds
    const retryInterval = setInterval(() => {
      attempts++;
      if (typeof window.filterAndSort === "function" && document.getElementById("productsGrid")) {
        clearInterval(retryInterval);
        console.log(`[RENDER] Success after ${attempts} attempts`);
        renderSafely();
      } else if (attempts >= maxAttempts) {
        clearInterval(retryInterval);
        console.warn("[RENDER] Retry timeout after 6s – DOM still not ready");
      }
    }, 100);
  }
}

function renderProducts(products) {
  const gridEl = document.getElementById("productsGrid");

  if (!gridEl) {
    console.warn("renderProducts: grid not found");
    return;
  }

  if (!products || products.length === 0) {
    gridEl.innerHTML = `<p style="text-align:center;padding:2rem;">No products found.</p>`;
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

// === DOM READY: ALL INTERACTIVE FEATURES ===
document.addEventListener("DOMContentLoaded", () => {
  grid = getGrid();
  if (!grid) {
    console.error("productsGrid element not found!");
    return;
  }

  // SAFETY RE-RENDER: If products loaded before DOM was ready (e.g. logged in)
  if (allProducts.length > 0) {
    if (typeof window.filterAndSort === "function") {
      window.filterAndSort();
    } else {
      renderProducts(allProducts);
    }
    console.log("Safety re-render applied for early-loaded products");
  }

  // Grid click handling
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

  // Safety re-render if products were loaded before DOM was ready
if (allProducts.length > 0) {
  console.log("[DOMContentLoaded] Safety render for pre-loaded products");
  if (typeof window.filterAndSort === "function") {
    window.filterAndSort();
  } else {
    renderProducts(allProducts);
  }
}
  // Filter elements
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const sortSelect = document.getElementById("sortSelect");
  const mobileSearch = document.getElementById("mobileSearch");
  const mobileFilter = document.getElementById("mobileFilter");
  const mobileSort = document.getElementById("mobileSort");

  // Core filter & sort function
  function filterAndSort() {
    let filtered = [...allProducts];

    const query = searchInput?.value.toLowerCase().trim() || "";
    if (query) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(query));
    }

    const cat = filterSelect?.value || "all";
    if (cat !== "all") {
      filtered = filtered.filter(p => (p.categories?.name || '').toLowerCase() === cat);
    }

    const sort = sortSelect?.value || "";
    if (sort === "price-low") filtered.sort((a, b) => a.price - b.price);
    else if (sort === "price-high") filtered.sort((a, b) => b.price - a.price);
    else if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));

    renderProducts(filtered);
  }

  // Expose globally
  window.filterAndSort = filterAndSort;

// Safety: If products were loaded early (e.g. during login redirect), render them now
if (allProducts.length > 0) {
  console.log("[DOMContentLoaded] Safety render for pre-loaded products");
  if (typeof window.filterAndSort === "function") {
    window.filterAndSort();
  } else {
    renderProducts(allProducts);
  }
}

  // Listeners
  searchInput?.addEventListener("input", filterAndSort);
  filterSelect?.addEventListener("change", filterAndSort);
  sortSelect?.addEventListener("change", filterAndSort);

  // Mobile sync
  [mobileSearch, searchInput].forEach(el => {
    el?.addEventListener("input", () => {
      const val = el.value;
      if (searchInput) searchInput.value = val;
      if (mobileSearch) mobileSearch.value = val;
      filterAndSort();
    });
  });

  [mobileFilter, filterSelect].forEach(el => {
    el?.addEventListener("change", () => {
      const val = el.value;
      if (filterSelect) filterSelect.value = val;
      if (mobileFilter) mobileFilter.value = val;
      filterAndSort();
    });
  });

  [mobileSort, sortSelect].forEach(el => {
    el?.addEventListener("change", () => {
      const val = el.value;
      if (sortSelect) sortSelect.value = val;
      if (mobileSort) mobileSort.value = val;
      filterAndSort();
    });
  });

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

// === CART ===
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
  const cartCountEl = document.getElementById("cartCount");
  const mobileCountEl = document.getElementById("mobileCartCount");

  if (cartCountEl) cartCountEl.textContent = count;
  if (mobileCountEl) mobileCountEl.textContent = count;
}

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

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 ShopHub Checkout - MWK Prices + OneKhusa Integration');

  // 1. Check authentication
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !session.user) {
    localStorage.setItem("redirect_after_login", "checkout.html");
    window.location.href = "../Admin/adLogin.html";
    return;
  }

  // 2. Load user profile & pre-fill form
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();

  window.customerId = profile?.id || 1;

  if (profile) {
    document.getElementById("email").value = profile.email || "";
    document.getElementById("first-name").value = profile.first_name || "";
    document.getElementById("last-name").value = profile.last_name || "";
    document.getElementById("phone").value = profile.phone || "";
  }

  // 3. Cart from localStorage
  let cart = JSON.parse(localStorage.getItem("shophub_cart") || '[]');
  let discount = 0;

  function getPublicImageUrl(path) {
    if (!path) return 'https://i.pinimg.com/736x/4a/d8/f3/4ad8f37a3820e656419f4dd0b417e3c4.jpg';
    if (path.startsWith("http")) return path;
    return `${supabaseUrl}/storage/v1/object/public/products/${path}`;
  }

  async function getSizesForProduct(productId) {
    const { data } = await supabase
      .from("product_sizes")
      .select("size, stock")
      .eq("product_id", productId)
      .gt("stock", 0)
      .order("size");
    return data || [];
  }

  function formatMWK(amount) {
    return `MWK ${amount.toFixed(2)}`;
  }

  async function renderCart() {
    const container = document.getElementById("checkoutItems");
    if (cart.length === 0) {
      container.innerHTML = "<p style='text-align:center;padding:3rem 0;opacity:0.6;'>Your bag is empty</p>";
      document.getElementById("itemCount").textContent = "0 items";
      document.getElementById("grandTotal").textContent = "MWK 0.00";
      return;
    }

    let html = "";
    for (let index = 0; index < cart.length; index++) {
      const item = cart[index];
      let sizeHtml = "";

      if (item.has_sizes) {
        const sizes = await getSizesForProduct(item.id);
        sizeHtml = `
          <div class="input-group" style="margin-top:0.8rem;">
            <label style="font-size:0.85rem;opacity:0.8;">Select Size</label>
            <select onchange="updateItemSize(${index}, this.value)" style="padding:0.6rem;border-radius:10px;">
              <option value="">Choose size</option>
              ${sizes.map(s => `<option value="${s.size}" ${item.size === s.size ? "selected" : ""}>${s.size}</option>`).join("")}
            </select>
          </div>
        `;
      }

      html += `
        <div class="cart-item">
          <img src="${getPublicImageUrl(item.image_url)}">
          <div class="item-info">
            <h4>${item.name}</h4>
            ${sizeHtml}
            <div>Qty: ${item.quantity}</div>
            <div class="item-price">${formatMWK(item.price * item.quantity)}</div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    const totalItems = cart.reduce((sum, i) => sum + i.quantity, 0);
    document.getElementById("itemCount").textContent = `${totalItems} item${totalItems !== 1 ? "s" : ""}`;

    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const tax = subtotal * 0.16; // VAT 16%
    const total = subtotal - discount + tax;

    document.getElementById("subtotal").textContent = formatMWK(subtotal);
    document.getElementById("discountAmount").textContent = `- ${formatMWK(discount)}`;
    document.getElementById("tax").textContent = formatMWK(tax);
    document.getElementById("grandTotal").textContent = formatMWK(total);
  }

  window.updateItemSize = function (index, size) {
    cart[index].size = size;
    localStorage.setItem("shophub_cart", JSON.stringify(cart));
  };

  window.applyDiscount = function () {
    const code = document.getElementById("discountCode").value.trim().toUpperCase();
    const msg = document.getElementById("discountMessage");

    if (code === "VAULT20") {
      discount = cart.reduce((s, i) => s + i.price * i.quantity, 0) * 0.20;
      msg.innerHTML = `<div style="color:#4ade80;">20% OFF Applied</div>`;
    } else if (code !== "") {
      discount = 0;
      msg.innerHTML = `<div style="color:#ff6b6b;">Invalid Code</div>`;
    } else {
      discount = 0;
      msg.innerHTML = "";
    }
    renderCart();
  };

  // Submit handler
  document.getElementById("submit").addEventListener("click", async () => {
    const button = document.getElementById("submit");
    const spinner = document.getElementById("spinner");
    const text = document.getElementById("button-text");

    button.disabled = true;
    text.style.display = "none";
    spinner.style.display = "inline";

    try {
      // Validate required fields
      const email = document.getElementById("email").value.trim();
      const firstName = document.getElementById("first-name").value.trim();
      const lastName = document.getElementById("last-name").value.trim();
      const phone = document.getElementById("phone").value.trim();
      const paymentMethod = document.getElementById("payment-method").value;

      if (!email || !firstName || !lastName || !phone) {
        throw new Error("Please fill in all required contact fields.");
      }
      if (!paymentMethod) {
        throw new Error("Please select a payment method.");
      }

      // Check sizes
      const missingSize = cart.find(item => item.has_sizes && !item.size);
      if (missingSize) {
        throw new Error(`Please select a size for "${missingSize.name}".`);
      }

      // Prepare customer data
      const customerData = {
        name: `${firstName} ${lastName}`,
        email,
        phone,
        address: document.getElementById("address").value.trim(),
        apt: document.getElementById("apt").value.trim(),
        city: document.getElementById("city").value.trim(),
        postal: document.getElementById("postal").value.trim(),
        country: document.getElementById("country").value,
      };

      const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
      const tax = subtotal * 0.16;
      const totalPrice = subtotal - discount + tax;

      // Step 1: Create the order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert([{
          customer_id: window.customerId,
          total: totalPrice,
          status: "pending",
          payment_method: "onekhusa",
          shipping_address: JSON.stringify(customerData)
        }])
        .select("id")
        .single();

      if (orderError) throw new Error(`Order creation failed: ${orderError.message}`);
      if (!order?.id) throw new Error("No order ID returned");

      // Step 2: Save order items (THIS WAS MISSING / UNREACHABLE BEFORE)
      const orderItems = cart.map(item => ({
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
        name: item.name,
        image_url: item.image_url,
        size: item.size || null
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) {
        console.error("Order items insert failed:", itemsError);
        throw new Error(`Failed to save order items: ${itemsError.message}`);
      }

      // Step 3: Initiate payment
      const token = session.access_token;
      if (!token) throw new Error("User not authenticated");

      const res = await fetch(
        `${supabaseUrl}/functions/v1/oneKhusa-payment-intent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            amount: totalPrice,
            email,
            phone,
            order_id: order.id,
            method: paymentMethod
          })
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Payment initiation failed (${res.status})`);
      }

      const paymentData = await res.json();
      console.log("OneKhusa response:", paymentData);

      // Step 4: Handle redirect or mobile prompt
      if (paymentData.payment_url) {
        // Clear cart only after successful order creation (before redirect)
        localStorage.removeItem("shophub_cart");
        window.location.href = paymentData.payment_url;
      } else {
        alert(
          "📱 A payment prompt has been sent to your phone.\n" +
          "Please approve the payment to complete your order."
        );
        localStorage.removeItem("shophub_cart");
      }

    } catch (err) {
      console.error("Checkout failed:", err);
      alert(`Error: ${err.message}`);
    } finally {
      button.disabled = false;
      text.style.display = "inline";
      spinner.style.display = "none";
    }
  });

  // Initial render
  await renderCart();
});

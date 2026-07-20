
let currentUser = null;
let isAdmin = false;

supabase.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user ?? null;
  if (currentUser) {
    await checkIfAdmin(currentUser.id);
  } else {
    isAdmin = false;
  }
  updateUIForAuthState();
});

async function checkIfAdmin(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) {
      isAdmin = false;
      return;
    }
    isAdmin = data.role === 'admin';
  } catch (err) {
    console.error('Error checking admin:', err);
    isAdmin = false;
  }
}

function updateUIForAuthState() {
  document.querySelectorAll('.vault-link span').forEach(span => {
    if (currentUser) {
      span.textContent = isAdmin ? 'Admin Dashboard' : 'My Vault';
    } else {
      span.textContent = 'My Vault';
    }
  });
}


// Initial session check
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  if (currentUser) await checkIfAdmin(currentUser.id);
  updateUIForAuthState();
})();

document.addEventListener('click', (e) => {
  const vaultLink = e.target.closest('.vault-link');
  if (!vaultLink) return;

  e.preventDefault();

  if (currentUser) {
    window.location.href = isAdmin
      ? '/ShopHub/Admin/landing.html'
      : '/ShopHub/user/userDashboard.html';
  } else {
    const redirectTo = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href =
      `/ShopHub/Admin/adLogin.html?redirect=${redirectTo}`;
  }
});


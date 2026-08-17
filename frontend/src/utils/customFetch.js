// Salva uma referência persistente (singleton) ao fetch nativo original para evitar recursividade infinita no HMR/re-render
if (!window.__originalFetch) {
  window.__originalFetch = window.fetch;
}

// Sobrescreve chamadas de fetch locais para injetar cabeçalho JWT e tratar 401
export const customFetch = async (url, options = {}) => {
  const token = localStorage.getItem('fo_token');
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const opt = { ...options, headers };
  
  try {
    const response = await window.__originalFetch(url, opt);
    return response;
  } catch (e) {
    throw e;
  }
};

window.fetch = customFetch;

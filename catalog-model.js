(function (root) {
  'use strict';
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  function normalizeProducts(products) {
    if (!Array.isArray(products) || products.length > 200) throw new Error('Catálogo inválido.');
    const ids = new Set();
    return products.map(p => {
      if (!p || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id) || p.id.length > 80 || ids.has(p.id) ||
          !text(p.name, 100) || !p.name.trim() || !text(p.category, 80) || !p.category.trim() ||
          !text(p.description, 1000) || !text(p.weight, 100) ||
          !Number.isInteger(p.price_cents) || p.price_cents < 1 || p.price_cents > 1000000 ||
          !/^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(p.image) || p.image.length > 100 || typeof p.active !== 'boolean' ||
          !(p.stock === null || Number.isInteger(p.stock) && p.stock >= 0 && p.stock <= 99999) ||
          ![null, 'aconchego', 'quarteto'].includes(p.custom) || !Array.isArray(p.flavors) || p.flavors.length > 20) throw new Error('Produto inválido.');
      ids.add(p.id);
      const names = new Set();
      for (const flavor of p.flavors) {
        if (!flavor || !text(flavor.name, 100) || !flavor.name.trim() || flavor.name !== flavor.name.trim() || ['__proto__', 'constructor', 'prototype'].includes(flavor.name.toLowerCase()) || names.has(flavor.name.toLowerCase()) || typeof flavor.active !== 'boolean') throw new Error('Sabor inválido.');
        names.add(flavor.name.toLowerCase());
      }
      if (!p.custom && p.flavors.length) throw new Error('Produto simples não pode ter sabores.');
      return { ...p, price: p.price_cents / 100, flavors: p.flavors.map(f => ({ ...f })) };
    });
  }
  function validOptions(product, options) {
    if (!product.custom) return options == null;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
    const names = new Set(product.flavors.filter(f => f.active).map(f => f.name));
    const entries = Object.entries(options);
    return entries.length > 0 && entries.every(([name, n]) => Number.isInteger(n) && n >= 0 && n <= 4 && (n === 0 || names.has(name))) && entries.reduce((sum, [, n]) => sum + n, 0) === 4;
  }
  function available(product) {
    return Boolean(product && product.active && product.stock !== 0 && (!product.custom || product.flavors.some(f => f.active)));
  }
  function maxQuantity(product) { return Math.min(product.stock === null ? 99 : product.stock, 99); }
  function sanitizeCart(cart, products) {
    if (!Array.isArray(cart)) return [];
    const counts = new Map();
    const result = [];
    for (const item of cart.slice(0, 200)) {
      const p = item && products.find(p => p.id === item.id);
      if (!available(p) || !Number.isInteger(item.qty) || item.qty < 1 || !validOptions(p, item.options)) continue;
      const used = counts.get(p.id) || 0;
      const qty = Math.min(item.qty, maxQuantity(p) - used);
      if (qty < 1) continue;
      counts.set(p.id, used + qty);
      const clean = { id: p.id, qty };
      if (p.custom) clean.options = Object.fromEntries(p.flavors.filter(f => f.active).map(f => [f.name, item.options[f.name] || 0]));
      const existing = result.find(x => x.id === clean.id && JSON.stringify(x.options) === JSON.stringify(clean.options));
      if (existing) existing.qty += qty; else result.push(clean);
    }
    return result;
  }
  const api = { normalizeProducts, validOptions, available, maxQuantity, sanitizeCart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MaraviCatalog = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);

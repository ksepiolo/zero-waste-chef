export function getProduct(id: string) {
  return { id, name: "Test Product", quantity: 1, unit: "szt", expiryDate: null };
}

export function getProducts() {
  return [{ id: "1", name: "Test Product", quantity: 1, unit: "szt", expiryDate: null }];
}

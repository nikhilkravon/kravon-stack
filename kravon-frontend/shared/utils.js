export function formatPrice(amount) {
  if (typeof amount === 'number') {
    return `₹${amount}`;
  }
  return `₹${Number(amount) || 0}`;
}

export function foodTypeDot(foodType) {
  const type = String(foodType).toLowerCase();
  if (type === 'veg' || type === 'vegan') {
    return '<span class="food-dot food-dot-veg" aria-label="veg"></span>';
  }
  if (type === 'non_veg' || type === 'egg') {
    return '<span class="food-dot food-dot-nonveg" aria-label="non-veg"></span>';
  }
  return '<span class="food-dot food-dot-unknown" aria-label="unknown food type"></span>';
}

export function getTodayHours(operatingHours) {
  if (!Array.isArray(operatingHours) || operatingHours.length === 0) {
    return null;
  }

  const dayIndex = new Date().getDay();
  return operatingHours.find((entry) => Number(entry.day_of_week) === dayIndex) || null;
}

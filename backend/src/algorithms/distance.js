/**
 * Haversine distance between two lat/lng points in kilometers
 */
function haversineDistance(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371; // Earth radius in km

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const calc =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;

  return R * 2 * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

/**
 * Build a full NxN distance matrix from an array of {lat, lng} points
 */
function buildDistanceMatrix(locations) {
  const n = locations.length;
  const matrix = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineDistance(locations[i], locations[j]);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }
  return matrix;
}

module.exports = { haversineDistance, buildDistanceMatrix };

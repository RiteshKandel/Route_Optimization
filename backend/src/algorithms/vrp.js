const TSPSolver = require('./tsp');
const { haversineDistance } = require('./distance');

/**
 * Vehicle Routing Problem (VRP) Solver
 * 
 * Splits N locations across V vehicles using:
 *   Phase 1 — K-Means geographic clustering
 *   Phase 2 — TSP optimization per cluster (reuses TSPSolver)
 *   Phase 3 — Cluster balancing to minimize max route distance
 * 
 * The first location (index 0) is the depot — all vehicles start from there.
 */
class VRPSolver {
  constructor(locations, vehicleCount, options = {}) {
    this.locations = locations; // Array of { lat, lng, ... }
    this.n = locations.length;
    this.vehicleCount = Math.min(vehicleCount, locations.length - 1); // Can't have more vehicles than non-depot locations
    this.maxIterations = options.maxIterations || 50;
    this.balanceIterations = options.balanceIterations || 30;
  }

  // ─── Phase 1: K-Means Clustering ─────────────────────────────────
  // Clusters non-depot locations (indices 1..n-1) into V groups
  _kMeansClustering() {
    const nonDepot = [];
    for (let i = 1; i < this.n; i++) {
      nonDepot.push({ index: i, lat: this.locations[i].lat, lng: this.locations[i].lng });
    }

    const k = this.vehicleCount;

    // Initialize centroids by spreading evenly across sorted locations
    // Sort by angle from depot for better initial spread
    const depot = this.locations[0];
    const withAngles = nonDepot.map(loc => ({
      ...loc,
      angle: Math.atan2(loc.lat - depot.lat, loc.lng - depot.lng)
    }));
    withAngles.sort((a, b) => a.angle - b.angle);

    // Pick evenly spaced locations as initial centroids
    let centroids = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor((i * withAngles.length) / k);
      centroids.push({ lat: withAngles[idx].lat, lng: withAngles[idx].lng });
    }

    let assignments = new Array(nonDepot.length).fill(0);

    for (let iter = 0; iter < this.maxIterations; iter++) {
      let changed = false;

      // Assign each location to nearest centroid
      for (let i = 0; i < nonDepot.length; i++) {
        let minDist = Infinity;
        let bestCluster = 0;

        for (let c = 0; c < k; c++) {
          const d = haversineDistance(nonDepot[i], centroids[c]);
          if (d < minDist) {
            minDist = d;
            bestCluster = c;
          }
        }

        if (assignments[i] !== bestCluster) {
          assignments[i] = bestCluster;
          changed = true;
        }
      }

      if (!changed) break;

      // Recalculate centroids
      for (let c = 0; c < k; c++) {
        let sumLat = 0, sumLng = 0, count = 0;
        for (let i = 0; i < nonDepot.length; i++) {
          if (assignments[i] === c) {
            sumLat += nonDepot[i].lat;
            sumLng += nonDepot[i].lng;
            count++;
          }
        }
        if (count > 0) {
          centroids[c] = { lat: sumLat / count, lng: sumLng / count };
        }
      }
    }

    // Build clusters as arrays of original indices
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < nonDepot.length; i++) {
      clusters[assignments[i]].push(nonDepot[i].index);
    }

    // Handle empty clusters: steal from the largest cluster
    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) {
        // Find the largest cluster
        let largest = 0;
        for (let j = 1; j < k; j++) {
          if (clusters[j].length > clusters[largest].length) largest = j;
        }
        if (clusters[largest].length > 1) {
          // Move the location farthest from the largest cluster's centroid
          const lcent = centroids[largest];
          let farthestIdx = 0;
          let farthestDist = 0;
          for (let j = 0; j < clusters[largest].length; j++) {
            const d = haversineDistance(this.locations[clusters[largest][j]], lcent);
            if (d > farthestDist) {
              farthestDist = d;
              farthestIdx = j;
            }
          }
          clusters[c].push(clusters[largest].splice(farthestIdx, 1)[0]);
        }
      }
    }

    return clusters;
  }

  // ─── Phase 2: TSP per Cluster ────────────────────────────────────
  // Each cluster gets depot (index 0) prepended, then TSP-optimized
  _solveCluster(clusterIndices) {
    // Build a mini-locations array: [depot, ...cluster locations]
    const clusterLocations = [this.locations[0], ...clusterIndices.map(i => this.locations[i])];

    if (clusterLocations.length <= 1) {
      return { path: [0], totalDistanceKm: 0, originalIndices: [0] };
    }

    const solver = new TSPSolver(clusterLocations);
    const result = solver.solve();

    // Map the local indices back to original indices
    // Local index 0 = depot (original index 0)
    // Local index i (i>0) = clusterIndices[i-1]
    const originalIndices = result.path.map(localIdx => {
      if (localIdx === 0) return 0;
      return clusterIndices[localIdx - 1];
    });

    return {
      path: result.path,
      totalDistanceKm: result.totalDistanceKm,
      originalIndices
    };
  }

  // ─── Phase 3: Cluster Balancing ──────────────────────────────────
  // Try swapping border locations between adjacent clusters to balance distances
  _balanceClusters(clusters, vehicleResults) {
    let improved = true;
    let iterations = 0;

    while (improved && iterations < this.balanceIterations) {
      improved = false;
      iterations++;

      // Find the vehicle with the longest route
      let maxIdx = 0;
      for (let i = 1; i < vehicleResults.length; i++) {
        if (vehicleResults[i].totalDistanceKm > vehicleResults[maxIdx].totalDistanceKm) {
          maxIdx = i;
        }
      }

      // Find the vehicle with the shortest route
      let minIdx = 0;
      for (let i = 1; i < vehicleResults.length; i++) {
        if (vehicleResults[i].totalDistanceKm < vehicleResults[minIdx].totalDistanceKm && i !== maxIdx) {
          minIdx = i;
        }
      }

      // If difference is small, we're balanced enough
      if (vehicleResults[maxIdx].totalDistanceKm - vehicleResults[minIdx].totalDistanceKm < 1) break;

      // Try moving each non-depot location from max to min
      const maxCluster = clusters[maxIdx];
      if (maxCluster.length <= 1) break; // Can't steal from a single-stop cluster

      let bestSwapGain = 0;
      let bestSwapIdx = -1;

      for (let i = 0; i < maxCluster.length; i++) {
        const locIdx = maxCluster[i];

        // Simulate removing from max cluster
        const newMaxCluster = maxCluster.filter((_, j) => j !== i);
        const newMinCluster = [...clusters[minIdx], locIdx];

        const newMaxResult = this._solveCluster(newMaxCluster);
        const newMinResult = this._solveCluster(newMinCluster);

        const oldTotal = vehicleResults[maxIdx].totalDistanceKm + vehicleResults[minIdx].totalDistanceKm;
        const newTotal = newMaxResult.totalDistanceKm + newMinResult.totalDistanceKm;
        const gain = oldTotal - newTotal;

        // Also check that balance improves
        const oldImbalance = Math.abs(vehicleResults[maxIdx].totalDistanceKm - vehicleResults[minIdx].totalDistanceKm);
        const newImbalance = Math.abs(newMaxResult.totalDistanceKm - newMinResult.totalDistanceKm);

        if (gain > bestSwapGain && newImbalance < oldImbalance) {
          bestSwapGain = gain;
          bestSwapIdx = i;
        }
      }

      if (bestSwapIdx >= 0) {
        const locIdx = maxCluster[bestSwapIdx];
        clusters[maxIdx] = maxCluster.filter((_, j) => j !== bestSwapIdx);
        clusters[minIdx].push(locIdx);

        // Re-solve affected clusters
        vehicleResults[maxIdx] = this._solveCluster(clusters[maxIdx]);
        vehicleResults[minIdx] = this._solveCluster(clusters[minIdx]);
        improved = true;
      }
    }

    return { clusters, vehicleResults };
  }

  // ─── Main Solve ──────────────────────────────────────────────────
  solve() {
    if (this.n <= 1) {
      return {
        vehicles: [{ vehicleId: 1, originalIndices: [0], totalDistanceKm: 0 }],
        totalDistanceKm: 0
      };
    }

    // If only enough locations for 1 vehicle, fall back to single TSP
    if (this.vehicleCount <= 1 || this.n <= 2) {
      const solver = new TSPSolver(this.locations);
      const result = solver.solve();
      return {
        vehicles: [{
          vehicleId: 1,
          originalIndices: result.path,
          totalDistanceKm: result.totalDistanceKm
        }],
        totalDistanceKm: result.totalDistanceKm
      };
    }

    // Phase 1: Cluster
    let clusters = this._kMeansClustering();

    // Phase 2: TSP per cluster
    let vehicleResults = clusters.map(cluster => this._solveCluster(cluster));

    // Phase 3: Balance clusters
    const balanced = this._balanceClusters(clusters, vehicleResults);
    clusters = balanced.clusters;
    vehicleResults = balanced.vehicleResults;

    // Build final result
    let totalDistanceKm = 0;
    const vehicles = vehicleResults.map((result, idx) => {
      totalDistanceKm += result.totalDistanceKm;
      return {
        vehicleId: idx + 1,
        originalIndices: result.originalIndices,
        totalDistanceKm: result.totalDistanceKm
      };
    });

    return {
      vehicles,
      totalDistanceKm
    };
  }
}

module.exports = VRPSolver;

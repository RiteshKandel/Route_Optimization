const { buildDistanceMatrix } = require('./distance');

/**
 * TSP Solver using Nearest Neighbor + Genetic Algorithm
 * 
 * Given N locations, find the shortest route visiting all of them.
 * The first location (index 0) is always fixed as the starting point.
 * Only the remaining locations are permuted during optimization.
 */
class TSPSolver {
  constructor(locations, options = {}) {
    this.locations = locations;
    this.n = locations.length;
    this.distMatrix = buildDistanceMatrix(locations);
    
    // GA parameters
    this.populationSize = options.populationSize || 60;
    this.generations = options.generations || 300;
    this.mutationRate = options.mutationRate || 0.15;
    this.eliteCount = options.eliteCount || 6;
  }

  // ─── Nearest Neighbor Heuristic ──────────────────────────────────
  // Always starts from index 0 (the fixed starting location)
  nearestNeighbor(startIndex = 0) {
    const visited = new Set([startIndex]);
    const path = [startIndex];
    let current = startIndex;

    while (visited.size < this.n) {
      let nearest = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < this.n; i++) {
        if (!visited.has(i) && this.distMatrix[current][i] < nearestDist) {
          nearest = i;
          nearestDist = this.distMatrix[current][i];
        }
      }

      if (nearest === -1) break;
      visited.add(nearest);
      path.push(nearest);
      current = nearest;
    }

    return path;
  }

  // ─── Route total distance (full path including index 0) ─────────
  routeDistance(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      total += this.distMatrix[path[i]][path[i + 1]];
    }
    return total;
  }

  // ─── Genetic Algorithm ───────────────────────────────────────────
  // NOTE: The GA operates on "sub-routes" — permutations of indices
  //       1..n-1 only. Index 0 is always prepended as the start.

  // Create a random permutation of indices 1..n-1 (excluding 0)
  _randomSubRoute() {
    const route = Array.from({ length: this.n - 1 }, (_, i) => i + 1);
    // Fisher-Yates shuffle
    for (let i = route.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [route[i], route[j]] = [route[j], route[i]];
    }
    return route;
  }

  // Convert a sub-route to a full path (prepend 0)
  _toFullPath(subRoute) {
    return [0, ...subRoute];
  }

  // Convert a full path to a sub-route (remove leading 0)
  _toSubRoute(fullPath) {
    return fullPath.filter(idx => idx !== 0);
  }

  // Ordered Crossover (OX) — operates on sub-routes only
  _crossover(parent1, parent2) {
    const size = parent1.length;
    const start = Math.floor(Math.random() * size);
    const end = start + Math.floor(Math.random() * (size - start));

    const child = new Array(size).fill(-1);
    // Copy segment from parent1
    for (let i = start; i <= end; i++) {
      child[i] = parent1[i];
    }

    // Fill rest from parent2 in order
    let pos = (end + 1) % size;
    for (let i = 0; i < size; i++) {
      const candidate = parent2[(end + 1 + i) % size];
      if (!child.includes(candidate)) {
        child[pos] = candidate;
        pos = (pos + 1) % size;
      }
    }
    return child;
  }

  // Swap mutation — operates on sub-routes only
  _mutate(route) {
    if (Math.random() < this.mutationRate) {
      const i = Math.floor(Math.random() * route.length);
      const j = Math.floor(Math.random() * route.length);
      [route[i], route[j]] = [route[j], route[i]];
    }
    return route;
  }

  // 2-opt local improvement — operates on full path but skips index 0
  _twoOpt(route) {
    let improved = true;
    let bestRoute = [...route];
    let bestDist = this.routeDistance(bestRoute);

    while (improved) {
      improved = false;
      // Start from i=1 so we never move position 0 (the fixed start)
      for (let i = 1; i < bestRoute.length - 1; i++) {
        for (let j = i + 1; j < bestRoute.length; j++) {
          const newRoute = [...bestRoute];
          // Reverse the segment between i and j
          newRoute.splice(i, j - i + 1, ...bestRoute.slice(i, j + 1).reverse());
          const newDist = this.routeDistance(newRoute);
          if (newDist < bestDist) {
            bestRoute = newRoute;
            bestDist = newDist;
            improved = true;
          }
        }
      }
    }
    return bestRoute;
  }

  // Tournament selection — on sub-route population
  _tournamentSelect(population, fitnesses, tournamentSize = 5) {
    let best = -1;
    let bestFit = Infinity;
    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * population.length);
      if (fitnesses[idx] < bestFit) {
        best = idx;
        bestFit = fitnesses[idx];
      }
    }
    return population[best];
  }

  // Full GA solve — all routes start at index 0
  geneticAlgorithm() {
    // Initialize population as sub-routes (indices 1..n-1 only)
    let population = [];

    // Seed with nearest neighbor starting from 0, then extract sub-route
    const nnFull = this.nearestNeighbor(0);
    population.push(this._toSubRoute(nnFull));

    // Add more seeds: nearest neighbor from different starts, but always
    // convert to sub-route format (remove the 0, it's always prepended)
    for (let i = 1; i < Math.min(this.n, this.eliteCount); i++) {
      const nn = this.nearestNeighbor(i);
      population.push(this._toSubRoute(nn));
    }

    // Fill rest with random sub-routes
    while (population.length < this.populationSize) {
      population.push(this._randomSubRoute());
    }

    let bestEverSub = null;
    let bestEverDist = Infinity;

    for (let gen = 0; gen < this.generations; gen++) {
      // Calculate fitness using full path (0 + sub-route)
      const fitnesses = population.map((sub) => this.routeDistance(this._toFullPath(sub)));

      // Track best
      for (let i = 0; i < population.length; i++) {
        if (fitnesses[i] < bestEverDist) {
          bestEverDist = fitnesses[i];
          bestEverSub = [...population[i]];
        }
      }

      // Sort by fitness and keep elites
      const sorted = population
        .map((route, idx) => ({ route, dist: fitnesses[idx] }))
        .sort((a, b) => a.dist - b.dist);

      const nextPopulation = sorted.slice(0, this.eliteCount).map((s) => s.route);

      // Generate offspring
      while (nextPopulation.length < this.populationSize) {
        const parent1 = this._tournamentSelect(population, fitnesses);
        const parent2 = this._tournamentSelect(population, fitnesses);
        let child = this._crossover(parent1, parent2);
        child = this._mutate(child);
        nextPopulation.push(child);
      }

      population = nextPopulation;
    }

    // Convert best sub-route back to full path
    let bestEver = bestEverSub ? this._toFullPath(bestEverSub) : [0];

    // Apply 2-opt local improvement to best solution (skips position 0)
    if (bestEver && bestEver.length <= 20) {
      bestEver = this._twoOpt(bestEver);
      bestEverDist = this.routeDistance(bestEver);
    }

    return {
      path: bestEver,
      totalDistanceKm: bestEverDist
    };
  }

  // ─── Main solve entry ────────────────────────────────────────────
  // Index 0 is always the first element in the returned path
  solve() {
    if (this.n <= 1) {
      return { path: [0], totalDistanceKm: 0 };
    }

    if (this.n === 2) {
      return { path: [0, 1], totalDistanceKm: this.distMatrix[0][1] };
    }

    if (this.n <= 3) {
      // For 3 nodes, use nearest neighbor starting from 0
      const path = this.nearestNeighbor(0);
      return { path, totalDistanceKm: this.routeDistance(path) };
    }

    // For 4+ nodes, use Genetic Algorithm (first location always fixed)
    return this.geneticAlgorithm();
  }
}

module.exports = TSPSolver;

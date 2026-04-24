import math
from .tsp import TSPSolver
from .distance import haversine_distance

class VRPSolver:
    def __init__(self, locations, vehicle_count, options=None):
        if options is None:
            options = {}
        self.locations = locations
        self.n = len(locations)
        self.vehicle_count = min(vehicle_count, self.n - 1)
        self.max_iterations = options.get('maxIterations', 50)
        self.balance_iterations = options.get('balanceIterations', 30)

    def _k_means_clustering(self):
        non_depot = []
        for i in range(1, self.n):
            non_depot.append({'index': i, 'lat': self.locations[i]['lat'], 'lng': self.locations[i]['lng']})

        k = self.vehicle_count
        if k <= 0:
            return []

        depot = self.locations[0]
        
        # Calculate angle from depot
        for loc in non_depot:
            loc['angle'] = math.atan2(loc['lat'] - depot['lat'], loc['lng'] - depot['lng'])
            
        non_depot.sort(key=lambda x: x['angle'])

        centroids = []
        for i in range(k):
            idx = int(math.floor((i * len(non_depot)) / k))
            centroids.append({'lat': non_depot[idx]['lat'], 'lng': non_depot[idx]['lng']})

        assignments = [0] * len(non_depot)

        for _ in range(self.max_iterations):
            changed = False

            for i in range(len(non_depot)):
                min_dist = float('inf')
                best_cluster = 0

                for c in range(k):
                    d = haversine_distance(non_depot[i], centroids[c])
                    if d < min_dist:
                        min_dist = d
                        best_cluster = c

                if assignments[i] != best_cluster:
                    assignments[i] = best_cluster
                    changed = True

            if not changed:
                break

            for c in range(k):
                sum_lat = 0.0
                sum_lng = 0.0
                count = 0
                for i in range(len(non_depot)):
                    if assignments[i] == c:
                        sum_lat += non_depot[i]['lat']
                        sum_lng += non_depot[i]['lng']
                        count += 1
                if count > 0:
                    centroids[c] = {'lat': sum_lat / count, 'lng': sum_lng / count}

        clusters = [[] for _ in range(k)]
        for i in range(len(non_depot)):
            clusters[assignments[i]].append(non_depot[i]['index'])

        for c in range(k):
            if len(clusters[c]) == 0:
                largest = 0
                for j in range(1, k):
                    if len(clusters[j]) > len(clusters[largest]):
                        largest = j
                
                if len(clusters[largest]) > 1:
                    lcent = centroids[largest]
                    farthest_idx = 0
                    farthest_dist = 0.0
                    for j in range(len(clusters[largest])):
                        orig_idx = clusters[largest][j]
                        d = haversine_distance(self.locations[orig_idx], lcent)
                        if d > farthest_dist:
                            farthest_dist = d
                            farthest_idx = j
                    
                    popped = clusters[largest].pop(farthest_idx)
                    clusters[c].append(popped)

        return clusters

    def _solve_cluster(self, cluster_indices):
        cluster_locations = [self.locations[0]] + [self.locations[i] for i in cluster_indices]

        if len(cluster_locations) <= 1:
            return {'path': [0], 'totalDistanceKm': 0.0, 'originalIndices': [0]}

        solver = TSPSolver(cluster_locations)
        result = solver.solve()

        original_indices = []
        for local_idx in result['path']:
            if local_idx == 0:
                original_indices.append(0)
            else:
                original_indices.append(cluster_indices[local_idx - 1])

        return {
            'path': result['path'],
            'totalDistanceKm': result['totalDistanceKm'],
            'originalIndices': original_indices
        }

    def _balance_clusters(self, clusters, vehicle_results):
        improved = True
        iterations = 0

        while improved and iterations < self.balance_iterations:
            improved = False
            iterations += 1

            if len(vehicle_results) <= 1:
                break

            max_idx = 0
            for i in range(1, len(vehicle_results)):
                if vehicle_results[i]['totalDistanceKm'] > vehicle_results[max_idx]['totalDistanceKm']:
                    max_idx = i

            min_idx = -1
            for i in range(len(vehicle_results)):
                if i != max_idx:
                    if min_idx == -1 or vehicle_results[i]['totalDistanceKm'] < vehicle_results[min_idx]['totalDistanceKm']:
                        min_idx = i
                        
            if min_idx == -1:
                break

            if vehicle_results[max_idx]['totalDistanceKm'] - vehicle_results[min_idx]['totalDistanceKm'] < 1.0:
                break

            max_cluster = clusters[max_idx]
            if len(max_cluster) <= 1:
                break

            best_swap_gain = 0.0
            best_swap_idx = -1

            for i in range(len(max_cluster)):
                loc_idx = max_cluster[i]

                new_max_cluster = [x for j, x in enumerate(max_cluster) if j != i]
                new_min_cluster = clusters[min_idx] + [loc_idx]

                new_max_result = self._solve_cluster(new_max_cluster)
                new_min_result = self._solve_cluster(new_min_cluster)

                old_total = vehicle_results[max_idx]['totalDistanceKm'] + vehicle_results[min_idx]['totalDistanceKm']
                new_total = new_max_result['totalDistanceKm'] + new_min_result['totalDistanceKm']
                gain = old_total - new_total

                old_imbalance = abs(vehicle_results[max_idx]['totalDistanceKm'] - vehicle_results[min_idx]['totalDistanceKm'])
                new_imbalance = abs(new_max_result['totalDistanceKm'] - new_min_result['totalDistanceKm'])

                if gain > best_swap_gain and new_imbalance < old_imbalance:
                    best_swap_gain = gain
                    best_swap_idx = i

            if best_swap_idx >= 0:
                loc_idx = max_cluster[best_swap_idx]
                clusters[max_idx] = [x for j, x in enumerate(max_cluster) if j != best_swap_idx]
                clusters[min_idx].append(loc_idx)

                vehicle_results[max_idx] = self._solve_cluster(clusters[max_idx])
                vehicle_results[min_idx] = self._solve_cluster(clusters[min_idx])
                improved = True

        return {'clusters': clusters, 'vehicleResults': vehicle_results}

    def solve(self):
        if self.n <= 1:
            return {
                'vehicles': [{'vehicleId': 1, 'originalIndices': [0], 'totalDistanceKm': 0.0}],
                'totalDistanceKm': 0.0
            }

        if self.vehicle_count <= 1 or self.n <= 2:
            solver = TSPSolver(self.locations)
            result = solver.solve()
            return {
                'vehicles': [{
                    'vehicleId': 1,
                    'originalIndices': result['path'],
                    'totalDistanceKm': result['totalDistanceKm']
                }],
                'totalDistanceKm': result['totalDistanceKm']
            }

        clusters = self._k_means_clustering()
        vehicle_results = [self._solve_cluster(cluster) for cluster in clusters]

        balanced = self._balance_clusters(clusters, vehicle_results)
        clusters = balanced['clusters']
        vehicle_results = balanced['vehicleResults']

        total_distance_km = 0.0
        vehicles = []
        for idx, result in enumerate(vehicle_results):
            total_distance_km += result['totalDistanceKm']
            vehicles.append({
                'vehicleId': idx + 1,
                'originalIndices': result['originalIndices'],
                'totalDistanceKm': result['totalDistanceKm']
            })

        return {
            'vehicles': vehicles,
            'totalDistanceKm': total_distance_km
        }

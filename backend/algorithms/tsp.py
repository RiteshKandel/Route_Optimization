import random
from .distance import build_distance_matrix

class TSPSolver:
    def __init__(self, locations, options=None):
        if options is None:
            options = {}
        self.locations = locations
        self.n = len(locations)
        self.dist_matrix = build_distance_matrix(locations)
        
        self.population_size = options.get('populationSize', 60)
        self.generations = options.get('generations', 300)
        self.mutation_rate = options.get('mutationRate', 0.15)
        self.elite_count = options.get('eliteCount', 6)

    def nearest_neighbor(self, start_index=0):
        visited = {start_index}
        path = [start_index]
        current = start_index

        while len(visited) < self.n:
            nearest = -1
            nearest_dist = float('inf')

            for i in range(self.n):
                if i not in visited and self.dist_matrix[current][i] < nearest_dist:
                    nearest = i
                    nearest_dist = self.dist_matrix[current][i]

            if nearest == -1:
                break
            visited.add(nearest)
            path.append(nearest)
            current = nearest

        return path

    def route_distance(self, path):
        total = 0.0
        for i in range(len(path) - 1):
            total += self.dist_matrix[path[i]][path[i + 1]]
        return total

    def _random_sub_route(self):
        route = list(range(1, self.n))
        random.shuffle(route)
        return route

    def _to_full_path(self, sub_route):
        return [0] + sub_route

    def _to_sub_route(self, full_path):
        return [idx for idx in full_path if idx != 0]

    def _crossover(self, parent1, parent2):
        size = len(parent1)
        start = random.randint(0, size - 1)
        if start == size - 1:
            end = start
        else:
            end = start + random.randint(0, size - start - 1)

        child = [-1] * size
        for i in range(start, end + 1):
            child[i] = parent1[i]

        pos = (end + 1) % size
        for i in range(size):
            candidate = parent2[(end + 1 + i) % size]
            if candidate not in child:
                child[pos] = candidate
                pos = (pos + 1) % size
        return child

    def _mutate(self, route):
        if random.random() < self.mutation_rate:
            i = random.randint(0, len(route) - 1)
            j = random.randint(0, len(route) - 1)
            route[i], route[j] = route[j], route[i]
        return route

    def _two_opt(self, route):
        improved = True
        best_route = list(route)
        best_dist = self.route_distance(best_route)

        while improved:
            improved = False
            for i in range(1, len(best_route) - 1):
                for j in range(i + 1, len(best_route)):
                    new_route = list(best_route)
                    # reverse the segment
                    new_route[i:j+1] = reversed(best_route[i:j+1])
                    new_dist = self.route_distance(new_route)
                    if new_dist < best_dist:
                        best_route = new_route
                        best_dist = new_dist
                        improved = True
        return best_route

    def _tournament_select(self, population, fitnesses, tournament_size=5):
        best = -1
        best_fit = float('inf')
        for _ in range(tournament_size):
            idx = random.randint(0, len(population) - 1)
            if fitnesses[idx] < best_fit:
                best = idx
                best_fit = fitnesses[idx]
        return population[best]

    def genetic_algorithm(self):
        population = []

        nn_full = self.nearest_neighbor(0)
        population.append(self._to_sub_route(nn_full))

        for i in range(1, min(self.n, self.elite_count)):
            nn = self.nearest_neighbor(i)
            population.append(self._to_sub_route(nn))

        while len(population) < self.population_size:
            population.append(self._random_sub_route())

        best_ever_sub = None
        best_ever_dist = float('inf')

        for gen in range(self.generations):
            fitnesses = [self.route_distance(self._to_full_path(sub)) for sub in population]

            for i in range(len(population)):
                if fitnesses[i] < best_ever_dist:
                    best_ever_dist = fitnesses[i]
                    best_ever_sub = list(population[i])

            sorted_pop = [x for _, x in sorted(zip(fitnesses, population))]
            
            next_population = [list(sub) for sub in sorted_pop[:self.elite_count]]

            while len(next_population) < self.population_size:
                parent1 = self._tournament_select(population, fitnesses)
                parent2 = self._tournament_select(population, fitnesses)
                child = self._crossover(parent1, parent2)
                child = self._mutate(child)
                next_population.append(child)

            population = next_population

        best_ever = self._to_full_path(best_ever_sub) if best_ever_sub else [0]

        if best_ever and len(best_ever) <= 20:
            best_ever = self._two_opt(best_ever)
            best_ever_dist = self.route_distance(best_ever)

        return {
            'path': best_ever,
            'totalDistanceKm': best_ever_dist
        }

    def solve(self):
        if self.n <= 1:
            return {'path': [0], 'totalDistanceKm': 0.0}

        if self.n == 2:
            return {'path': [0, 1], 'totalDistanceKm': self.dist_matrix[0][1]}

        if self.n <= 3:
            path = self.nearest_neighbor(0)
            return {'path': path, 'totalDistanceKm': self.route_distance(path)}

        return self.genetic_algorithm()
